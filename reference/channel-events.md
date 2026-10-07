# Channel Events (LOR-86)

Inline system messages in the channel timeline: "Jacob created this channel", "Alice was added by Lor", "Daily digest — scheduled run". They add signal to the channel and replace the prose bot messages we post today.

Status: **built 2026-09-05 (web + mobile)**; live QA still open, see the checklist below.

## Why this shape

Findings from the audit (2026-09-05):

- `message_type` enum has dormant values `system_join`, `system_leave`, `system_pin`, `channel_name_change` (`packages/db/src/schemas/messages.ts:18`, mirrored `packages/realtime-types/src/events.ts:93`). Nothing writes or renders them; no rows carry them. **They get dropped and replaced** (locked below).
- `loop_fire` is the working precedent for an event marker: a message row with `silent: true` fanout, `referencedMessageId` pointer, and a plain-text `content` fallback (`apps/worker/src/jobs/loop-run.ts:162`).
- There is no audit-log table, no `metadata` column on `message`, and no generic realtime event envelope.
- Today's prose stand-ins: `announceCreatedChannels` ("This channel was created from an approved change proposal…", `apps/api/src/routes/v1/proposals/handlers.ts:365`) and the loop auto-pause note.

## Locked decisions

| Decision | Choice | Why |
|---|---|---|
| Storage | Events are `message` rows, not a new table | Reuses pagination, realtime, read-state, jump-to-message, search for free. Matches `loop_fire`/card precedent. |
| Type modeling | **One new `message_type` value `event`**, plus a new pg enum `channel_event_type` stored in a nullable `message.eventType` column (`channel_created`, `channel_renamed`, `member_added`, `member_removed`, `member_left`, `loop_created`, `loop_paused`, `loop_completed`). New kinds = new `channel_event_type` value + db:push; accepted. | Jacob 2026-09-05: generic `event` on message_type, kinds in a sub enum. Keeps `message.type` a small structural enum (default/reply/cards/event) while event kinds stay DB-typed and queryable. |
| Dormant enum cleanup | **Drop** `system_join`, `system_leave`, `system_pin`, `channel_name_change` from `message_type` in the same schema edit | No writers, no renderers, no rows anywhere. drizzle-kit 0.31.x handles enum value removal on push by recreating the type; safe because zero rows use them. Also remove from `RealtimeMessageType`. |
| Payload | New nullable `message.eventPayload` jsonb, typed `.$type<ChannelEventPayload>()`. Clients narrow the payload shape on `message.eventType` — no `kind` field inside the payload. | Typed union next to the schema, same pattern as `attachments`/`embeds`. Not an untyped bag. |
| Content fallback | `content` is still ALWAYS written server-side with the plain-English rendering | For search (trigram/FTS on `content`) and graceful degradation on stale app builds. NOT the mobile plan — mobile gets real rendering in the same phase (below). |
| Author | `authorId` = the acting user (real user id, or `LOR_USER_ID` when Lor acts). Secondary parties go in the payload | `authorId` is `notNull`; the actor is the natural author. Copy derived client-side from type + payload. |
| Fanout | `silent: true` + `excludedFromMemory: true` for all events **except `channel_created`, which uses normal fanout** so new channels light up unread (preserves today's behavior from `announceCreatedChannels`) | Events are ambient signal, not notifications. Lor queries membership/config via tools. |
| `loop_created` moment | Emit on **activation** (draft → active, `apps/api/src/routes/v1/loops/handlers.ts:76`) and on proposal-apply `create_loop` (which inserts directly as active). Never on `propose_loop` — the `loop_card` already announces the draft. | No double-announcing with the card. |
| Initial roster | `member_added` fires for additions AFTER creation only. The creation roster folds into the `channel_created` copy if wanted; no per-member events at create time. | Avoids a wall of events on channel creation. |
| Retention | Keep forever, like all messages. No pruning. | They ARE messages. |
| Interactions | No threads, no reactions, no pin, no edit on event rows in v1 | Keep the surface small while the UI is experimented on. |
| Mobile | **Full parity ships in the same phase as web** — mobile renders event rows properly, not the content fallback | Jacob 2026-09-05: mobile stays fully up to speed with web. |

## Payload types

Lives next to the schema (like `Attachment`/`Embed`). Discriminated by `message.eventType`, so shapes are per-kind:

```ts
export type ChannelEventPayload =
  | ChannelCreatedPayload   // { via?: "proposal"; originChannelId?: string; originChannelName?: string; memberIds?: string[] }
  | ChannelRenamedPayload   // { from: string; to: string }
  | MemberAddedPayload      // { userIds: string[] }            — addedBy = authorId
  | MemberRemovedPayload    // { userId: string }               — removedBy = authorId
  | null                    // member_left, loop-less shapes: authorId alone suffices
  | LoopEventPayload        // { loopId: string; loopName: string; reason?: "failures" | "out_of_credits" }
```

Rules:
- Snapshot names the copy needs when the referent can vanish (e.g. `loopName`, `originChannelName`). User display names are NOT snapshotted — resolve via ids client-side like mentions; the `content` fallback covers deleted users.
- Unknown `eventType` / missing payload on the client → render `content` as muted text. Never throw.

## v1 taxonomy and emission points

| Event | Emitted from | Replaces |
|---|---|---|
| `channel_created` (non-silent) | `createChannel` (`apps/api/src/routes/v1/channels/handlers.ts:114`, after insert, next to the `channel:created` emit) and proposal apply via `announceCreatedChannels` (`proposals/handlers.ts:365`) | the prose "created from an approved change proposal" message |
| `channel_renamed` | `updateChannel` (`channels/handlers.ts:395`) — needs a select-before-update to diff the old name (it doesn't read the prior row today) | nothing |
| `member_added` | `addProjectMember` (`projects/handlers.ts:543`) | nothing |
| `member_removed` / `member_left` | `removeProjectMember` (`projects/handlers.ts:609`) — the kick-vs-leave branch already exists at :628 | nothing |
| `loop_created` | loop activation (`loops/handlers.ts:76`) + proposal apply `create_loop` op (`apps/api/src/lib/change-proposals.ts:247` — currently announces nothing, not even `loop:updated`) | nothing |
| `loop_paused` | auto-pause in `settleLoopRun` (`apps/worker/src/jobs/loop-run.ts`) | the prose Lor auto-pause note |
| `loop_completed` | `complete_loop` executor + `completeLoopManually` | nothing |

Later candidates (each is just: `channel_event_type` value + db:push + payload shape + emitter + copy): `message_pinned`, `channel_archived`, task lifecycle, connector connected, webhook created. Channel DELETE cannot have an event in the deleted channel (cascade); skip.

`loop_fire` stays its own message type but its rendering joins the same visual family (see UI). Candidate for a later fold-in as `eventType: "loop_fired"`.

## Server plumbing

1. `packages/db/src/schemas/messages.ts` — add `"event"` to `messageTypeEnum`, drop the 4 dormant values, add pgEnum `channel_event_type` (8 values), add columns `eventType` (nullable enum) + `eventPayload` (nullable jsonb `.$type<ChannelEventPayload>()`). **Needs db:push (Jacob runs it).** If push balks at the message_type recreate, fall back to a hand-run recreate; zero rows use the dropped values so it's mechanical either way.
2. `packages/realtime-types/src/events.ts` — update `RealtimeMessageType` (add `event`, drop 4), add `eventType` + `eventPayload` to `RealtimeMessage`.
3. `apps/api/src/lib/bot-messages.ts` — `postBotMessage` gains `type`, `silent`, `eventType`, `eventPayload` params (today it hardcodes `type: "default"` at :63 and :144 and has no silent path). Add `postChannelEvent(channel, actorId, eventType, payload)` wrapper that builds the `content` fallback string — one copy function, used by every API-side emission point.
4. `apps/worker/src/lib/lor-messages.ts` — extend `postLorMessage`'s type union + `eventType`/`eventPayload` for worker-side emissions (loop pause/complete).
5. `apps/api/src/lib/helpers/openapi/message-schemas.ts` — expose `eventType` + `eventPayload` on `messageWithAuthorSchema` (zod union mirroring the TS type).
6. `apps/web/src/lib/realtime-adapter.ts` — pass `eventType` + `eventPayload` through.
7. Broadcast: same `message:created` emit to `channelRoom` — no new socket event type.
8. Rebuild note: new API fields need `apps/api` AND `packages/api-client` rebuilds before mobile sees types.

## Client rendering (web)

Branch in `apps/web/src/components/chat/message-item.tsx` BEFORE the card branch (:379): `message.type === "event"` → early-return a `ChannelEventRow` component (which switches on `eventType`). Also:

- `apps/web/src/components/chat/message-list.tsx:417` — exclude event rows from the author-grouping window, or an event between two messages by the same author wrongly forces a new header on the second one. Same fix in `thread-panel.tsx:806` if events ever appear in threads (v1: they don't).
- Event rows still wrap in `MessageScrollerItem` (jump/anchor system needs `messageId`).
- Copy lives in ONE shared function `renderChannelEvent(message)` → `{ icon, text }` — feeds the web row, collapse summaries, and the mobile row.
- **Collapsing (the chunkiness cut):** consecutive event rows of the same type inside the 5-minute group window collapse client-side into one row ("Alice, Bob and 2 others were added by Lor"), expandable on click. No server aggregation.

### UI (locked 2026-09-05)

Jacob picked the **gutter layout without an icon**: an empty avatar-gutter spacer keeps the sentence on the message-content axis, `text-xs text-muted-foreground`, actor/subject names in `font-medium text-foreground/80`, timestamp revealed on hover, row hover `bg-muted/40`. The inline and pill variants (and the per-kind icon map) were built, compared, and deleted.

**Hover cards (web, 2026-09-05):** names in event copy are Notion-mention-style hover targets with a **500ms open delay** (`delay={500}`, `closeDelay={100}` on the Base UI PreviewCard trigger — matches the @mention hover cards; Jacob first asked for 1s, then settled on 500ms). User names open the same profile card as the avatar popover (`UserHoverCard` in `user-profile-card.tsx`, reusing `ProfileCardContent` — profile fetch mounts only when the card opens). Loop names open a loop card (`LoopName`/`LoopHoverContent` in `channel-event-row.tsx`): ∞ icon + name, schedule/status lead, next run, last ran — resolved from the `["channel-loops", channelId]` query, with a "no longer exists" fallback. Channel references (`ChannelName`/`ChannelHoverContent`) hover-preview the channel — hash/private-hash icon, name, topic, Private/Archived/created meta — sharing the channel page's `["channel", slug, id]` cache, and the trigger is a router `Link` that navigates on click (a11y: real link, not an onClick span). The renamed event's OLD name stays plain text (it resolves to nothing). Mobile has no hover equivalent; nothing shipped there.

## Mobile

Ships in the same phase as web. `apps/mobile/src/components/message-row.tsx` gets an event branch mirroring web's chosen variant, sharing `renderChannelEvent` copy (or a mobile twin if the shared package boundary makes it awkward). Track in `reference/mobile-parity-todo.md` only if mobile lags a build behind — the goal is it doesn't.

## Status

- [x] Schema: `event` message type + `channel_event_type` enum (8 values) + `eventType`/`eventPayload` columns, 4 dormant message_type values dropped — **db:push owed**
- [x] `postBotMessage` type/silent/eventType/eventPayload + `postChannelEvent` helper (`apps/api/src/lib/channel-events.ts`, incl. `postLoopChannelEvent`)
- [x] Emission points wired (table above)
- [x] Web `ChannelEventRow` + variants + collapsing (`apps/web/src/components/chat/channel-event-row.tsx`)
- [x] Grouping handled in `message-list.tsx`
- [x] UI variant chosen, others deleted — **locked 2026-09-05: gutter layout WITHOUT the icon** (empty gutter keeps the text on the message-content axis); pill/inline variants deleted
- [x] Prose stand-ins removed (`announceCreatedChannels` text, auto-pause note)
- [x] Mobile event row shipped (same phase; gutter look, shares collapse logic)
- [ ] Live QA (create/rename channel, add/remove member, loop lifecycle)

## Deviations log

- 2026-09-05 (build): Event rendering branches in **message-list** (web + mobile), not message-item — the collapse pass needs neighbor visibility. MessageItem never sees event rows.
- 2026-09-05 (build): Instead of excluding events from the author-group window, a message directly after an event row **forces its header** — a headerless message under an event row looked orphaned.
- 2026-09-05 (build): Member events post into **every active text child channel** of the project (membership lives on the category, which has no timeline). No-op adds (already a member) and no-op removals emit nothing.
- 2026-09-05 (build): `loop_completed` also fires from the worker `complete_loop` executor (actor Lor), and shared copy lives in `packages/messaging/src/channel-events.ts` (`channelEventContent`) since both api and worker build content.
- 2026-09-05 (build): Silent events are excluded from the web "N new" jump-pill count (`use-channel-messages.ts`); they land via the return-to-present refetch.
- 2026-09-05 (build): `postLorMessage` marks `type: "event"` rows `excludedFromMemory` at insert (worker path).
- 2026-09-05 (build): Web/mobile resolve `member_added` user ids to names via the workspace-members/mention-candidates map; unresolvable ids render "a teammate" with the exact sentence still available in `content`.
- 2026-09-05 (review hardening, from CodeRabbit): `postLoopChannelEvent` wraps its channel lookup in try/catch (a lookup failure must not fail an already-committed loop transition); `updateChannel` reads the prior name and updates in one transaction with `FOR UPDATE` (concurrent renames can't snapshot a stale "from"); `announceCreatedResources` acquires the emitter per-emit inside try/catch so a Redis outage can't block durable event rows; collapse chaining in both message-lists breaks at the jump/scroll target id so a searched-for event stays individually rendered and centerable.
