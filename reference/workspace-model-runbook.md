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
   `agent_run_step` history. Legacy roots stay in the database; since
   2026-10-10 (Jacob, QA pass) chat hides them, along with every old
   Lor-authored chat post: `chatFeedMessage()` leaves out Lor's messages and
   any message that is a session's root, and the channel unread count
   (`countsAsUnread`) follows it.
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

[x] built 2026-10-08 · [x] committed · [x] db:push (dev)

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

[x] built 2026-10-08 · [x] committed · [x] backfill run (dev, 2026-10-10) · [ ] backfill run (prod)

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
(`right-panel/session-work-panel.tsx`, "Details": Context, Plan, Files; the
Activity section was removed 2026-10-09, since tool activity shows on Lor's
replies in the session), so
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

[x] built 2026-10-09 · [x] committed

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
sidebar rows). 8b: [x] built 2026-10-09 · [x] committed (New session button
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
  the voice rows (`:1185-1187`). At most 3 per channel, ordered by attention
  (changed 2026-10-10, Jacob: newest activity first, whatever the state),
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

[x] built 2026-10-09 · [x] committed · [x] db:push (dev; follow-up: `message.routed_to_lor`)

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

[x] built 2026-10-09 (narrowed, see Deviations) · [x] committed

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

[x] built 2026-10-09 · [x] committed

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

[x] built 2026-10-09 · [x] committed · [x] db:push on dev (destructive: drops
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

[x] built · [x] committed

As built (~450 lines): `ThreadSubscribers` (`components/chat/thread-subscribers.tsx`,
replacing `thread-subscriber-stack.tsx`) sits in the session header and the
thread panel header: a Subscribe/Unsubscribe text button and the subscriber
avatars, which open a Base UI combobox ("Change subscribers…", ⌘⇧S) with a
search field and Linear-style checkbox rows over the channel's people
(`useChannelPeople`, split out of `use-mention-candidates.ts`). Row order is
frozen while the picker is open. `useThreadSubscribers` reads the Step 10
route, writes optimistically, and refetches on `message:thread:updated` for
the thread and on `workspace:activity:updated`. `subscribeToThread` now
returns the newly subscribed ids; the add route uses that to send
`notification:subscribed` to the user room plus `sendSubscribedPush` (mute
and "nothing" level respected, like a mention). Web shows "Ana added you to a
session" and opens the session or thread; mobile gets the push only and opens
the thread (no in-app handling until Step 22). Unsubscribing drops the
session from your sidebar (the sidebar query inner-joins
`thread_subscription`). Call chats show the control too, but their call
participants are still notified even after unsubscribing.

- Session header: `ThreadSubscriberStack` avatars, Subscribe/Unsubscribe,
  "Change subscribers…" dropdown (⌘⇧S) over the member list from
  `workspace-members-panel.tsx`. Same header on human threads.
- Remove the setting: `notification-settings.tsx:26,41-42,160-185`,
  `use-browser-notifications.ts:28,77,135`. (Done in Step 11.)
- Being added as a subscriber notifies you like a mention (from Step 10).

### Phase D: lists, archive, titles

#### Step 13: archive, titles, needs-you (~400)

[x] built · [x] committed

- Server: channel session list (active, archived), archive and unarchive
  (stop via `runs/handlers.ts:300` `requestRunStop`, cancel queued rows),
  rename, generated titles. Approver set moves to a package (hazard 12) so
  "needs you" covers approvals.
- Web: archive bar in place of the composer (precedent `$channelId.tsx:586-605`),
  "Ana archived this session" notice with Unarchive, title rename. With the
  document view (Step 9a) the bar replaces both the inline input line and the
  tools bar under the scroller.

Split in two. **13a built** (archive, unarchive, rename): one route,
`PATCH /v1/sessions/{sessionId}` `{ title?, archived? }`, gated on channel
write access. A rename sets `titleEditedAt`. Archiving sets
`archivedAt`/`archivedById` and stops the thread's active runs through
`requestRunStop` (now exported from `runs/handlers.ts`). It does not cancel
queue rows: the queue drain already rejects them for archived sessions
(`run-queue.ts`). Every change emits the existing `session:updated` to the
channel room plus workspace activity. Web: `useAgentSessionUpdates` patches
the session query from `session:updated`; the header title is click-to-rename
(Enter or blur saves, Escape cancels, read-only when archived); an archive
icon asks for confirmation only while Lor is running (`SessionPresentation.header`
is now a render function that receives `lorRunning`); an archived session
swaps the input line and tools bar for an "Archived by Ana · Unarchive" bar
(`SessionPresentation.archivedBar`). Sidebar session rows also archive on
hover (Codex-style; Jacob's ask): the state indicator gives way to an
archive button, the row hides at once and comes back if the request fails,
and a running session confirms first (`ArchiveSessionDialog`, shared with the
header). Archiving the session you're in (header, or its sidebar row) takes
you to the channel's chat (Jacob's call); teammates who have it open stay and
see the bar. Every archive shows a "Session archived" toast with Undo. Everything is optimistic through the React Query cache (Jacob's
ask): `use-workspace-activity.ts` is now a query
(`["workspace-activity", workspaceId]`) fetched over the same
`workspace:activity` socket ack, with **no polling**. Pushes
(`workspace:activity:updated`, `thread-read:updated`), socket reconnects and
app refocus refetch it, coalesced over 100 ms. Pushes refetch in the
background too (Jacob's call), so refocusing never replays a burst of
changes; the refocus fetch is only a check.
Session changes run under the `["sidebar-session"]` mutation key and patch
both the session query and the sidebar query (`patchSidebarSession`: hide,
show, rename); pushes wait while one is in flight, and the last to settle
refetches the truth (`settleSidebarSessions`), which also undoes a failed
one. Unarchive shows the row again only if you subscribe; following or
leaving a session from its header moves its row too. Push audit for dropping
the poll: run transitions, plans, approvals, session posts, subscribe,
archive and rename all emit; channel access changes (leaving a private
channel) do not, and refocus covers them.

**13b built** (generated titles, needs-you): `generateSessionTitle`
(`packages/lor/src/session-title.ts`, small model, 2–6 words, usage tool
`session.title`) runs from `lor-respond` after Lor's first completed run in a
`chat` or `new` session (`apps/worker/src/lib/session-title.ts`). It reads the
first human message and Lor's reply, skips loops, triggers, archived and
renamed sessions, and writes with `titleEditedAt is null` so a rename made
during generation wins. Then `session:updated` + workspace activity. Web:
`TypewriterText` types out only Lor's titles (Jacob's call): a change while
`titleEditedAt` is null (`SidebarSession.titleEdited` in the sidebar) types in
the session header and sidebar rows; any person's rename, yours or a
teammate's, shows at once. On the session page,
`session:updated` patches the sidebar query too (after cancelling any
in-flight sidebar fetch) in the same tick as the header, so both type
together; the sidebar refetch that follows finds the same title. Changed
2026-10-10 (Jacob, QA pass: no typewriter away from the session): the title
job also sends `session:updated` to every subscriber's user room, and the
sidebar's activity provider applies it (`useWorkspaceSessionUpdates`), so the
title types out in the sidebar wherever you are and an open-later session
page shows it without waiting for its cache to go stale. "Needs you" in
`workspace-activity.ts`: a plan waiting for input marks every subscriber
(anyone can answer); a pending approval marks only people who may resolve it
(`approvalResolverSpecFor` in `@repo/auth/permissions` + `canResolveApproval`,
owner fallback for a dangling resolver). The API and worker still carry
their own copies of the resolver fallback.

#### Step 14: Sessions view in the right panel (~300)

[x] built · [x] committed

- `right-sidebar-types.ts:43-48`: `{ type: "sessions", channelId, filter }`.
  `right-sidebar-panel.tsx:18-23,38-44`, `right-sidebar-context.tsx:68-69`.
- `SessionsListPanel` (new, modeled on `loops-list-panel.tsx`).
  `chat/header.tsx:71-96`: Sessions button.

As built (~450 lines): `GET /v1/channels/{channelId}/sessions?archived=`
(sessions router; channel access gate) returns everyone's sessions, active by
latest activity or archived by archive time, capped at 100 (no paging yet),
each with creator, loop flag, `running`, `subscribed` and `titleEdited`.
`useChannelSessions` keys `["channel-sessions", channelId, filter]` and
refetches on workspace activity unless a session change is in flight. The
compact `sessions` view: header with a New session button, Active / Archived
filter pills, rows (creator avatar or loop icon, title, "Ana · 2h"), a Lor
spinner when running, and a hover archive or unarchive button (running
sessions confirm). `useUpdateAgentSession` also patches the open lists
(archive moves the row out; rename retitles it) and refetches them when it
settles. Entry points (Jacob's call, it's an occasional action): "View
Sessions" in the sidebar channel's "..." menu and in a new "..." menu at the
right corner of the channel header, both through `useOpenChannelSessions`,
which navigates to the channel with `?panel=sessions`; `useThreadPanelUrlSync`
applies it after its own mount view and drops the param. Text channels only.
Opening a session from the list never subscribes you. The `subscribed` field is returned but not shown yet.

### Phase E: features move into sessions

#### Step 15: cards, reactions, prompt copy (~300)

[x] built · [x] committed · [x] db:push (dev)

As built (~200 lines): `lor-respond` no longer posts a `plan_card`; a
session's plan has no `cardMessageId` and shows in the Details panel (loop
and Act plans in `lor-plan.ts` still post cards until Steps 16–17).
`change_proposal.thread_root_id` (new, cascade) records the session; the
card posts in the session (`postLorMessage` with `threadRootId`), supersede
is scoped to the session (or to the channel for rows without one), and the
pending unique index splits in two: `changeProposal_session_pending_uidx`
(per `thread_root_id`) and `changeProposal_channel_pending_uidx` (per channel
where `thread_root_id is null`). **db:push**: adds the column and the session
index, recreates the channel index with the new filter. Resolving posts in
the session, continues Lor there, and subscribes the resolver;
`ProposalNotification.threadRootId` lets the phone push open the session.
`react_to_message` is bound only on runs with a `threadRootId` (not voice)
and only reacts to replies in that thread. Prompt copy (the one cache bust):
a "Where you work" paragraph on sessions, people-to-people messages as
context, "other sessions" in place of "other threads", proposal results
"arrive in the same conversation", and plan tools no longer promise a card.
Card messages inside a session now use the document layout (gutter avatar,
no name row). Open: proposals don't raise "needs you" for approvers yet (they
get the directed notification); the loop card and loop/Act runs still live
in chat until Steps 16–17, so the "Where you work" paragraph is briefly
loose for them; the channel page's proposal subscription stays for older
cards in chat.

- `lor-respond.ts:633-642`: stop posting `plan_card`.
- Proposals: `worker lib/change-proposal.ts:71-110` posts in the session;
  `change_proposal.threadRootId` column; `proposals/handlers.ts:241-251`
  resumes in the session; supersede per session (hazard 9).
- `react_to_message`: same-thread check (`message-actions.ts:143-158`), bound
  on session runs only (`index.ts:2103,2211-2220`).
- Prompt copy for the new model (one cache bust, accepted).

#### Step 16: loops as one session (~400)

[x] built · [x] committed · [x] db:push (dev)

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

Split in two. **16a built** (server: a fire is a session turn; db:push adds
`loop_run` to `channel_event_type`). The sweep and "Run now" both enqueue the
loop job (`LoopRunJobData` is now `{ loopId, scheduledFor? }`; a pre-session
job's `runId` is cancelled). Its processor calls `fireLoop`
(`apps/worker/src/lib/loop-session.ts`): `ensureLoopSession` (creates or
unarchives), skips if the loop's own run is still active, posts a silent
`loop_run` event line ("The loop "X" ran on schedule") into the session, then
starts a normal Lor run for it through `startScopeRun` (pulled out of the
queue drain in `run-queue.ts`, scopeKey = the anchor, `loopId` and
`scheduledFor` set) or queues it behind a person's turn. `lor-respond` reads
`loadLoopRun`: every run in a loop's session gets `ctx.loop` (the loop's brief
via `loopSessionPromptSection`, stable per loop so cache-safe, plus
`complete_loop` when there is an end condition); a fire run is tagged with
`loopId` (`markLoopFireRun`, for drained fires), skipped if the loop stopped,
gets no `propose_loop`/`propose_workspace_change`, and settles the loop's
failure count through `settlePlan` (`settleLoopRun`, auto-pause note into the
session; the dead-run sweep calls it too). The loaders read `loop_run` lines
as the "Loop schedule" speaker, and continuation deltas include them though
Lor authored them. Pause stops runs by `agentRun.loopId`. Deleted: the
headless loop path (`runUnattended` for loops, `post_channel_message`/
`create_plan` for loops, the chat `loop_fire` chip, `loopRunBriefing` and
`packages/lor/src/loop-runs.ts`, `loopPromptSection`). The propose_loop draft
card now posts in the session it was asked in, and activating it makes that
session the loop's session (`adoptCardSession` in `api/lib/loops.ts`, run by
the activate handler), so fires land in the conversation where the loop was
set up instead of a second session. A session holds one loop; a second loop
set up there, or a loop created by a change proposal, gets its own session. Web renders event replies in a
session with `ChannelEventRow` (document gutter). Deviations: no partial
unique index on `loop_id` — one session per loop makes the existing
one-active-run-per-scope index enforce one run per loop; loop sandboxes key
on the session thread, not `loop.id`; the run-chain briefing is gone (the
session transcript and continuation carry earlier runs).

**16b built** (no db:push): activation calls `openLoopSession`
(`api/lib/loops.ts`): adopts the card's session or creates the loop's
session right away (`ensureLoopSession`), and subscribes the creator and the
activator, so it is in their sidebars before the first run. Mentions at setup
need nothing new: the loop's session is the setup session, and mentions in a
session already subscribe. "Everyone in the channel" is
`POST …/threads/{threadRootId}/subscribers/everyone` (channel audience, bots
out, no per-person "added you" notification), offered as an "Everyone in
#channel" row in the "Change subscribers…" picker of any session or thread,
optimistic like the rest. The loop panel gets an "Open session" header button;
`GET /loops/{id}/runs` returns `sessionId` and per run `inSession`, and a
run's `note` falls back to its reply in the session, so history rows preview
the reply and open the session (legacy headless runs still expand their
handoff note). Opening the session lands at its latest turn; jumping to one
run's reply is not built.

#### Step 17: Act runs in sessions (~350)

[x] built · [x] committed · [x] db:push (dev)

- `triggered-run.ts:113-150`, `act-runs.ts:122-151`: one session per run;
  partial unique index on active `trigger_id`; scoped briefing (hazard 11).
- Delete `post_channel_message` and `create_plan` (`triggered.ts:63-98`),
  `worker lib/lor-plan.ts`; rewrite `triggered.ts:132-196`; tool binding
  `index.ts:2112,2308-2318`, `tool-guard.ts:29-30` (hazard 6).

**Built** (db:push adds `trigger_run` to `channel_event_type` and the index
`agent_run_triggerId_active_uidx`). Act runs are still created where they
were (the API's leading edge, the worker's window flush), with `scopeKey =
triggerId` and their deliveries claimed. The triggered-run processor no
longer runs them headless: after the kill switch, `startActSession`
(`apps/worker/src/lib/trigger-session.ts`) creates a session (origin
`trigger`, title = the event label), posts a silent `trigger_run` event line
whose content is the payload (`eventPayload` = `{ triggerId, label }`), and
moves the queued run into the session through `startScopeRun`'s new
`queuedRunId` (placeholder, scopeKey = the anchor, respond job). A retried job
never makes a second session: it skips a run that is already placed, and the
start never throws to BullMQ. `lor-respond` reads `loadTriggerRun`: every run
in the session gets `ctx.trigger` (the instructions via
`triggerSessionPromptSection`, stable per trigger); the event's run gets no
`propose_loop`/`propose_workspace_change`, its briefing is appended to the
event turn (so it is saved in the run's context and replayed unchanged by
later runs, never in the system prompt), and its reply is saved as the
`handoffNote` for the next event's briefing and the settings "last run" row.
The briefing reads channel chat only (`chatFeedMessage()`), never sessions
(hazard 11). The loader reads `trigger_run` lines with the event label as the
speaker. Generated titles now cover Act sessions too (the event is the
request). Web and mobile render the line as "<label> started this session";
the Act toggle copy says each event starts a session. Deleted:
`runUnattended` (only `cancelPendingRun` stays in `unattended-run.ts`),
`lib/lor-plan.ts`, the `post_channel_message`/`create_plan` tools and their
binding, `ctx.sandboxKey`; both names stay in `RESERVED_TOOL_NAMES` and left
`SIDE_EFFECT_TOOLS` (hazard 6). Deviation: the design did not say who follows
an Act session. The person who connected the source (`integration_connection.
created_by`) is subscribed when they can see the channel; Lor's prompt says
to mention anyone else, and its mentions subscribe them. Not built: a way to
see the raw payload in the session (only Lor reads it).

#### Step 18: call Summary tab (~300)

[x] built 2026-10-09 · [x] committed

- Server: `voice-session-memory.ts:141-153` stops posting the card;
  `api/lib/voice/queries.ts:55-78,229`; summary routes keyed by session id.
- Web: `thread-panel.tsx:675-719` tabs become Summary, Chat, Transcript, with
  Summary the default for ended calls. `voice/call-summary.tsx:447-551`
  becomes the tab body. `voice-lobby.tsx:248-275` shows the summary title.
  Widen `callTab` (`right-sidebar-types.ts:17`, `voice-channel-view.tsx:57-59`,
  `use-call-chat-panel.ts`, `use-thread-panel-url-sync.ts`,
  `use-call-citation.ts`).

As built (no db:push): the after-call job no longer posts a `call_summary`
card. It saves the summary and calls `notifyVoicePresence`, so past-call
lists and open Summary tabs refetch. `GET`/`PUT
/v1/voice/sessions/{sessionId}/summary` replace the card routes; the
response adds `processed` (`memoryProcessedAt` is set), and editing needs a
processed call, so the job never overwrites an edit. A save also notifies.
`GET /voice/summary-cards/{messageId}` stays for phones (old cards, Step
22); its PUT is gone (only web used it). The thread response gains
`voiceSessionEnded`. Web: `CallTab` = summary | chat | transcript; an unset
tab means Summary for an ended call, else Chat; Summary shows only once the
call has ended. `CallSummaryPanel` (was `CallSummaryCard`) is the tab body:
day, length and faces, then the summary, "Lor is writing the summary…"
before processing, or "Lor didn't write a summary for this call", with Edit
or "Write one"; a row with a time opens the Transcript tab there. The panel
header takes the summary's title. Old cards are filtered out of call chats
on web. Past calls open on Summary when titled, else Chat when people wrote,
else Transcript. The lobby already showed the summary title. Past-call
visibility counts a summary as posted. The card's notification is replaced
(Jacob: people in the call must hear the summary is done): once Lor writes a
summary, everyone who was in the call and can still see the channel gets
`notification:call-summary` ("Call summary: #channel", the summary's title
as body; Jacob's wording) and, when offline, a push (`sendCallSummaryPush`, data type
`call_summary`); a channel mute or the "nothing" level silences both, as for
"added you" (`unmutedUserIds` in `push.ts`, now shared with that push).
Clicking it on web opens the call's panel, which lands on Summary. No
notification for short calls or a failed summary. Phones open the call chat
from the push, and show no summary for new calls until Step 22.

#### Step 19: onboarding touchpoints and share to chat (~300)

[x] built 2026-10-10 · [ ] committed · [ ] db:push (`forward` in `message_type`, `message.forwarded`)

- `packages/auth/src/lib/workspace-template.ts:21,45`: remove the Lor intro.
- Hints: rewrite `lor_intro`; `lor_reply` moves into sessions with
  `LorActivity` (`lor-activity.tsx:45-73`).
- Setup: `setup.tsx:141-151` Ask Lor opens `session.new` with the draft;
  drop the `@Lor` prefix (`setup-steps.tsx:261`).
- "Share to #channel" on a Lor message in a session.

As built: the template seeds channels only (existing intros were already
hidden by `chatFeedMessage()`). `lor_intro` adds "or press ⌘N" on desktop
(`isTauri`); `lor_reply` needed nothing, since `LorActivity` only renders on
Lor's replies and those now live only in sessions. Setup's Ask Lor opens
`/session/new?draft=…&channelId=…` and its suggestions lose the "@Lor"
prefix. Share became **forwarding** (Jacob, Discord's model; chat will later
forward between channels too, so it is built for that): a Forward button
(`ArrowTurnForwardIcon`) on any finished text message in a session, Lor's or
a person's, opens `ForwardDialog` (`components/chat/`, target channel as a
prop for a future picker; optional note, preview, Cmd+Enter). It sends
`message:send` with `forward: true` and `referencedMessageId` = the
original; the gateway skips session start and builds a snapshot
(`loadForwardSnapshot`: today only a complete default/reply message in one of
this channel's sessions) into the new jsonb column `message.forwarded`
(`ForwardedMessage`: author, content, mentions, createdAt, source channel and
session with their names), type `forward`, note as content. Chat renders
`ForwardedMessageCard` from the snapshot, so it reads the same for people who
can't open the source and after the source changes or is deleted: a left
rule, "↪ Forwarded", the author, the text (collapsing past ~15 lines), and a
footer `#channel › session · date` that opens the source (a toast when it
isn't available). The snapshot isn't in `content`, so search doesn't index
the forwarded text again. Mobile shows only the note until Step 21 (a
note-less forward is blank there).

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
- Step 7, changed 2026-10-10 (Jacob, QA pass): starting a session is
  optimistic. The client picks the session and anchor ids (`newSession` on
  `message:send`; `createSession` inserts under them) and `useSessionStart`
  seeds the session, its first turn, its subscribers and its sidebar row
  before the ack. Enter opens the session at once; Cmd+Enter keeps you where
  you sent it, with the Started note, to fire off several. Same in channel
  chat, human threads and the New session view. The gateway joins the
  sender's socket to the session's room before the ack, so Lor's first
  frames reach them even before their page joins.
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
  (the server still sends it); only the badge went. **Cleanup done
  2026-10-09, after Step 17:** the channel page drops `useLorRunReplay` and
  its approval, proposal and plan subscriptions (the session page mounts
  approvals and proposals; `usePlanForThread` and legacy plan cards subscribe
  to plans themselves); `message-item.tsx` loses `LorRunControls` and the
  `showLorRunControls` prop (sessions stop runs from their own controls);
  `message-list.tsx` loses the Lor streaming follow. Kept: the `lorWaiting`
  copy, because the API thread summary type still carries it for mobile
  (Phase F). The only runs left in channel scope are legacy approvals parked
  before Step 4; resolving one still streams into chat through the global
  `useLorStream`, without late-join replay or follow.
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
