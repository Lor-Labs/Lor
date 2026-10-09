# Workspace model runbook: human chat, Lor sessions

> Status: in flight on `app-redesign-sessions`, started 2026-10-08. Implements
> the locked design in `workspace-model.md`; that doc wins on product behavior. Written from two
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
   `archivedAt`, `archivedById`, `lastActivityAt`. The messages a session
   starts with live in `agent_session_context` (`sessionId`, `messageId`, both
   FK cascade, unique pair), written once at session start: exact,
   referentially sound tracking of what went in.
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
10. **The editor stays TipTap** (decided 2026-10-09 after a Plate evaluation;
    `planned/live-collaboration.md`). Sessions render as a document with an
    inline input line (Step 9a); live co-editing is a separate later project.

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

[x] built 2026-10-08 · [x] committed · [ ] db:push

As built: `RealtimeAgentSession` and `session:updated` live in
`realtime-types/src/events.ts`; `toRealtimeAgentSession` and its drift guard
in `packages/lor/src/agent-sessions.ts` (export `@repo/lor/agent-sessions`).
Docs moved to `reference/` root with a `CLAUDE.md` section.

- `packages/db/src/schemas/agent-sessions.ts` (new): `agent_session`,
  `agent_session_context`, origin enum, relations.
  `packages/db/src/schemas/thread-subscriptions.ts` (new).
  Export both from the schema index.
- `packages/db/src/schemas/messages.ts`: `agent_session` on `message_type`.
- `packages/realtime-types/src/events.ts`: message type, `session:updated`
  payload type, `toPeople` on the send payload (`:136-153`).
- Web `message-item.tsx` and mobile `message-row.tsx`: render nothing for the
  anchor type.

#### Step 2: hide anchors, add guards (~250)

[x] built 2026-10-08 · [x] committed

As built (~110 lines): `@repo/db/queries/agent-sessions` holds
`chatFeedMessage()` and `findAgentSessionByThreadRoot()`. The message-location
response gained `sessionId`. `countsAsUnread` also skips anchors.

- One shared chat-message filter at every site in hazard 2.
- Delete and edit guards for anchors (hazard 8).
- `realtime/src/services/messages.ts:304-405` `createMessage`: accept session
  roots, reject sends into archived sessions (`:358-382`); the run-queue drain
  re-checks archive.
- `getMessageLocation` returns the session for session messages.

#### Step 3: shared session and run helpers (~350)

[x] built 2026-10-08 · [x] committed · [ ] backfill run (dev) · [ ] backfill run (prod)

As built (~290 lines): `createSession(tx, args)` and `ensureLoopSession(loop)`
in `packages/lor/src/agent-sessions.ts`. `createSession` takes the caller's
transaction and keeps only context messages from the session's own channel.
Backfill: `packages/db/src/scripts/backfill-agent-sessions.ts`, run after
`db:push` with `--dry-run` first (command in its header).

- `packages/lor`: `createSession` (anchor, row, context rows, starter
  subscription, one transaction, nonce-safe per hazard 7) and
  `ensureLoopSession`.
- One-off backfill script: rows for distinct `agent_run.threadRootId` and
  `plan.threadRootId` in workspace text channels, `on conflict do nothing`;
  the people who wrote in each thread are subscribed.

### Phase B: the core loop on web

#### Step 4: send path (~400, may split)

[x] built 2026-10-08 · [x] committed

As built (+240/−355): `sessionStartFor` (realtime `services/lor.ts`) decides
whether a send starts a session and picks its context (last 10 chat messages,
or a human thread's root and replies) and title. `createMessage` takes
`newSession` and creates the session in its own transaction. The send ack
carries the session, and a new session is announced as `session:updated` to
the channel room. The worker reads `agent_session_context` as background for
anchor-rooted sessions. Web drops `@Lor` sends from the chat list.

- `apps/realtime/src/index.ts:734-1113` `routeLor`: `@Lor` in chat creates a
  session through `createSession`; the prompt becomes the session's first
  message; nothing posts in chat. Context rows from
  `loadRecentChannelMessages` (`services/lor.ts:59-83`). Hazards 1, 10, 14.
- Routing inside sessions: plain → Lor; mention of a person only → no Lor;
  reply to a person counts as a mention (`lor-routing.ts` `isReplyToPerson`,
  `packages/messaging/src/index.ts:162-218` `buildMentionTargets`); `toPeople`
  skips Lor and pings nobody.
- `lor-conversation.ts:102-128`: background from `agent_session_context`.
- Delete: placement block (`index.ts:872-899`), reply window and mute
  (`:774-843`), `services/lor-session.ts`, `isLorThread` (`services/lor.ts:39-55`),
  `packages/lor/src/placement.ts` with its eval harness use
  (`eval/harness.ts:15,176-179`), fixtures and `package.json:25` entry.
- Web: `use-message-sending.ts` keeps an `@Lor` send out of the chat list.

#### Step 5: web session route and view (~400)

[x] built 2026-10-08 · [x] committed

As built: `GET /v1/sessions/{sessionId}` returns the session, its channel,
and its context with mentions resolved to names (same 404 for missing and
forbidden). Web route `/$workspaceSlug/session/$sessionId` renders
`components/session/session-view.tsx`, which reuses `ThreadPanel` through a
`sessionView` prop (session header, "From #channel" block, centered column,
session placeholder). After an `@Lor` send, the channel page shows a "Session
started" toast with Open, until Step 7's composer note replaces it.

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

[x] built 2026-10-08 · [x] committed · [ ] right-panel follow-up committed

As built: the rail is a right-panel view, `{ type: "session-work" }`
(`right-panel/session-work-panel.tsx`, "Details": Plan, Files, Activity), so
it gets the panel's background, resize and collapse. The session page sets
that view on open and clears it on leave, as a channel page does; the header's
`RightPanelToggle` reopens it (`openView` prop). It has its own size class
(`rail`: opens at 320px, resizes up to the normal maximum, remembers its
width). The panel reads the session page's thread query by the same key.
Sessions drop the docked work header. `thread-work-header.tsx` now exports
`useThreadWork` and `WorkFileList`, shared by the header and the panel. Files
merge plan artifacts with the files in Lor's tool calls (so artifacts made
without a plan show too) and the uploads in the loaded messages. The session page keeps approvals and proposals live
(`useChannelApprovals`, `useChannelProposals`), so their cards render inline
under the run's reply. The session route takes `?artifactId` and mounts
`ArtifactOverlay`, so file cards open on the session page.

- Split `thread-work-header.tsx:61-216` (Steps, Files, Activity popovers,
  `ApprovalGateCard`) into a right rail: Plan (`plan-step-list`), Files
  (`artifact-overlay`, `channel-files-panel`), Activity.
- Proposal and approval cards render inline in the session.

#### Step 7: composer states (~400)

[x] built 2026-10-09 · [ ] committed

As built (~400 lines): `MessageInput` takes `destination` (`channel` |
`thread` | `session`). With one, the editor gets its own line and a toolbar
line under it holds attach, `composer/destination-bar.tsx` and send.
`resolveRouting` mirrors the server's session rule from the draft's mention
nodes and the reply target. The Lor state tints the border and send button
in the agent color and shows "New session in #channel", "New session from
this thread" or "To Lor". The people state has a pill only in a session ("To
channel members"); chat and threads already name the destination in the
placeholder. Both show who gets pinged ("Adds" or "Notifies" with avatars). In a
session the pill switches by hand when nothing in the message decides the
destination; the send then carries `toPeople`, and such a send mid-run does
not join the run queue pill. `session/session-started-note.tsx` (the
"Started … · Open" note, 6 s) replaces the toast on the channel page and also
shows after `@Lor` in a human thread. DMs and call chats keep the old
single-line composer. New placeholder and `lor_intro` hint copy.

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

Split in two. 8a: [x] built 2026-10-09 · [x] committed (server state and
sidebar rows). 8b: [x] built 2026-10-09 · [ ] committed (New session button
and view, ⌘N, ⌘K, `last-location`).

As built (8b, ~440 lines): the send payload's `startSession` flag starts a
session (origin `new`, no context) from `/session/new`, and realtime rejects
a `startSession` send it cannot honor instead of posting it in chat. A
message that starts a session always runs Lor, even when it mentions people.
`session/new-session-view.tsx` reuses `MessageInput` with destination `new`
(always the Lor state) and a channel picker in the destination bar, defaulting
to `?channelId`, then the last channel, then the first text channel; on the
ack it opens the session. Entry points share `useOpenNewSession`: the sidebar
row (`new-session-button.tsx`), a ⌘K "Lor" group, and a desktop File menu item
"New Session" (Cmd+N) that emits `new-session`. `last-location.ts` remembers
the last session (and its channel); visiting a channel replaces it; a session
that fails to load is forgotten. Both landing routes open the last session
first.

As built (8a, ~410 lines): `getWorkspaceActivity` also returns, per channel,
the caller's subscribed, unarchived sessions (`SidebarSession`: title, state,
loop flag, last activity; capped at 200, newest first). State per session:
`needs_you` (a pending approval, or a plan waiting for input or approval, in
the session), `running` (an active run; queued folds in), `unread` (a message
from someone else, or a run change, after the user's `thread_read_state`
cursor; with no cursor only the last 7 days count), `idle`. Realtime emits
`workspace:activity:updated` when a session is created or posted in; web
also refreshes on `thread-read:updated`. The thread panel marks read when the
newest reply's status changes, so a reply that finishes while open is read.
Web: `channel-sessions.tsx` (rows, "N more", collapse remembered per device
in localStorage, auto-expand when a new session appears in a collapsed
channel) and `SessionStateIndicator` in `channel-activity.tsx`, which
replaces `LorChannelStatus`.

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

#### Step 9a: session document view (~130)

[x] built 2026-10-09 · [ ] committed · [ ] db:push (follow-up: `message.routed_to_lor`)

Added 2026-10-09 (Jacob, after Delta DB's inline threads): a session reads as
a document, not a chat thread, so it feels unlike a regular chat app. Rendering
only; no CRDTs (a shared draft could become a block later). The editor stays
TipTap.

As built: `MessageItem` takes `layout="document"`: the first message of each
turn has a 28px avatar in the gutter (Lor's mark too), no name row (name and
time on the avatar's hover), document prose (15px, leading 7) for everyone,
and no row hover fill. The session's input line is the transcript's last
child: `MessageInput variant="inline"` with the writer's avatar as `gutter`,
no box, same column and prose size. It follows the last turn and is never
pinned: you scroll to the end to reach it, like a document (Jacob rejected a
sticky version that floated over the transcript). It has no placeholder, and
typing a printable key anywhere outside another field or open dialog focuses
it, types the key and scrolls to it (`MessageInput onTypeToFocus`). Its tools
(attach, destination, context meter, stop/send) render through a portal
(`toolbarTarget`) into a bar under the scroller, like an editor status bar.
The transcript starts at the top. Only the writer's own avatar shows at the
input line; others appear through the typing indicator, never as presence
(the no-surveillance rule).

Follow-up (2026-10-09): tighter rhythm (12px between turns, 15px/24px prose
pinned on the inner `.prose`, avatar aligned to the first line, reply curve
from the gutter avatar). Messages for channel members only render muted, with
no label (Jacob: show it, don't say it); the inline input line dims the same
way while it is headed to people, which teaches the rule. To show this on past
messages the route is stored: new nullable `message.routed_to_lor` (db:push),
set by `createMessage` from `sessionMessageRunsLor` in `lor-routing.ts` (the
one copy of the session rule; null outside sessions and on Lor's messages).
The realtime send handler reads the stored value instead of recomputing.

#### Step 9: chat cleanup (~300, mostly deletions)

[x] built 2026-10-09 (narrowed, see Deviations) · [ ] committed

As built (~400 lines): the channel page drops the channel-scope run queue,
steering and `RunQueuePill` (chat messages never route to Lor). Thread
footers lose the `lorWaiting` badge (the sidebar's session row shows it).
Opening a thread Lor took part in resolves its location and opens the
session page when it is one (backfilled legacy threads);
`useMessageIdNavigation` (Lor citations) does the same via the location's
`sessionId`. "Ask Lor about this" is a Lor button in the message action bar
on text-channel chat: it opens `/session/new?channelId&about=<id>`, which
shows an "About" row, fixes the channel, hides the examples, and sends
`startSession` with the message in `referencedMessageId`; `sessionStartFor`
makes it the session's one context message. The meeting card's Ask buttons
open the same view with `draft` prefilled.

- `message-item.tsx`: Lor replies and memory chips leave chat (`:698-739,
  757-798`); card branches (`:452-550`) keep only a minimal legacy render;
  `LorRunControls` (`:174-203`) and `lorWaiting` (`:247-258`) go.
- `$channelId.tsx`: approval/proposal/plan subscriptions (`:161-166`),
  replay/queue/steering (`:336-367`), `RunQueuePill` (`:579-585`).
  `message-list.tsx:241,479,486,626` streaming follow.
  `use-channel-messages.ts:271-298` `lorWaiting`.
- `message-action-bar.tsx`: "Ask Lor about this" opens a new session with the
  message attached. `meeting-recording-card.tsx:29-41` does the same. Built on
  Step 8b's New session view: it takes the message id (search param) and the
  `startSession` send carries it as the session's one context message
  (today `startSession` starts with no context).

### Phase C: subscriptions and notifications

#### Step 10: subscription writers and API (~350)

[x] built 2026-10-09 · [ ] committed

As built (~320 lines): one writer, `subscribeToThread` in
`@repo/db/queries/thread-subscriptions` (Lor filtered out, idempotent), used
by: `createSession` (starter + mentioned); realtime `createMessage` (writing
in any thread subscribes you, and the first reply also subscribes the root's
author, who started the thread); `buildMessageFanout` in `@repo/messaging`
(direct mentions in a thread, for people's and Lor's messages alike, which
covers hazard 13; broadcasts never subscribe); approval resolve (the
resolver). Routes in `routes/v1/thread-subscriptions`: GET/PUT/DELETE
`/workspaces/{slug}/channels/{channelId}/threads/{threadRootId}/subscribers[/{userId}]`,
gated like thread read (real root in the workspace channel, caller sees the
channel; adding someone also requires that they see it). Changes refresh the
sidebar through `notifyWorkspaceActivity`.

- Subscribe on start, mention, send, act (approve, answer) and add, plus
  Lor's own mentions (hazard 13).
- Routes: subscribe, unsubscribe, change subscribers.
- `channels/handlers.ts:1184-1221`: subscribers instead of participants.

#### Step 11: subscribed-only notifications (~300)

[x] built 2026-10-09 · [ ] committed · [ ] db:push (destructive: drops
`user_notification_settings.lor_thread_notifications` and the
`lor_thread_notification` enum)

As built (~350 lines, mostly deletions): `buildMessageFanout` reads a
thread's followers from `thread_subscription` (plus call participants for
call chats) and sets one server-decided flag per recipient, `notify`, which
replaces `isLorThread`/`isSubscribedToThread` and the client-side preference:
channel messages notify everyone; thread and session messages, Lor's
included, notify only subscribers. Session messages
reach only the people they notify, with `unreadCountDelta: 0`. Push and web
browser notifications obey `notify`; direct mentions still always push.
Unread, mention and thread-summary payloads carry `sessionId`: the web and
mobile mention badges skip session mentions, the web thread-activity dock
skips session threads, browser notifications for sessions open the session
and are suppressed while it is on screen. Server badge counts
(`read-states.ts`) and the dock seed (`thread-activity.ts`) exclude session
replies and mentions. The setting is gone from the DB, API, web settings and
mobile settings.

- `packages/messaging/src/index.ts:66-113,480-526` and `push.ts:144-199`
  read `thread_subscription`. "Done" pushes go to all subscribers.
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
  `use-browser-notifications.ts:28,77,135`. (Done in Step 11.)
- Being added as a subscriber notifies you like a mention (from Step 10).

### Phase D: lists, archive, titles

#### Step 13: archive, titles, needs-you (~400)

[ ] built · [ ] committed

- Server: channel session list (active, archived), archive and unarchive
  (stop via `runs/handlers.ts:300` `requestRunStop`, cancel queued rows),
  rename, generated titles. Approver set moves to a package (hazard 12) so
  "needs you" covers approvals.
- Web: archive bar in place of the composer (precedent `$channelId.tsx:586-605`),
  "Ana archived this session" notice with Unarchive, title rename. With the
  document view (Step 9a) the bar replaces both the inline input line and the
  tools bar under the scroller.

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
  Details panel (context, plan, files, activity) as a sheet, not a block in
  the transcript (`ThreadWorkHeader` at `:359-366`); archive bar.
- The document look from Step 9a: one avatar per turn in a gutter, no name
  rows, document prose, and the input line as the transcript's last line
  (native composer; `planned/live-collaboration.md` keeps the chat composer
  native).

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

- [x] Move `workspace-model.md` and this runbook to `reference/` root when
  Step 1 starts, with a link sweep. Add a `CLAUDE.md` section like the other
  runbooks. (Done in Step 1.)
- [ ] Update `mobile-parity-todo.md` in Phase F.
- After the last step: delete the prototype (`apps/web/src/components/prototype/`,
  `apps/web/src/routes/prototype.tsx`). It is a flow reference, not code to
  ship.
- Then: the onboarding redo flagged in `onboarding.md`.

## Size

Research estimate: about 4,250 new, 1,300 modified and 1,400 deleted client
lines, plus the server steps. 22 steps.

## Deviations

- Step 1: `toRealtimeAgentSession` and its wire guard landed in Step 1 instead
  of Step 3, so the wire type is checked from the start.
- Step 1: `agent_session` relations cover workspace, channel, anchor and loop
  only. The user foreign keys (`creatorId`, `archivedById`) have no relations,
  matching `voice_session`. Add them when a query needs them.
- Step 1: the planned `seed` jsonb column became the `agent_session_context`
  join table (Jacob, 2026-10-08), for exact, foreign-keyed tracking of the
  messages a session starts with. Sessions with no context (New session,
  loops, triggers) have no rows.
- Step 2: `markThreadRead` (`channels/handlers.ts:764`) keeps its plain
  `isNull(threadRootId)`. It finds thread roots, and anchors are thread roots
  that need read state. Hazard 2 listed it by mistake.
- Step 2: reactions on anchors are rejected too, not only delete and edit.
- Step 3: no shared `insertAgentRun`. There are 8 run inserts, not 3, each
  setting different fields (loop, trigger, schedule, voice). Sessions don't
  need them merged: Step 4 reuses realtime `createAgentRun`, and Steps 16 and
  17 change the loop and trigger inserts anyway.
- Step 3: the backfill lives in `packages/db/src/scripts/` with the other
  one-off scripts, not `packages/db/scripts/`.
- Step 4: `@Lor` in a human thread also starts a session (answered question),
  seeded with that thread. A session start drops a quoted reply and adds the
  quoted message to the context instead.
- Step 4: in channel chat only an `@Lor` mention starts a session. Replying to
  an old Lor chat message no longer runs Lor.
- Step 4: backfilled (legacy) sessions have no context rows, so the worker
  keeps the old "chat before the root" background for them.
- Step 4 open items: mobile still shows an `@Lor` chat send until Phase F;
  Lor's prompt still describes channel replies until Step 15.
- Step 5: no `useConversation` extraction. The session page reuses
  `ThreadPanel` with a `sessionView` prop, since a session is a thread and the
  panel already handles streaming, replay, queue, steering, stop, reactions,
  uploads and typing. `use-lor-stream` needed no change: sessions use the
  thread cache key. Remembering sessions in `last-location.ts` moves to
  Step 8, when sessions are reachable from the sidebar.
- Step 6: the rail has no approval card. Every approval belongs to a run, so
  `MessageApprovalCard` already shows it inline under the run's reply; the
  thread header's copy would show it twice. "Live computer" is the Activity
  section (the newest run's tool trail) until a sandbox view exists.
- Step 6: the first build (commit 98e92ce7) put a fixed rail inside the
  session page. Jacob wanted the existing right panel instead, for its
  background, resizing and collapse, so the rail moved into a right-panel
  view in a follow-up.
- Step 6 follow-up: the "From #channel" context block left the top of the
  transcript, and the session no longer quotes the context messages (Jacob:
  both looked wrong). The Details panel's first section, Context, is one link
  row ("#general · N messages") that jumps to the newest context message in
  its channel or thread (`useMessageIdNavigation`). The session API's context
  entries shrank to `{ id, createdAt }`; the author, text and mention
  resolution went. The panel view carries `sessionId` and reads
  `useAgentSession`. The design doc's item 8 was updated to match.
- Step 6 open item: the artifact viewer's "Open conversation" still opens the
  channel page with the thread panel, not the session.
- Step 7: no agent label in the Lor state. The effective profile resolves
  channel, then category, then workspace default on the server; the client
  has no resolved name. It comes with the real model picker.
- Step 7: the destination bar also covers human threads ("New session from
  this thread"), and the Started note shows there too; before this, `@Lor`
  in a thread made the message vanish with no feedback.
- Step 7: the `draft` param needed no change. It already fills the channel
  composer with `@Lor …`, which now shows the Lor state and starts a session
  on send. Step 19 still moves setup's Ask Lor to `session.new`.
- Step 7: the `lor_intro` hint and placeholder copy changed here, so Step 19
  only revisits `lor_reply`.
- Step 8a: the web channel row no longer shows channel-wide Lor activity
  (`ChannelActivity.lor`), only the rollup of your sessions when collapsed.
  Until Steps 16 and 17 make loop and Act runs sessions, their activity is
  not on the web sidebar. Mobile still reads `lor`.
- Step 8a: `agent_session.lastActivityAt` is not maintained; the sidebar
  computes the latest reply per session in its query. Step 14's channel list
  may need the column kept up to date instead.
- Step 8b: the sidebar row shows "⌘N" only in the desktop app; in a browser
  ⌘N opens a new window, so the web uses the row and ⌘K.
- Step 8b: the New session view follows Linear's agent screen (Jacob): no
  heading, a large faint Lor mark behind a taller "Ask Lor…" prompt, a filled
  round send button, and a dismissible "Get started with some examples" row
  whose examples fill the prompt. It is the first pass at the teaching moment
  that replaces the `#general` intro (Step 19, and the onboarding redo).
- Step 7 open item: a backfilled (legacy) session opened in the thread panel
  gets the human-thread bar, but the server treats it as a session (plain
  messages run Lor). Opening session roots on the session page fixes it
  (Step 8 or 9). Mostly closed in Step 9: thread footers and Lor citations
  open the session page. Still open: search results and `?threadId` deep
  links (notifications) open the thread panel, since they carry no session id.
- Step 9 narrowed: Lor's reply rendering stays in `message-item.tsx`, because
  sessions render through it (Step 9a). Loop and Act runs still answer in chat
  until Steps 16–17, so these stay until a cleanup after Step 17: chat
  `LorRunControls`, `useLorRunReplay` on the channel page, `message-list.tsx`
  streaming follow, and the channel page's approval and plan subscriptions.
  Proposal subscriptions stay until Step 15 moves proposals into sessions.
  `use-channel-messages.ts` still copies `lorWaiting` into thread summaries
  (the server still sends it); only the badge went.
- Step 10: the thread endpoint's `participants` (authors + plan creator)
  stays; Step 12's header reads the new subscribers route instead. Being
  added notifies like a mention: that lands with notifications (Step 11).
  Answering Lor's question subscribes through the send path, not a separate
  writer. Not covered: a mention added by editing a message
  (`syncMessageMentions`), and proposal resolutions (Step 15 moves proposals
  into sessions).
- Step 11: removing the setting changed its types, so the web and mobile
  settings screens lost it here instead of in Steps 12 and 22. The obsolete
  `apps/realtime/src/lor-notifications.test.ts` (it tested the removed
  `shouldNotifyForLorThread`) was deleted. `message:thread:updated` emits for
  sessions were kept rather than skipped at their ten call sites: the summary
  carries `sessionId` and the dock ignores sessions, while old Lor threads
  still visible in chat keep live footers. Human-thread replies still count
  toward the channel unread badge (unchanged); only sessions left it.
