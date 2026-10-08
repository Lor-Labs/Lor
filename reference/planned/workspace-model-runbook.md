# Workspace model runbook: human chat, Lor sessions

> Status: planned 2026-10-08, not started. Implements the locked design in
> `workspace-model.md`; that doc wins on product behavior. Written from two
> read-only research passes (server, clients) on the `onboarding` branch.
> File:line references are as of that date; re-check them before each step.

Execute step by step. Each step is about 300–400 changed lines, leaves
`pnpm run check` and `pnpm run check-types` green, and is reviewed and
committed by Jacob before the next one starts. Nothing is pushed until every
step lands. No tests (see `CLAUDE.md`); verify with check, check-types and live
QA. Jacob runs every `db:push`. Tick each step's boxes as it lands and record
departures in "Deviations".

Order: server foundation, then web, then the features that move into sessions,
then mobile. Mobile is broken between Step 4 and Phase F. That is acceptable
because nothing merges until the whole runbook lands.

## Locked implementation decisions

1. **A session is a table plus a hidden anchor message.** New `agent_session`
   table, 1:1 with an anchor message of new type `agent_session`. Session
   messages are ordinary thread replies under the anchor, so `scopeKey =
   threadRootId` keeps runs, plans, sandboxes (`wbs-{scopeKey}`),
   continuation, read state, rooms, `read_thread` and search working
   unchanged. Precedent: `voice_session` (`packages/db/src/schemas/voice.ts:44-103`).
   The table is not called `session` because better-auth owns that name
   (`sessions.ts:5`); `agent_session` matches `agent_run` and `agent_profile`.
2. **`agent_session` columns:** `id`, timestamps, `workspaceId`, `channelId`,
   `threadRootId` (notNull, unique, FK cascade), `creatorId` (null for loop
   and trigger sessions), `origin` enum (`chat` | `new` | `loop` | `trigger`),
   `title`, `titleEditedAt`, `loopId` (unique where not null), `triggerId`,
   `seed` (typed jsonb: channel id and message ids), `archivedAt`,
   `archivedById`, `lastActivityAt`.
3. **The anchor is blank.** Its author is the starter (Lor for loops and
   triggers), content null. Blank messages without attachments already stay
   out of Lor's context (`apps/worker/src/lib/lor-conversation.ts:48-51`).
4. **One `thread_subscription` table** keyed on `(threadRootId, userId)`. It
   covers sessions, human threads and call chats. Unsubscribe deletes the row,
   and any subscribe trigger adds it back.
5. **No new permission.** Session routes gate on channel access plus a
   workspace match, as `plans/handlers.ts:25` does. Archive follows the
   locked rule: anyone who can type in the session.
6. **Old enum values stay.** `plan_card`, `loop_fire` and `call_summary` stop
   being written but stay in `message_type`; old rows use them and drizzle
   push cannot drop enum values.
7. **Legacy Lor threads are backfilled, never deleted.** Deleting messages
   cascades into `agent_run` (`agent-runs.ts:77-82`) and the permanent
   `agent_run_step` history. Legacy roots stay visible in chat.
8. **Shortcuts:** ⌘N on desktop (only ⌘, is bound today,
   `apps/desktop/src-tauri/src/lib.rs:47`). Web tabs cannot capture ⌘N, so
   "New session" also lives in the ⌘K menu (`workspace-command.tsx:85`) and as
   the sidebar button.
9. **No model picker yet.** The composer's Lor state shows the channel's
   agent profile as a label. A real per-session picker is later work.

## Answered questions (locked with Jacob 2026-10-08)

| Question | Answer |
|---|---|
| Does `@Lor` inside a human thread start a session? | Yes, seeded with that thread. Nothing posts in the thread. |
| Who writes the session title? | Instant title from the prompt's first words at creation. After the first run, the small model (GLM 5.3 Flash, already used for structured decisions) rewrites it unless `titleEditedAt` is set. Not a Lor tool, so no replay-safety registration. |
| Archiving a loop's session | A dismissal only. The loop keeps running, and its next run unarchives the session. Only pausing, cancelling or deleting the loop stops it. |
| Act triggers | One session per run (per coalesced batch, `automation-primitives.md`). |
| Mentions inside sessions | Do not count toward the channel mention badge. They alert on the session row for the mentioned person. |
| A person messages a loop's session while a tick is due | Today the tick silently skips (`sweep-due-loops.ts:156-163`). Queue the tick behind the human turn instead. |
| Share to chat | A person-authored message whose `referencedMessageId` points at the Lor message in the session, rendered as a share card. No schema change. Accepted for now. |

## Hazards

1. **Wrong context on the first run.** Continuation and the conversation
   snapshot read `contextThreadRootId` (`lor-respond.ts:503-526`); when null,
   the run loads the newest 30 channel messages (`lor-conversation.ts:70-86`).
   Write the anchor in the same insert as the session's first message.
2. **Anchors look like chat messages.** They have a null `threadRootId`. Every
   `isNull(threadRootId)` site must also exclude the `agent_session` type
   through one shared helper: `queries/messages.ts:197`,
   `channels/handlers.ts:616,764`, `read-states.ts:47`,
   `lor-conversation.ts:80,121`, `agent-run.ts:635`.
3. **Session activity leaks into chat UI.** Channel unread counts every thread
   reply (`read-states.ts:24-30,160-166,280-284`). The thread-activity dock
   (`api/lib/queries/thread-activity.ts`) and the `message:thread:updated`
   emits (`realtime/src/index.ts:648-652`, `lor-messages.ts:197-206`,
   `lor-respond.ts:233-243`, `scope-runs.ts:104-119`) must skip sessions.
4. **Loop pause would stop nothing.** `stopInFlightRuns` matches
   `scopeKey = loopId` (`api/lib/loops.ts:146-160`); switch to
   `agentRun.loopId`. One-run-per-loop and Act's in-flight guard
   (`act-runs.ts:75,146-148`) also lean on the scope key; replace them with
   partial unique indexes on `loop_id` and `trigger_id` over active states.
5. **Prompt cache.** Loop and Act briefings sit in the system prompt
   (`triggered.ts:152-154,192-194`). As one chained session per loop, every
   fire would bust the cache; move the briefing into the user turn. Never put
   title, seed, state or subscribers in `instructions` (`index.ts:2456`).
6. **Replay safety.** Unbind `post_channel_message` and `create_plan`, but
   keep both names in `RESERVED_TOOL_NAMES` (`custom-tools.ts:48-49`). Any new
   side-effect tool goes in `SIDE_EFFECT_TOOLS` (`tool-guard.ts:29`) too.
7. **Orphan sessions on retry.** Sends dedupe by nonce (`claimMessageDelivery`,
   `clientKey` index `messages.ts:157-159`). Create the anchor and row inside
   that same transaction.
8. **Deleting an anchor deletes the session** (cascade through `message`,
   `plans.ts:51`, `agent-runs.ts:80-82`). `deleteMessage` checks only
   authorship (`realtime/src/services/messages.ts:529-536`); guard by type,
   and guard edits the same way.
9. **Parallel sessions supersede each other's proposals.** A new proposal
   supersedes any pending one in the channel (`change-proposal.ts:85-99`,
   index `change-proposals.ts:314-318`). Make it per session.
10. **DM and voice guards.** The DM check runs after the insert today
    (`realtime/src/index.ts:736-739`). Check DM and voice before creating a
    session, and still let a DM send succeed. The session API rejects DM and
    voice channels. Keep the worker guard (`lor-respond.ts:546-564`) and the
    attachment-indexing guard (`index.ts:710-711`). DMs never get Lor and are
    never indexed.
11. **Act briefing reads other sessions.** It reads every channel message since
    the last run (`act-runs.ts:447-460`). Scope it.
12. **Approvers live in `apps/api`.** "Needs you" for approvals needs the
    approver set (`api/lib/approvals.ts:27-103`, worker `approval-notify.ts`)
    in realtime, which cannot import from `apps/api`. Move it to a package.
13. **Lor's own mentions.** When Lor mentions someone in a reply, the fanout
    (`lor-respond.ts:1060-1095`) must subscribe that person.
14. **Drain the Lor respond queue** before deploying Step 4, the send-path
    cutover.

## Steps

### Phase A: server foundation (no visible change)

#### Step 1: schema and wire types (~250)

[ ] built · [ ] committed · [ ] db:push

- `packages/db/src/schemas/agent-sessions.ts` (new): `agent_session`, origin
  enum, relations. `packages/db/src/schemas/thread-subscriptions.ts` (new).
  Export both from the schema index.
- `packages/db/src/schemas/messages.ts`: `agent_session` on `message_type`.
- `packages/realtime-types/src/events.ts`: message type, `session:updated`
  payload type, `toPeople` on the send payload (`:136-153`).
- Web `message-item.tsx` and mobile `message-row.tsx`: render nothing for the
  anchor type.

#### Step 2: hide anchors, add guards (~250)

[ ] built · [ ] committed

- One shared chat-message filter at every site in hazard 2.
- Delete and edit guards for anchors (hazard 8).
- `realtime/src/services/messages.ts:304-405` `createMessage`: accept session
  roots, reject sends into archived sessions (`:358-382`); the run-queue drain
  re-checks archive.
- `getMessageLocation` returns the session for session messages.

#### Step 3: shared session and run helpers (~350)

[ ] built · [ ] committed

- `packages/lor`: `createSession` (anchor, row, starter subscription, one
  transaction, nonce-safe per hazard 7) and `ensureLoopSession`.
- One `insertAgentRun` replacing the three copies: realtime
  `services/lor.ts:105-148`, worker `run-queue.ts`,
  `api/lib/scope-runs.ts:214-470`.
- One-off backfill script `packages/db/scripts/backfill-agent-sessions.ts`
  (run with `pnpm --filter @repo/db exec tsx scripts/backfill-agent-sessions.ts`,
  documented in its header, not registered in `package.json`): rows for
  distinct `agent_run.threadRootId` and `plan.threadRootId`,
  `on conflict do nothing`.

### Phase B: the core loop on web

#### Step 4: send path (~400, may split)

[ ] built · [ ] committed

- `apps/realtime/src/index.ts:734-1113` `routeLor`: `@Lor` in chat creates a
  session through `createSession`; the prompt becomes the session's first
  message; nothing posts in chat. Seed from `loadRecentChannelMessages`
  (`services/lor.ts:59-83`). Hazards 1, 10, 14.
- Routing inside sessions: plain → Lor; mention of a person only → no Lor;
  reply to a person counts as a mention (`lor-routing.ts` `isReplyToPerson`,
  `packages/messaging/src/index.ts:162-218` `buildMentionTargets`); `toPeople`
  skips Lor and pings nobody.
- `lor-conversation.ts:102-128`: background from `agent_session.seed`.
- Delete: placement block (`index.ts:872-899`), reply window and mute
  (`:774-843`), `services/lor-session.ts`, `isLorThread` (`services/lor.ts:39-55`),
  `packages/lor/src/placement.ts` with its eval harness use
  (`eval/harness.ts:15,176-179`), fixtures and `package.json:25` entry.
- Web: `use-message-sending.ts` keeps an `@Lor` send out of the chat list.

#### Step 5: web session route and view (~400)

[ ] built · [ ] committed

- `apps/api/src/routes/v1/sessions/*` (new, registered at `app.ts:95`):
  `GET /sessions/{id}`.
- `routes/_authenticated/$workspaceSlug/session.$sessionId.tsx` (new).
- Extract `useConversation` from `thread-panel.tsx` (loading/sending
  `:204-246`, reactions/edit/upload/typing `:448-491`, replay/queue/steering
  `:411-446`, open-on-running `:521-548`, scrolling `:550-651`), used by both
  the thread panel and the session view.
- `components/session/session-view.tsx`: header, document-style Lor replies
  (`lor-message-body`, `lor-tool-trail`, `lor-reasoning`,
  `thinking-indicator`), the "From #channel: N messages" seed block, composer.
- `use-lor-stream.ts:207-212`: session cache key. `last-location.ts`: remember
  sessions.

#### Step 6: session rail (~350)

[ ] built · [ ] committed

- Split `thread-work-header.tsx:61-216` (Steps, Files, Activity popovers,
  `ApprovalGateCard`) into a right rail: Plan (`plan-step-list`), Files
  (`artifact-overlay`, `channel-files-panel`), Activity.
- Proposal and approval cards render inline in the session.

#### Step 7: composer states (~400)

[ ] built · [ ] committed

- `composer/message-input.tsx`: destination mode (props `:114-151`), toolbar
  row with the Lor state (agent label, Lor send button) and people state
  (avatars of who gets pinged), the manual destination pill in sessions, the
  animated swap that never moves the text field. Stop and `ContextMeter` only
  in sessions (`:1157-1181`). Placeholder and `lor_intro` copy
  (`:517-526,957-964`). The `draft` param seeds a new session (`:648-686`).
- `use-message-sending.ts`: `@Lor` in a channel starts a session and stays on
  the channel, with a short "Started … · Open" note.
- Reference: `apps/web/src/components/prototype/`.

#### Step 8: sidebar sessions and New session (~400)

[ ] built · [ ] committed

- Server: `realtime/src/services/workspace-activity.ts:10-120` per user, per
  session; `ChannelActivity` (`events.ts:11-14`) carries subscribed sessions
  and the rollup.
- `channel-list.tsx` `SortableChannelItem` (`:1002-1206`): session rows after
  the voice rows (`:1185-1187`). At most 3 per channel, ordered by attention,
  with a "N more" row that expands in place. Collapse toggle: the channel icon
  turns into a chevron only while the pointer is on the icon itself or it has
  keyboard focus, never on row hover. Rollup on the channel row only when
  collapsed. Starting a session in a collapsed channel expands it.
  `channel-activity.tsx` becomes the session state indicator (spinner, blue
  dot, alert); `queued` folds into running. `use-workspace-activity.ts`.
- `workspace-sidebar.tsx:381-457`: New session button.
  `session.new.tsx` (new): empty view, centered prompt, channel picker. ⌘N on
  desktop, ⌘K entry.

#### Step 9: chat cleanup (~300, mostly deletions)

[ ] built · [ ] committed

- `message-item.tsx`: Lor replies and memory chips leave chat (`:698-739,
  757-798`); card branches (`:452-550`) keep only a minimal legacy render;
  `LorRunControls` (`:174-203`) and `lorWaiting` (`:247-258`) go.
- `$channelId.tsx`: approval/proposal/plan subscriptions (`:161-166`),
  replay/queue/steering (`:336-367`), `RunQueuePill` (`:579-585`).
  `message-list.tsx:241,479,486,626` streaming follow.
  `use-channel-messages.ts:271-298` `lorWaiting`.
- `message-action-bar.tsx`: "Ask Lor about this" opens a new session with the
  message attached. `meeting-recording-card.tsx:29-41` does the same.

### Phase C: subscriptions and notifications

#### Step 10: subscription writers and API (~350)

[ ] built · [ ] committed

- Subscribe on start, mention, send, act (approve, answer) and add, plus
  Lor's own mentions (hazard 13).
- Routes: subscribe, unsubscribe, change subscribers.
- `channels/handlers.ts:1184-1221`: subscribers instead of participants.

#### Step 11: subscribed-only notifications (~300)

[ ] built · [ ] committed · [ ] db:push (destructive: drops a column and enum)

- `packages/messaging/src/index.ts:66-113,480-526` and `push.ts:144-199`
  read `thread_subscription`. "Done" pushes go to the starter only.
- Remove `lorThreadNotifications`: `user-notification-settings.ts:17-20,
  39-41,59,67`, `realtime-types notifications.ts:7-23`, `events.ts:430-431,
  462-463`, `notification-settings/handlers.ts:12`.
- Hazard 3 exclusions; session mentions leave the channel badge
  (`read-states.ts:169-180`).

#### Step 12: web subscriber header and settings (~300)

[ ] built · [ ] committed

- Session header: `ThreadSubscriberStack` avatars, Subscribe/Unsubscribe,
  "Change subscribers…" dropdown (⌘⇧S) over the member list from
  `workspace-members-panel.tsx`. Same header on human threads.
- Remove the setting: `notification-settings.tsx:26,41-42,160-185`,
  `use-browser-notifications.ts:28,77,135`.

### Phase D: lists, archive, titles

#### Step 13: archive, titles, needs-you (~400)

[ ] built · [ ] committed

- Server: channel session list (active, archived), archive and unarchive
  (stop via `runs/handlers.ts:300` `requestRunStop`, cancel queued rows),
  rename, generated titles. Approver set moves to a package (hazard 12) so
  "needs you" covers approvals.
- Web: archive bar in place of the composer (precedent `$channelId.tsx:586-605`),
  "Ana archived this session" notice with Unarchive, title rename.

#### Step 14: Sessions view in the right panel (~300)

[ ] built · [ ] committed

- `right-sidebar-types.ts:43-48`: `{ type: "sessions", channelId, filter }`.
  `right-sidebar-panel.tsx:18-23,38-44`, `right-sidebar-context.tsx:68-69`.
- `SessionsListPanel` (new, modeled on `loops-list-panel.tsx`).
  `chat/header.tsx:71-96`: Sessions button.

### Phase E: features move into sessions

#### Step 15: cards, reactions, prompt copy (~300)

[ ] built · [ ] committed · [ ] db:push

- `lor-respond.ts:633-642`: stop posting `plan_card`.
- Proposals: `worker lib/change-proposal.ts:71-110` posts in the session;
  `change_proposal.threadRootId` column; `proposals/handlers.ts:241-251`
  resumes in the session; supersede per session (hazard 9).
- `react_to_message`: same-thread check (`message-actions.ts:143-158`), bound
  on session runs only (`index.ts:2103,2211-2220`).
- Prompt copy for the new model (one cache bust, accepted).

#### Step 16: loops as one session (~400)

[ ] built · [ ] committed · [ ] db:push

- `ensureLoopSession` on fire; `sweep-due-loops.ts:135-166`;
  `api/lib/loops.ts:83-90` scope to the anchor, `:146-160` stop by `loopId`;
  partial unique index on active `loop_id` (hazard 4).
- `loop-run.ts:170-188` (`loop_fire` chip): delete. `:105-118` auto-pause
  note: into the session. Briefing out of the system prompt (hazard 5).
- Creator subscribed at activation; mentions at setup subscribe; "everyone
  in the channel" option.
- Archive is a dismissal: a fire unarchives the loop's session before it
  posts (Step 2 rejects sends into archived sessions, so the unarchive comes
  first). A due tick queues behind a human turn instead of skipping
  (`sweep-due-loops.ts:156-163`).
- Web: loop panel links open the session.

#### Step 17: Act runs in sessions (~350)

[ ] built · [ ] committed · [ ] db:push

- `triggered-run.ts:113-150`, `act-runs.ts:122-151`: one session per run;
  partial unique index on active `trigger_id`; scoped briefing (hazard 11).
- Delete `post_channel_message` and `create_plan` (`triggered.ts:63-98`),
  `worker lib/lor-plan.ts`; rewrite `triggered.ts:132-196`; tool binding
  `index.ts:2112,2308-2318`, `tool-guard.ts:29-30` (hazard 6).

#### Step 18: call Summary tab (~300)

[ ] built · [ ] committed

- Server: `voice-session-memory.ts:141-153` stops posting the card;
  `api/lib/voice/queries.ts:55-78,229`; summary routes keyed by session id.
- Web: `thread-panel.tsx:675-719` tabs become Summary, Chat, Transcript, with
  Summary the default for ended calls. `voice/call-summary.tsx:447-551`
  becomes the tab body. `voice-lobby.tsx:248-275` shows the summary title.
  Widen `callTab` (`right-sidebar-types.ts:17`, `voice-channel-view.tsx:57-59`,
  `use-call-chat-panel.ts`, `use-thread-panel-url-sync.ts`,
  `use-call-citation.ts`).

#### Step 19: onboarding touchpoints and share to chat (~300)

[ ] built · [ ] committed

- `packages/auth/src/lib/workspace-template.ts:21,45`: remove the Lor intro.
- Hints: rewrite `lor_intro`; `lor_reply` moves into sessions with
  `LorActivity` (`lor-activity.tsx:45-73`).
- Setup: `setup.tsx:141-151` Ask Lor opens `session.new` with the draft;
  drop the `@Lor` prefix (`setup-steps.tsx:261`).
- "Share to #channel" on a Lor message in a session.

### Phase F: mobile

#### Step 20: session screen (~400)

[ ] built · [ ] committed

- New session route lifting `components/thread-view.tsx` (526 lines); the
  rail as a sheet (`ThreadWorkHeader` at `:359-366`); seed block; archive bar.

#### Step 21: composer and channel list (~400)

[ ] built · [ ] committed

- `message-composer.tsx`: destination state, copy (`:121-126,434-435,
  494-497,590-595`).
- `components/channel-list.tsx` (`:32-60,181,386-397`): session rows and
  rollup; `hooks/use-workspace-activity.ts`; New session in `(tabs)/index.tsx`.
- Channel screen cleanup: `app/channel/[channelId]/index.tsx:124-132,454-458`,
  `message-row.tsx:189-236,583-600`.

#### Step 22: subscriptions, calls, hints, navigation (~400)

[ ] built · [ ] committed

- Subscriber sheet; remove the setting (`settings/notifications.tsx:28-29,
  109-140,201-208`).
- Summary tab (`voice-lobby.tsx:430-540`, `voice/call-summary-card.tsx`).
- Hints copy (`use-hints.ts`); Ask Lor (`message-action-menu.tsx:43-45,115`,
  `meeting-recording-card.tsx:43`).
- Session navigation from push (`use-push-notifications.ts:103`,
  `lib/push-target.ts`), `(tabs)/index.tsx:259`, `pins.tsx:55,73`.

### Docs

- Move `workspace-model.md` and this runbook to `reference/` root when Step 1
  starts, with a link sweep. Add a `CLAUDE.md` section like the other
  runbooks. Update `mobile-parity-todo.md` in Phase F.
- After the last step: delete the prototype (`apps/web/src/components/prototype/`,
  `apps/web/src/routes/prototype.tsx`). It is a flow reference, not code to
  ship.
- Then: the onboarding redo flagged in `onboarding.md`.

## Size

Research estimate: about 4,250 new, 1,300 modified and 1,400 deleted client
lines, plus the server steps. 22 steps.

## Deviations

None yet.
