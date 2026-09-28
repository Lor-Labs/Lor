# Voice channels — calls, session chat, transcripts (execution runbook)

Status legend: `[ ]` todo · `[x]` done. Update checkboxes as phases land, and
append to the **Decisions & deviations log** at the bottom when reality forces
a change — this document is the source of truth across agent runs.

Product decisions live in [voice-channels.md](./voice-channels.md) ("Voice
channel model"). Background research lives in
[voice-channels-livekit-research.md](./voice-channels-livekit-research.md).
Tracking issue: LOR-79.

Rules for every phase:

- No tests. Verify with focused review, `pnpm run check`, `pnpm run check-types`,
  builds, and manual calls. Never run `pnpm run validate`.
- Never run `pnpm db:push`. Make the schema edit and flag that a push is owed.
- Never commit; Jacob owns git.
- New API routes need `apps/api` and `packages/api-client` rebuilds before
  mobile sees the types.
- Native mobile dependencies need a new dev client build (`pod install`), not an
  OTA update.

## Prerequisites (Jacob)

- [ ] Create a LiveKit Cloud project. Put `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and
      `LIVEKIT_API_SECRET` in local `.env` and on Railway.
- [ ] Point the project's webhook at `POST /v1/voice/livekit/webhook` (local
      development needs a tunnel).
- [ ] Keep a physical iPhone available; microphone publishing needs hardware.
- [ ] Choose the LiveKit plan before real team use (see the research cost model).

## Locked decisions (do not relitigate without logging a deviation)

| Topic | Decision |
|---|---|
| Transport | LiveKit Cloud. Media never passes through `apps/realtime`; Socket.IO carries Lor state only. |
| Source of truth | Postgres owns sessions and participants. LiveKit webhooks and room APIs are reconciled into Postgres. A client leave request is a hint, never the authority. |
| Session identity | The `voice_session` ID. The LiveKit room name is that ID; the room SID is transport detail. A rejoin inside the grace period reuses the room name, so LiveKit recreates the room if it already closed. |
| One live session per channel | Partial unique index on `voice_session(channel_id) WHERE ended_at IS NULL`; get-or-create in one transaction. |
| Session end | A new session starts empty (`emptySince = startedAt`) with its end job queued; the first connection clears `emptySince`. When the last human disconnects, set `emptySince` and enqueue a job delayed by `VOICE_SESSION_GRACE_MS` (120,000). The job ends the session only if `emptySince` still matches (compare-and-set) and sets `endedAt = emptySince`. A periodic sweep catches missed webhooks. |
| Participant identity | One `voice_session_participant` row per person per session. Its ID is the LiveKit identity, reused for reconnects and transfers. Display names are never used to map speech to people. |
| Transfer | "Transfer here" joins with the same identity; LiveKit disconnects the older connection, and that device shows where the call went. Verify the disconnect reason in V0. |
| One call per person | Joining a different session removes the person's participant from the old one through the LiveKit room API before the new token is issued. |
| Room cap | 30 people, enforced in the join handler by counting connected humans. The transcriber also joins the room, and LiveKit's docs don't say whether agents count toward its own room limit, so never set that limit to exactly 30. |
| Join response | `{ url, token, sessionId, participantId }`. Clients need no LiveKit env. Tokens are short-lived and grant only that room. |
| Access | Every voice handler starts with `resolveChannelAccess` (`packages/db/src/queries/channel-access.ts`), then requires `channel.type = "voice"` and a non-archived channel. |
| Session chat | Plan-card pattern: a `voice_session_card` message is the thread root, `voice_session.cardMessageId` is unique, and the session chat is that thread. Voice channels accept no other top-level messages. Cards post silent. |
| Live-only visibility | While a session is live, its thread room, thread reads, search, Lor retrieval, thread activity, and notification previews exclude everyone not connected to the call. Once it ends, normal channel access applies. |
| Sidebar presence | Push-invalidated snapshot, the sidebar Lor activity pattern (`reference/sidebar-realtime-activity-plan.md`): an invalidation event to the workspace room, then an auth-filtered fetch. Connected people only. |
| Transcription | Always on. One silent transcriber job per room with one Deepgram Nova-3 stream per human microphone through LiveKit Inference. Final segments persist through the API as they arrive. No Egress; LiveKit agent observability audio recording off. |
| Captions | A per-device CC toggle, default on, stored on the device. It only controls display. |
| Retention | Forever. No pruning jobs for sessions, chats, or transcripts. |
| Env | The three `LIVEKIT_*` vars are optional in `packages/env/src/server.ts`; voice routes fail with a clear error when they are missing. |
| Shared code | New `packages/voice` (uncompiled, relative imports): `VOICE_SESSION_GRACE_MS`, `MAX_CALL_PARTICIPANTS`, identity helpers, shared types. `livekit-server-sdk` stays in server code. |

## Phases

Each phase leaves `pnpm run check` and `pnpm run check-types` passing. Don't
start a phase until its predecessor is checked.

---

### [ ] V0 — Platform spike

Prove media on every supported client before building product UI. Keep the
code that works; V1 and V2 harden it.

- [ ] Add the optional `LIVEKIT_*` vars to `packages/env/src/server.ts`.
- [ ] Smallest real slice: a token source (a one-off script, or the start of
      the V1 join route) and a bare room screen on web and iPhone (the mobile
      `playground.tsx` route can host it).
- [ ] Desktop (`apps/desktop/src-tauri`):
  - `tauri.conf.json` CSP: add LiveKit Cloud to `connect-src` (HTTPS and WSS)
    and any media sources the SDK needs.
  - `Info.plist`: add `NSMicrophoneUsageDescription` and
    `NSCameraUsageDescription`.
  - Add hardened-runtime entitlements for microphone and camera if signing
    needs them; no entitlements file exists today.
  - Confirm the minimum macOS version for webview media capture;
    `minimumSystemVersion` is 11.0.
- [ ] Mobile (`apps/mobile`): the LiveKit React Native SDK and its Expo config
      plugin (per LiveKit's Expo quickstart); call-specific microphone and
      camera permission text (today's `app.json` text is for attachments);
      `UIBackgroundModes` audio; decide whether CallKit is needed. New dev
      client build.
- [ ] Manual two-person calls on web (Chrome and Safari), the packaged macOS
      app, and a physical iPhone:
  - microphone, camera, output device, and device changes
  - screen share from a computer, viewed on every client
  - navigating the web app keeps the call
  - iPhone lock, background audio, and interruptions (calls, Siri)
  - microphone or camera permission denial and recovery
  - Wi-Fi to cellular reconnect
  - a second join with the same identity disconnects the first, with a
    readable reason
- [ ] Log the outcome below: desktop media path (webview works, native bridge,
      or browser handoff), pinned SDK versions, CallKit decision, and client
      limits.

---

### [ ] V1 — Sessions, join, and presence (DB, API, worker, realtime)

Schema: new `packages/db/src/schemas/voice.ts` (relative imports only),
exported from `packages/db/src/schemas/index.ts`. Derive types with
`$inferSelect`/`$inferInsert`.

- `voice_session`: `id`, `workspaceId`, `channelId` (cascade), `cardMessageId`
  (set-null, unique), `createdById` (set-null), `startedAt`, `emptySince`,
  `endedAt`. Partial unique index for one live session per channel;
  `(channelId, startedAt)` for history.
- `voice_session_participant`: `id` (the LiveKit identity), `sessionId`
  (cascade), `userId`, `firstJoinedAt`, `connectedAt` (null when not
  connected), `lastLeftAt`. Unique `(sessionId, userId)`.
- `messages.ts`: `message_type` += `voice_session_card`, commented like
  `plan_card`.
- `packages/realtime-types/src/events.ts`: `RealtimeMessageType` +=
  `voice_session_card`; voice event payload schemas.
- **db:push owed:** two tables and one enum value.

`packages/voice` (new): constants, identity helpers, shared types.

API: new `apps/api/src/routes/v1/voice/` (`index.ts`, `routes.ts`,
`handlers.ts`, `schema.ts`) mounted in `apps/api/src/app.ts`; LiveKit server
code in `apps/api/src/lib/voice/`.

- `POST /v1/channels/{channelId}/voice/join`: get-or-create the live session
  and its card, enforce one call per person and the cap, upsert the
  participant, mint the token.
- `POST /v1/voice/sessions/{sessionId}/leave`: hint only; marks the participant
  disconnected and may start the grace timer.
- `GET /v1/channels/{channelId}/voice/sessions`: history, newest first, cursor
  paging, including the live session; hides one-person sessions with no content.
- `GET /v1/voice/sessions/{sessionId}`: detail with participants.
- `GET /v1/workspaces/{workspaceSlug}/voice/presence`: connected people per
  accessible voice channel (`listAccessibleChannelIds`).
- `POST /v1/voice/livekit/webhook`: raw body via `c.req.text()` (as the Attio,
  Linear, and GitHub webhooks do), LiveKit signature check, idempotent by event
  ID; handles participant joined/left and room finished.

Worker (`apps/worker/src/jobs/`), queue and job names in
`packages/realtime-types/src/queues.ts`; the API enqueues through a queue
singleton like `apps/api/src/lib/project-archive-queue.ts`:

- `end-voice-session.ts`: the delayed compare-and-set end job.
- `sweep-voice-sessions.ts`: periodic reconcile of live sessions against the
  LiveKit room API (missed webhooks, backend restarts).

Realtime, emitted from the API with the existing emitter
(`apps/api/src/lib/workspace-activity.ts` pattern):

- `workspace:voice:updated { workspaceId }` to the workspace room on every
  connect, disconnect, and end; clients refetch presence.
- `voice:call:updated` to the person's `userRoom` with their active session, so
  other devices can offer "Transfer here".

---

### [ ] V2 — Web and desktop call experience

- Call provider `apps/web/src/context/voice-call-context.tsx`, mounted in
  `apps/web/src/routes/_authenticated.tsx` above the sidebar and outlet. One
  LiveKit `Room` for the app's lifetime; never remount it. A workspace switch
  asks for confirmation, then leaves the call.
- Voice channel page: `$channelId.tsx` renders a new voice view for
  `channel.type === "voice"` (new `apps/web/src/components/voice/`): the live
  session with its participants and Join or "Transfer here", then the history.
- Call stage: a camera grid that pages for up to 30 people, a screen share
  stage, speaking indicators, device menus, mute, deafen, camera, share, leave,
  connection state, and audio autoplay recovery. LiveKit hooks and low-level
  components under Lor styling; HugeIcons.
- Call bar above `UserBar` in `apps/web/src/components/sidebar/index.tsx`, so it
  shows in both the workspace and DM sidebars. It names the workspace and
  channel and links back.
- Sidebar rows: connected people under each voice channel in `ChannelItem`
  (`apps/web/src/components/sidebar/channel-panel/channel-list.tsx`), from the
  presence snapshot.
- Transfer: devices that receive `voice:call:updated` offer "Transfer here";
  the replaced device shows where the call moved.
- Desktop: the `CloseRequested` handler in `apps/desktop/src-tauri/src/lib.rs`
  emits an event before hiding the window; the provider listens (as
  `settings-dialog.tsx` listens for `open-settings`) and leaves the call.
- Phone browsers show "Open the Lor app to join" instead of Join.
- Moderation: add a voice statement to
  `packages/auth/src/lib/workspace-statements.ts` (and its meta labels) for
  removing someone from a call.
- Enable voice in
  `apps/web/src/components/sidebar/channel-panel/create-channel-dialog.tsx`.

---

### [ ] V3 — Session chat

- The session page shows the chat, reusing the thread list and composer from
  `apps/web/src/components/sidebar/right-panel/thread-panel.tsx`: beside the
  stage during a call, from the call bar through the right panel, and from the
  history for past sessions. `message-item.tsx` renders the card wherever a
  root appears.
- Voice channels reject top-level messages other than session cards, in both
  the API and the realtime send path.
- Live-only enforcement:
  - `thread:join` in `apps/realtime/src/index.ts` checks channel access only
    today; for a live session card it must also require a connected
    participant.
  - Reply fanout in `apps/realtime/src/index.ts` sends `message:thread:updated`
    with the full reply to the channel room; skip that while the session is live.
  - When someone leaves the call, remove their sockets from the thread room.
  - API thread reads, message search, and the thread activity dock skip live
    sessions for people outside the call.
  - Lor retrieval: add a live-session filter next to `privateAudienceFilter`
    (`packages/lor/src/retrieval.ts`). A run inside the session thread may read
    its own session.
- Mentions (`packages/messaging` fanout):
  - Live session, person not in the call: "<name> mentioned you in a call in
    #<channel>" with Join and no message preview.
  - Ended session: a normal mention whose link opens the message in its session
    (web `threadId` + `threadMessageId`; mobile push `threadRootId` +
    `messageId`).
- History rows show unread replies and mentions from `thread_read_state`.
- `@Lor` in the session chat works like any thread; runs scope by
  `threadRootId`.

---

### [ ] V4 — iPhone app

- Voice channel screen (history, live session, Join or "Transfer here") from
  `apps/mobile/src/app/channel/[channelId]/index.tsx` for voice channels.
- Call screen: camera grid, share viewer with landscape and full screen (the app
  is portrait-only in `app.json`), mute, camera, and leave; no share button.
- A persistent call pill across the navigation stack.
- Background audio and interruptions; CallKit per the V0 decision.
- Session chat through the thread screen
  (`apps/mobile/src/app/channel/[channelId]/thread/[threadRootId].tsx`).
- Participant rows in `apps/mobile/src/components/channel-list.tsx`.
- Push deep links into sessions (`apps/mobile/src/lib/push-target.ts`).
- Update `reference/mobile-parity-todo.md`.

---

### [ ] V5 — Transcription

- Language gate: TypeScript (`@livekit/agents`) if the pinned Node SDK handles
  several participant streams cleanly; otherwise a small Python service based
  on LiveKit's multi-user transcriber example. Log the choice.
- New `apps/transcriber`, deployed as a LiveKit Cloud agent; shared types from
  `packages/voice`.
- Schema in `voice.ts`: `voice_transcript_segment` (session, participant,
  track, start/end offsets on the session timeline, final text, segment ID and
  revision, provider and model) and `voice_capture_gap` (session, start, end,
  reason). **db:push owed.**
- API: service-authenticated segment ingestion, idempotent per segment ID and
  revision; a transcript read endpoint for late joiners and past sessions that
  follows the live-only rule.
- Dispatch one transcriber per session when it starts. Subscribe to human
  microphone tracks only. Handle late joins, departures, republishing, and
  worker restarts.
- Captions over the `lk.transcription` text stream; interim updates replace the
  same segment. The CC toggle is per device and starts on.
- At session end: drain pending output, flush final segments, record gaps,
  finalize once.
- Turn off LiveKit agent observability audio recording; no Egress.
- Record STT minutes per call to compare with the research cost model.

---

### [ ] V6 — Memory and Q&A

- A summary per ended session (extend `packages/lor/src/meeting-insights.ts`)
  with decisions, open questions, and follow-ups; people can correct it.
- Index each ended session's transcript as a source under channel access, with
  links to transcript passages. Session chat messages are ordinary messages and
  become searchable when the session ends.
- Lor text Q&A with grounded links; corrections and deletions propagate.
- Session deletion: a permission statement, and propagation to derived memory.
- Private questions to Lor stay deferred (`reference/private-lor-questions.md`).

---

### Later — spoken Lor

See Phase 2 of the spec.

## Decisions & deviations log

- 2026-09-28 — Runbook created from the voice channel model Jacob decided the
  same day. Nothing is built yet; V0 waits on the LiveKit Cloud project and keys.
