# Voice channels — calls, session chat, transcripts (execution runbook)

Status legend: `[ ]` todo · `[x]` done. Update checkboxes as phases land, and
append to the **Decisions & deviations log** at the bottom when reality forces
a change — this document is the source of truth across agent runs.

Product decisions live in [voice-channels.md](./voice-channels.md) ("Voice
channel model"). Background research lives in
[voice-channels-livekit-research.md](./archive/voice-channels-livekit-research.md).
Tracking issue: LOR-79.

Rules for every phase:

- No tests. Verify with focused review, `pnpm run check`, `pnpm run check-types`,
  builds, and manual calls. Never run `pnpm run validate`.
- Never run `pnpm db:push`. Make the schema edit and flag that a push is owed.
- Never commit; Jacob owns git. Deliver code in chunks of about 300-400
  changed lines. Stop after each chunk so Jacob can review and commit it.
  Nothing is pushed until the whole feature is done.
- New API routes need `apps/api` and `packages/api-client` rebuilds before
  mobile sees the types.
- Native mobile dependencies need a new dev client build (`pod install`), not an
  OTA update.

## Prerequisites (Jacob)

Before V0:

- [ ] Create a LiveKit Cloud project. The free Build plan is enough for V0
      (100 concurrent connections). Put `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and
      `LIVEKIT_API_SECRET` in the root `.env`, which the API loads.
- [ ] iPhone dev build (microphone publishing needs a real device): with the
      phone plugged in, run `APP_VARIANT=development npx expo run:ios --device`
      from `apps/mobile`. An EAS development build also works, but it needs the
      device registered and the changes committed first.
- [ ] Packaged macOS build: `pnpm --filter desktop build`. Sign it with the
      Developer ID identity (`APPLE_SIGNING_IDENTITY`) if the certificate is in
      the keychain, so it matches release builds. Never push a `v*` tag for
      V0: `release-desktop.yml` publishes to the updater for every user.

Before V1:

- [ ] Put the same three vars on Railway.
- [ ] Point the project's webhook at `POST /v1/voice/livekit/webhook` (local
      development needs a tunnel).

Before V4 live testing:

- [ ] Create a Deepgram account and put `DEEPGRAM_API_KEY` in the root `.env`.
- [ ] Add a Railway service built from `apps/transcriber/Dockerfile` (repo root
      as the build context). Give it the worker's variables, because
      `@repo/env` validates the full server schema, plus `DEEPGRAM_API_KEY`.

Before real team use:

- [ ] Move to the Ship plan. Build includes 5,000 WebRTC minutes a month; one
      10-person hour uses 600.

## Locked decisions (do not relitigate without logging a deviation)

| Topic | Decision |
|---|---|
| Transport | LiveKit Cloud. Media never passes through `apps/realtime`; Socket.IO carries Lor state only. |
| Source of truth | Postgres owns sessions and participants. LiveKit webhooks and room APIs are reconciled into Postgres. A client leave request is a hint, never the authority. |
| Session identity | The `voice_session` ID. The LiveKit room name is that ID; the room SID is transport detail. A rejoin inside the grace period reuses the room name, so LiveKit recreates the room if it already closed. |
| One live session per channel | Partial unique index on `voice_session(channel_id) WHERE ended_at IS NULL`; get-or-create in one transaction. |
| Session end | A new session starts empty (`emptySince = startedAt`); the first connection clears `emptySince`, and the last human out sets it. Webhooks drive these changes. A 30s maintenance sweep (`sweep-voice-sessions`) finds sessions empty longer than `VOICE_SESSION_GRACE_MS` (120,000), confirms with LiveKit once that the room is empty, then ends them by compare-and-set on `emptySince` (`endedAt = emptySince`). A 10-minute audit (`audit-voice-sessions`) reconciles occupied sessions. A join also reconciles a live session before reusing it, and ends it if it has been empty past the grace period. When nobody is left in the room, missed leaves are dated to the last sign of presence (a connection, a leave, or a transcriber renewal), not to now. No per-session delayed jobs. LiveKit's server API allows 1,000 requests/minute per project, so only these paths and joins call it. |
| Participant identity | One `voice_session_participant` row per person per session. Its ID is the LiveKit identity, reused for reconnects and transfers. Display names are never used to map speech to people. |
| Transfer | "Transfer here" joins with the same identity; LiveKit disconnects the older connection, and that device shows where the call went. Verify the disconnect reason in V0. |
| One call per person | Joining a different session removes the person's participant from the old one through the LiveKit room API before the new token is issued. |
| Room cap | 30 people, enforced in the join handler by counting connected humans. The transcriber joins as an agent participant; LiveKit's own `maxParticipants` excludes agents (`RoomConfiguration` in `@livekit/protocol`), and we don't set it. |
| Join response | `{ url, token, sessionId, participantId }`. Clients need no LiveKit env. Tokens are short-lived and grant only that room. |
| Access | Every voice handler starts with `resolveChannelAccess` (`packages/db/src/queries/channel-access.ts`), then requires `channel.type = "voice"` and a non-archived channel. |
| Session chat | Plan pattern: a `voice_session` message is the thread root, `voice_session.threadRootId` is unique, and the session chat is that thread. Voice channels accept no other top-level messages. Root messages post silent. The chat is human-only: Lor mention routing ignores session threads on the server, and the composer doesn't offer Lor. Lor reads the thread as passive context for voice requests. |
| Lor requests | Voice only, triggered from the live transcript when someone addresses Lor directly: a local name gate on every final segment, then Jev (`typesafe-ai/jev` on the Vercel AI Gateway) on segments that pass it. A request is its own record (session, requester, heard text, run, status, what it showed), not a chat message. It runs as a run with no chat message attached (the automation-run shape), scoped to the session thread, as the speaker, with normal approvals. |
| Lor's window | Mounted only while a request is listening, thinking, working, or showing a result; it animates in and out of the screen-share slot. Shared state for everyone in the call; anyone can clear it or step through the session's earlier results. Content is a typed union from day one: `cards` (Linear issues, GitHub PRs), `answer`, and a reserved `liveView`. A future Lor browser joins the LiveKit room as its own participant and publishes a video track into this slot; non-UUID identities are already ignored by presence and sync. |
| Gateway ZDR | Voice-path gateway requests set `providerOptions.gateway.zeroDataRetention: true` per request. Pending: the gateway plan is Hobby, which returns 403 for the flag; turn it on once the plan is Pro. |
| Live-only visibility | While a session is live, its thread room, thread reads, search, Lor retrieval, thread activity, and notification previews exclude everyone not connected to the call. Once it ends, normal channel access applies. |
| Sidebar presence | Push-invalidated snapshot, the sidebar Lor activity pattern (`reference/archive/sidebar-realtime-activity-plan.md`): an invalidation event to the workspace room, then an auth-filtered fetch. Connected people only. |
| Transcription | Always on. One self-hosted transcriber service (`apps/transcriber`, TypeScript `@livekit/agents` worker on Railway) serves every call, with one lightweight job per room, dispatched from the join token. Each job opens one Deepgram Nova-3 stream (direct, our own API key, keyterm "Lor") per unmuted human microphone and closes it on mute. No `AgentSession`, LLM, or TTS. Final segments are written to Postgres through `@repo/voice/server` as they arrive. No Egress. |
| Captions | A per-device CC toggle, default on, stored on the device. It only controls display. |
| Retention | Forever. No pruning jobs for sessions, chats, or transcripts. |
| Env | The three `LIVEKIT_*` vars are optional in `packages/env/src/server.ts`; voice routes fail with a clear error when they are missing. |
| Shared code | New `packages/voice` (uncompiled, relative imports): `VOICE_SESSION_GRACE_MS`, `MAX_CALL_PARTICIPANTS`, identity helpers, shared types. `livekit-server-sdk` stays in server code. |

## Phases

Each phase leaves `pnpm run check` and `pnpm run check-types` passing. Don't
start a phase until its predecessor is checked.

---

### [x] V0 — Platform spike

Prove media on every supported client before building product UI. Keep the
code that works; V1 and V2 harden it.

- [x] Add the optional `LIVEKIT_*` vars to `packages/env/src/server.ts`.
- [x] Smallest real slice: a token source (a one-off script, or the start of
      the V1 join route) and a bare room screen on web and iPhone (the mobile
      `playground.tsx` route can host it).
- [x] Desktop (`apps/desktop/src-tauri`):
  - `tauri.conf.json` CSP: add LiveKit Cloud to `connect-src` (HTTPS and WSS)
    and any media sources the SDK needs.
  - `Info.plist`: add `NSMicrophoneUsageDescription` and
    `NSCameraUsageDescription`.
  - Add hardened-runtime entitlements for microphone and camera if signing
    needs them; no entitlements file exists today.
  - Confirm the minimum macOS version for webview media capture;
    `minimumSystemVersion` is 11.0.
- [x] Mobile (`apps/mobile`): the LiveKit React Native SDK and its Expo config
      plugin (per LiveKit's Expo quickstart); call-specific microphone and
      camera permission text (today's `app.json` text is for attachments);
      `UIBackgroundModes` audio; decide whether CallKit is needed. New dev
      client build.
- [x] Manual two-person calls on web (Chrome and Safari), the packaged macOS
      app, and a physical iPhone:
  - microphone, camera, output device, and device changes
  - screen share from a computer, viewed on every client
  - navigating the web app keeps the call
  - iPhone lock, background audio, and interruptions (calls, Siri)
  - microphone or camera permission denial and recovery
  - Wi-Fi to cellular reconnect
  - a second join with the same identity disconnects the first, with a
    readable reason
- [x] Log the outcome below: desktop media path (webview works, native bridge,
      or browser handoff), pinned SDK versions, CallKit decision, and client
      limits.

---

### [ ] V1 — Sessions, join, and presence (DB, API, worker, realtime)

Schema: new `packages/db/src/schemas/voice.ts` (relative imports only),
exported from `packages/db/src/schemas/index.ts`. Derive types with
`$inferSelect`/`$inferInsert`.

- `voice_session`: `id`, `workspaceId`, `channelId` (cascade), `threadRootId`
  (set-null, unique), `createdById` (set-null), `startedAt`, `emptySince`,
  `endedAt`. Partial unique index for one live session per channel;
  `(channelId, startedAt)` for history.
- `voice_session_participant`: `id` (the LiveKit identity), `sessionId`
  (cascade), `userId`, `firstJoinedAt`, `connectedAt` (null when not
  connected), `lastLeftAt`. Unique `(sessionId, userId)`.
- `messages.ts`: `message_type` += `voice_session` (the session chat's root
  message; not rendered as a card).
- `packages/realtime-types/src/events.ts`: `RealtimeMessageType` +=
  `voice_session`; voice event payload schemas.
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

Worker: `apps/worker/src/jobs/voice-sessions.ts`, two maintenance-queue
schedulers over logic in `packages/voice/src/server/sync.ts`:

- `sweep-voice-sessions` (30s): confirms and ends sessions past the grace
  period.
- `audit-voice-sessions` (10 min): reconciles occupied sessions against the
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
  `apps/web/src/components/sidebar/right-panel/thread-panel.tsx`: in a
  collapsible panel beside the stage during a call (closed by default, with an
  unread badge; the panel gets a Lor tab in V5), from the call bar through the
  right panel, and from the history for past sessions. Same look as chat
  elsewhere. `message-item.tsx` renders the root message wherever it appears.
- Human-only: Lor mention routing (`apps/realtime/src/services/lor-routing.ts`)
  ignores messages in threads whose root is a `voice_session` message, and the
  composer's mention list leaves Lor out there.
- Voice channels reject top-level messages other than session root messages,
  in both the API and the realtime send path.
- Live-only enforcement:
  - `thread:join` in `apps/realtime/src/index.ts` checks channel access only
    today; for a live session's root it must also require a connected
    participant.
  - Reply fanout in `apps/realtime/src/index.ts` sends `message:thread:updated`
    with the full reply to the channel room; skip that while the session is live.
  - When someone leaves the call, remove their sockets from the thread room.
  - API thread reads, message search, the thread activity dock, pinned-message
    lists, and channel-feed thread summaries skip live sessions for people
    outside the call.
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

---

### [ ] V4 — Transcription

- Language and hosting (decided 2026-09-30, see the log): TypeScript
  `@livekit/agents` worker, self-hosted on Railway, Node runtime (the native
  `@livekit/rtc-node` module rules out Bun). No `AgentSession`: each job
  manages its own speech-to-text streams.
- New `apps/transcriber` with agent name `lor-transcriber` (`lor-transcriber-dev`
  outside production, so a laptop sharing production's LiveKit project never
  takes production calls); shared code from `packages/voice`. It writes to
  Postgres and the Socket.IO emitter directly, like the worker, so there's no
  ingestion API. It runs TypeScript through `node --import tsx`; the agents
  SDK passes that loader to each call's child process.
- Schema in `voice.ts`: `voice_transcript_segment` (session, participant,
  track, start/end offsets on the session timeline, final text, segment ID and
  revision, provider and model) and `voice_capture_gap` (session, participant,
  start, end, reason). **db:push owed.**
- `@repo/voice/server` transcript helpers: record a segment idempotently per
  segment ID and revision, record a gap, list a session's transcript.
- API: a transcript read endpoint for late joiners and past sessions that
  follows the live-only rule.
- Web transcript view: the call panel (right panel, titled "Call") has Chat
  and Transcript tabs. Speaker blocks with avatar, name, and clock time; gaps
  as "Not captured" dividers; live lines in the interim-to-final style after
  the saved transcript. A past session opens on Transcript unless its chat
  has unread messages or mentions.
- Dispatch from the join token (`roomConfig.agents`), which fires when LiveKit
  creates the room. The 10-minute audit re-dispatches with `createDispatch`
  when a live room has no transcriber. Subscribe to human microphone tracks
  only. Handle late joins, departures, mute and unmute, republishing, and
  worker restarts.
- Transcriber lease on `voice_session` (`transcriber_job_id`,
  `transcriber_seen_at`; **db:push owed**). The job claims it on join (a
  second transcriber in the same room leaves), renews it every 30s while
  people are in the call, and releases it when the room empties. A lease not
  renewed for 90s means the transcriber is missing: the audit dispatches a new
  one, which records the stretch since the last renewal as a `no_transcriber`
  gap. A session that ends without one records the gap at session end. An
  empty room's transcriber leaves after the grace period plus a minute.
- Deepgram direct through `@livekit/agents-plugin-deepgram` with
  `DEEPGRAM_API_KEY` (optional in `packages/env`; the transcriber exits with a
  clear error without it). One stream per unmuted microphone, closed on mute.
- Add "Lor" as a Deepgram keyterm on every participant stream, through
  LiveKit's per-session keyterm option, so V5's name gate sees the name
  spelled right.
- Captions over the `lk.transcription` text stream; interim updates replace the
  same segment. Interim text renders in the muted foreground token and turns
  to the normal foreground when final (Jacob's call). The CC toggle is per
  device and starts on.
- At session end: drain pending output, flush final segments, record gaps,
  finalize once. Built as a clean finish per microphone (on mute, leave, and
  job shutdown): stop the audio, flush, end the input, and wait up to 3s for
  Deepgram's last final transcript before closing.
- No Egress.
- Record STT minutes per call to compare with the research cost model. On the
  first real call, compare Deepgram's billed minutes with the minutes we
  streamed. If Deepgram bills open but silent streams, also skip silent audio.
  Built as the `sttMinutes` field on the transcriber's "transcriber: left" log
  line (audio sent to Deepgram, per job).
- Segments are the input V5 listens to for "Lor, …", so ingestion latency
  matters: persist and publish final segments as they arrive, not in batches.
- Measure final-segment latency on the first real call.

---

### [ ] V5 — Lor in the call

Design: the spec's "Lor in the call" section.

- Address detection on final transcript segments, in two stages:
  1. Name gate, local, on every final segment: match "Lor" anywhere in the
     segment, plus the homophones "lore", "law", "lower", and "Laura".
  2. Jev (`typesafe-ai/jev` on the Vercel AI Gateway), only on segments that
     pass the gate. One call, three questions: `addressed` (boolean), `kind`
     (`request` | `mention` | `continuation`), and `complete` (boolean). Fail
     closed on an error or timeout.

  Log every trigger and every rejection so false triggers can be tuned.
- Lor's window opens only after Jev says Lor is addressed (Jacob,
  2026-10-01), so words like "law" and "lower" never flash it. To feel
  instant, Jev checks the speaker's live words as soon as they contain the
  name: "Hey Lor" opens the window listening about 0.6–0.7s after it's said,
  and the words appear as they're spoken. Each finished line is checked
  again; a complete request starts if the speaker didn't keep talking during
  the ~350ms check, so Jev's own latency is the pause detector. A listening
  window closes after 4s of silence. Words after the start steer the running
  request (chunk 3).
- A new request while Lor is working goes into the running request at its
  next step, the way steering works in chat, and Lor decides (Jacob,
  2026-10-01): "stop that and look at the PR instead" replaces the current
  work, "after that, …" waits until it's done. During a long tool call Lor
  reacts when the tool returns; Cancel stops at once.
- Results are generative UI from a component catalog (Jacob, 2026-10-01).
  Lor composes the window with one stage tool from typed blocks: generic
  blocks (text, list, table, details, link, code) carry their data, so any
  MCP server or custom tool works without per-tool prompting; entity blocks
  for built-in connectors (Linear issue, GitHub pull request) are references
  the server fills with live data. `live_view` (browser) and `app` (a
  Lor-written component in a sandboxed frame) are reserved block types, so
  Lor-built UI can come later without a redesign. While Lor works, the window
  shows its live tool activity for every tool.
- A tool call that needs approval shows an approval overlay on Lor's window
  over a blurred background (Jacob, 2026-10-01). Approving continues the
  request in the window; nothing posts to the call chat.
- Follow-ups must also be addressed ("Lor, open the second one") in the first
  release. A bounded continuation window is deferred.
- Jev transport: bump `ai` in `packages/lor` from 7.0.11 to >= 7.0.105 for
  `experimental_evaluate`, or call
  `POST https://ai-gateway.vercel.sh/typesafe/v1/systemone` over HTTP with the
  existing `AI_GATEWAY_API_KEY`. Set gateway ZDR per request once the plan is
  Pro (locked decisions); on the HTTP path, confirm how the request carries
  that option.
- Schema: a request record in `voice.ts` (session, requester participant and
  user, heard text, agent run, status, stage payload, timestamps).
  **db:push owed.**
- Runs: a run with no chat message attached (the automation-run shape; see
  `reference/automation-primitives.md`), scoped to the session thread, as the
  speaker, with the full toolset and approval policies. Context: the recent
  transcript, the session chat as passive background, and the request text.
- Output: the stage tool's typed blocks (see the generative UI decision
  above). Actions on entity blocks route through the normal tools and
  approvals; asking Lor ("Lor, assign the second one to me") works from the
  first release.
- Realtime: request and stage events to the session's thread room only
  (live-only rule), so late joiners and every device see the same window.
- Web: Lor's window in the screen-share slot (beside a screen share, never
  over it), mounted only while a request is active or its result is showing:
  enter animation, listening with the live words, a working state shown only
  by animation (Lor's mark plus the logos of tools in use; no status text,
  no reasoning), the result, exit animation. Cancel is a hover X. Shared
  clear and step-back ("2 of 3").
- How Lor communicates (Jacob, 2026-10-02): written answers and questions
  with choices in the window; emoji reactions only through a `react` tool
  the model calls to acknowledge something said to it, floating from Lor's
  mark; no voice, no posts to the call chat, no "share to chat".
- No Lor tab (Jacob, 2026-10-02): requests and results appear in the call
  transcript where they happened, and clicking one shows it on stage. Past
  sessions keep Chat and Transcript tabs.

Chunks (planned 2026-10-01):

1. [x] Address detection: the `voice_request` table, the name gate, the Jev
   check, and the transcriber's listener. **db:push owed.**
2. Lor's window shell, in two parts:
   - [x] 2a, server: live-word checks, the verdict fix, request events to the
     session thread room (the transcriber now has its own Redis emitter),
     `GET /voice/sessions/{id}/requests`, `POST /voice/requests/{id}/cancel`.
   - [x] 2b, web: the window opening on a listening or accepted request, the
     speaker's live words, a working state, Cancel, and the exit animation.
     `LorWindow` (`apps/web/src/components/voice/lor-window.tsx`) sits in the
     call stage's share slot, over a screen share if there is one, and the
     tiles move to the filmstrip while it shows. `useVoiceRequests` keeps the
     list from the endpoint plus events. Until chunk 3, an accepted request
     stays on "Working on it" until someone cancels.
3. Runs, in three parts:
   - [x] 3a, server: the worker runs an accepted request as the speaker; the
     stage tool with generic blocks plus `answer` and `question` (choices);
     status, result, and cancel stopping the run. **db:push owed**
     (`voice_request.result`). The `react` tool moved to 3b with its UI.
     As built:
     - The transcriber enqueues a queued request on `voice-request`
       (`apps/transcriber/src/queue.ts`); the worker
       (`apps/worker/src/jobs/voice-request.ts`) creates the `agent_run`
       with `scopeKey` = the session, so a call has one active request at a
       time, and a later one waits (up to 5 min) until 3c steers instead.
       Wall clock is capped at 10 minutes.
     - `respond()` gets a `voice` context (`packages/lor/src/voice.ts`):
       `show_in_call` with the block catalog, the call framing in the system
       prompt, and no `react_to_message` (no chat to react in). The recent
       call goes in as background: up to 60 transcript lines before the
       request and the last 20 call chat messages marked `[call chat]`.
     - The final reply becomes an `answer` block when Lor never called
       `show_in_call`; with nothing to show, the request fails.
     - Cancel settles an unclaimed run or flags a working one and signals
       its worker (`apps/api/src/lib/voice/runs.ts`).
     - Not built: a sweep for a request stuck `queued` if the enqueue is
       lost.
   - [x] 3b, web: the working animation with tool logos (live tool events),
     result blocks, and the `react_in_call` tool with floating reactions.
     Replaces 2b's "Working on it" label. **db:push owed**
     (`voice_request.dismissed_at`). As built:
     - Lor's window shows only the newest request, while it's in flight or
       until someone clears its result (the X clears for everyone,
       `POST /voice/requests/{id}/dismiss`). Cancelling it closes the window
       and never brings back an earlier request (Jacob, 2026-10-03).
     - Tool activity and reactions are live-only events
       (`voice:request:activity`, `voice:request:reaction`) kept in
       `lor-stage-store.ts`; the worker skips its own window tools.
     - The mark pulses while listening and turns an arc while working; tool
       logos reuse the chat trail's `toolIcon`, one per kind, the newest
       pulsing. A result gets a header (mark, heard text, tools) over
       scrolling blocks; answers render with the chat's `MessageMarkdown`;
       question choices are numbered so people can answer by number.
     - Moved to 3c: clickable question choices (an answer is a follow-up).
     - The dev simulator gained result, correction, and failure scenarios.
   - [x] 3c: new requests and corrections steer the running request;
     follow-ups build on the previous result; question choices are
     clickable. As built:
     - Steering: the running request's `drainConversation` claims queued
       requests in the same call at each step (`claimQueuedVoiceRequests`)
       and injects them with the run's delivery guarantee. The prompt tells
       Lor to drop the old work when a new request replaces it and to
       finish first when it's for after. A request that arrives as the run
       ends gets its own run once the scope frees (polled every second).
     - One run can carry several requests: `show_in_call` writes to the
       newest, tool activity and reactions follow it, and the run finishes
       them together. A cancel stops the whole run and ends all of them
       cancelled.
     - Follow-ups: the background includes what Lor showed for the last 5
       requests in the call (`listShownVoiceRequests`, rendered as text by
       `voiceBlocksText`).
     - Choices: `POST /voice/requests/{id}/choose` turns a pick into a new
       request from the clicker (`gate` = `choice`, no Jev check), enqueued
       from the API. Lor hears it as "(picked in Lor's window) …".
     - Deferred: the speaker's words just after Lor starts joining the
       request. Jev's ~350ms check already refuses to start while they're
       still talking, and steering covers a restated request; revisit if
       mid-sentence starts show up in testing.
   - [x] 3d: a call's runs share one cached conversation, and Lor sees the
     whole call. As built:
     - Continuation (`apps/worker/src/lib/voice-continuation.ts`): a later
       request continues the call's last finished run (scope = session),
       reusing chat's `findPredecessor` + `replayChain`. The new run replays
       that transcript verbatim (earlier requests, tool results, what Lor
       showed) and adds one message: what was said since (transcript lines
       from the last run's first request on, minus the words of requests Lor
       already took on, plus call chat sent since it started) and the new
       request. Crash recovery uses the existing `replayContinuedPrefix`.
     - The system prompt no longer names the speaker, so it is identical for
       every voice run; who asked lives in the messages.
     - The fresh path (first request, or a chain that can't be replayed)
       loads the whole transcript and call chat, not a recent window. Caps of
       5,000 lines and 1,000 chat messages are runaway guards only.
     - Fix from the first live test (2026-10-03): Jev's `complete` scored
       finished short questions low ("Are you there, Lor?" 0.36), so they
       timed out as rejected. Now a pause of 1.2s after a line Jev read as an
       addressed request (not a mention) starts it (`isAddressedRequest`,
       `settleVoiceRequest`). "Hey Lor, um…" (a mention) still waits 4s.
4. [x] Entity blocks: Linear issues and GitHub pull requests with live data.
   - [x] 4a (server): blocks `linear_issues` (`issues`: identifiers) and
     `github_pull_requests` (`pullRequests`: "owner/repo#142") store
     references only. `GET /voice/requests/{id}/entities` loads the cards
     with the workspace's connections (`@repo/lor/voice-entities`): Linear in
     one `issues` query filtered by team key + number; each PR is 3 GitHub
     calls (PR, reviews, check runs). Missing references are left out; the
     response says whether each connector is connected.
   - [x] 4b (web): `lor-entity-cards.tsx` renders each record as a link
     card (reference, title, state badge; Linear: priority, assignee, team,
     labels; GitHub: author, review, checks, +/−). Unloaded references show
     loading, then "couldn't load" or "isn't connected".
     `useVoiceEntityCards` refetches every 60s while the window shows them
     (not while the tab is hidden), keyed by the result's references. The
     simulator's "Shows Linear issues and PRs" seeds sample cards.
5. [x] Lor in the transcript: requests and results inline where they
   happened, "Show on stage", and step-back ("2 of 3"). As built:
   - `voice_request.staged_at` (**db:push owed**); the request state now
     carries `finishedAt` and `stagedAt`. `POST /voice/requests/{id}/stage`
     (someone in the live call, done requests with a result) sets it and
     clears `dismissedAt`.
   - Window rule (`pickOnStage` in `use-voice-requests.ts`): a request in
     flight always shows; otherwise the request that most recently took the
     window (made, finished, or staged), unless it's cancelled or cleared.
     A cancel finishes last, so it closes the window and never brings back an
     earlier result. Requests replaced mid-run (done, no result) never show.
   - Step-back: "‹ 2 of 3 ›" in the result header stages the neighbouring
     result, so everyone moves together.
   - Transcript: done and failed requests sit at their `createdAt`, just after
     the words that asked them: Lor's mark, who asked and what was heard, then
     the blocks. Entity cards load once there (no 60s refresh). "Show on
     stage" appears during the call on results not already shown. Past
     sessions show the same entries without the button.
6. [x] The approval overlay inside Lor's window. Decided 2026-10-04 (Jacob):
   approvals never leave the call. A gated tool pauses only when someone
   connected to the call can resolve it; otherwise it's refused with a reason
   Lor passes on. Tools stay bound either way (prompt cache). The last
   approver leaving starts a 30s grace period, then the approval is rejected
   and Lor told; the call ending expires it.
   - [x] 6a (server): new status `awaiting_approval` and `voice_request.approval`
     jsonb (approval id, label, tool, approver user ids) — **db:push owed**.
     `RunVoiceContext.canApprove` feeds `buildToolApproval`, which returns
     `{ type: "denied", reason }` when nobody present can resolve.
     `listCallApprovers` (worker) = connected participants passing
     `canResolveApproval` for the policy's resolver, with channel write access
     as the floor. On `awaiting_approval` the worker parks the run's newest
     request (older ones it took on end done) and schedules an
     `approval-watch` job on the voice queue every 10s: it refreshes the
     approver list, rejects after 30s without one (then resumes so Lor is
     told), and expires the approval and fails the request once the call
     ended. Resolving goes through the existing approvals routes: for a voice
     run they require a connected participant, post nothing, and enqueue a
     voice job with `resumeApprovalId`, which replays the paused run via
     `buildApprovalContinuation`. Cancel expires the pending approval. Voice
     approvals are left out of the channel approvals list.
   - [x] 6b (web): `ApprovalOverlay` in `lor-window.tsx` blurs the window
     and shows the tool's logo, "Lor needs approval", and the action label.
     Approvers present (the stored list now carries names) get Approve /
     Reject, which call the existing approvals routes; everyone else sees
     "Waiting for Alice or Bob to approve". The X stays above it and cancels.
     `awaiting_approval` counts as in flight, so a waiting request holds the
     window until a newer request takes it; the transcript then shows it as
     "Waiting for approval: …" with "Show on stage". The simulator's "Needs
     approval" scenario resolves locally.

As built, chunk 1:

- Jev over HTTP (`packages/voice/src/server/address.ts`): `POST
  https://ai-gateway.vercel.sh/typesafe/v1/systemone`, model
  `typesafe-ai/jev`, Bearer `AI_GATEWAY_API_KEY`, 3s timeout. Verified live
  2026-10-01 (270–400ms). No `ai` bump.
- Thresholds from sampled lines: accept when addressed ≥ 0.5, the kind is
  `request` or `continuation`, and complete ≥ 0.5. Addressed but incomplete
  waits up to 4s for the speaker to go on, at most 3 checks.
- The transcriber's `LorListener` (`apps/transcriber/src/lor-listener.ts`)
  gates final lines, keeps one pending request per speaker, and asks Jev once
  nothing new is heard from the speaker for 900ms (interim lines count as
  speech). Deepgram's own end of speech fires after 25ms of silence, which is
  too short. Jev gets the last 12 lines as context.
- `voice_request` keeps every check (probabilities, latency, model) and
  whether the gate matched "Lor" or a homophone. Logs carry the request ID and
  the check, never the heard text.

As built, chunk 2a (replaces chunk 1's 900ms quiet timer):

- Verdict fix: Jev labels "Hey Lor" a mention (0.91 addressed, 0.19
  complete), and chunk 1 rejected every mention, so a paused "Hey Lor… pull
  up my tickets" failed. Now addressed + incomplete means listen, whatever
  the kind; "Thanks Lor." (0.76 complete) is still rejected.
- The row is created at Jev's first yes. Rejections of finished lines are
  recorded for tuning; rejections of live words aren't, and that speaker's
  live words aren't rechecked until the line finishes.
- Request events go to the session thread room (`voice:request:updated`),
  from the transcriber and the API. The web shows the speaker's live words
  from the captions it already receives, so no per-word events.

---

### [ ] V6 — iPhone app

Phone essentials first (Jacob, 2026-10-05: the team takes calls on phones),
then V7, then the rest of V6. Essentials = join and take part, see shares,
open the call chat, and see Lor's window read-only. Approval buttons, the
Transcript tab, the call pill, landscape shares, push deep links, "Show on
stage", and step-back wait for the rest of V6.

- [x] Essentials 1: the existing call screen keeps the join response's
  session and call chat ids, holds the chat's thread room for the whole call
  (`lib/thread-rooms.ts` counts holders, so closing the chat screen no longer
  leaves the room Lor's events use), adds a Chat button that opens the
  thread screen (titled "Call chat", no root row), and calls the leave route
  on leave. iOS audio needs no new code: `registerGlobals()` configures the
  session and the `audio` background mode keeps the call alive while the mic
  is on (SDK 3.0.0 README). Android background needs a foreground service,
  not done. The share viewer from V0 stays as is.
- [x] Essentials 2: Lor's window, read-only. The window rules
  (`pickVoiceRequestOnStage`, `mergeVoiceRequest`, `isActiveVoiceRequest`,
  `hasVoiceResult`) moved to `@repo/realtime-types/voice-requests`, shared by
  web and mobile. Mobile `useVoiceRequests` (query + `voice:request:updated`)
  feeds `LorWindow` above the tiles: Lor's mark pulsing (the app's `Shimmer`)
  while listening or working, "Listening to …", the heard text, every block
  type (answers and tables through `MessageContent`; Linear and GitHub as
  compact rows from the entities route, refreshed every 60s), "Waiting for …
  to approve" without buttons, and the X to cancel or clear. No tool logos,
  reactions, live words, choices to tap, step-back, or "Show on stage" yet.
- [x] Rest 1: the voice channel screen before joining (`voice/voice-lobby.tsx`
  + `hooks/use-voice-sessions.ts`, same query key and push rules as web): the
  live call card with "Transfer here" when your other device is in the call,
  and past calls with unread dots and mention counts. A past call opens its
  chat; there is no Transcript tab on the phone yet. Lor's summary card draws
  read-only (`voice/call-summary-card.tsx`); times show but aren't tappable
  until the Transcript tab lands, and editing stays on web for now.
  `formatDuration` and `formatCallOffset` moved to `@repo/utils/date`.
- [x] Rest 2: the call lives in `context/voice-call-context.tsx` (one Room
  for the app's lifetime, like web), so leaving the call screen keeps the
  call. The lobby offers "Switch to this call" when the phone is in another
  channel's call. Voice channels in the channel list show who is connected
  (`hooks/use-voice-presence.ts`, same key as web). Deviation from web:
  switching workspace doesn't end or block the call; opening the call
  switches back. Signing out ends the call.
- [x] Rest 2b (Jacob, 2026-10-06: people know Discord's and Slack's floating
  call windows): a top call bar was built first, then replaced by
  `voice/call-tile.tsx`, a floating tile over every screen except the call's
  own. It shows whoever spoke last (video if their camera is on, else their
  avatar, with the speaking ring), "Only you" when alone, and a mic-off badge
  when muted. Drag it anywhere; on release it springs to the corner a flick
  points at (velocity projected 0.15s), and keeps that corner next time. Tap
  opens the call. While someone shares their screen the tile shows the share
  instead (Jacob, 2026-10-06; Slack, Meet, and Zoom do the same), reshaping
  from 108x144 to a 16:9 176x99 in its corner. The snap spring is critically
  damped with overshoot clamped,
  and keeps a flick's speed only toward the corner (Jacob: the first, bouncy
  version swung around).
- [x] Rest 3: the Transcript tab on the phone. A call's thread screen is
  titled "Call" with Chat and Transcript tabs (route params `tab` and `at`;
  the thread API's `voiceSessionId` now reaches the mobile thread hook).
  `voice/call-transcript.tsx` draws speaker turns, capture gaps, and Lor's
  results inline (`LorBlocks`, no "Show on stage" yet) in a LegendList, and
  scrolls to and flashes the block at `at`. The layout rules
  (`buildTranscriptBlocks`, `transcriptBlockAt`) moved from web into
  `@repo/realtime-types/call-transcript`, shared by both. The phone shows no
  live captions: a live call refetches saved lines every 10s and stays at the
  bottom. `hooks/use-open-call-transcript.ts` opens a call's transcript at a
  moment (same location query key as web), switching tabs in place inside
  that call's chat; `[[call:…]]` links now carry `?at=<ms>`, and the summary
  card's times and "Open transcript" use it. Past calls with an empty chat
  open on the transcript, like web.
- [x] Rest 3b (Jacob, 2026-10-06: keep the call center stage, chat as a
  pull-up drawer like Discord's; fill the stage when alone, halves for two).
  `voice/call-sheet.tsx`: a `@gorhom/bottom-sheet` drawer on the call screen.
  Pulled down it shows the grabber and the call controls; pulled up (92%) or
  Chat tapped, the Chat and Transcript tabs fade in. Only the controls strip
  drags it (`enableContentPanningGesture={false}`), so the chat and
  transcript scroll freely; gorhom ignores the composer's keyboard (it only
  tracks its own `BottomSheetTextInput`), so `ChatKeyboardLayout` keeps
  handling it. The chat stays mounted behind the transcript tab. The thread
  screen's body moved to `components/thread-view.tsx` (`ThreadView`, with an
  `embedded` mode that drops its header and tabs) so the route and the
  drawer share it. Stage: one tile fills it, two stack as halves, three or
  four share a 2x2 grid (an odd last tile spans its row), more scroll in rows
  of two, three rows to a screen. Drawer feel (Jacob, 2026-10-06, matching
  Discord's): docks at the peek, 60%, and the top (12pt below the header).
  From the bottom it always opens to the top (15% of the way up, flick
  included, is enough); the 60% dock
  is only reached by letting go near it on the way down
  (`useCallSheetGestures` replaces gorhom's release step). A slightly
  underdamped (~0.8), clamped spring carrying the release speed replaces
  gorhom's overdamped default, so it zips and stops dead. Haptics: one as it
  zips open, one as it lands at the bottom, none at 60%. Chat opens to the top;
  the keyboard lifts 60% to the top. gorhom sizes content for the top dock,
  so the drawer sizes its content to each dock's visible height itself
  (at once when rising, after settling when lowering) to keep the composer
  and newest messages on screen at 60%.
- [x] Rest 4: Lor's window acts on the phone, mirroring web. Approve and
  Reject for people who can approve (others still see who can); question
  choices are tappable (`/voice/requests/{id}/choose`); a "2 of 3" stepper
  at the bottom stages the neighbouring result; the tools Lor used show as
  glyphs in the header (one per kind, `toolKind` in `lor-tool-trail.tsx`,
  the newest pulsing while it works) and its reactions float up from the
  mark. Tools and reactions come from `voice:request:activity` and
  `voice:request:reaction` into `voice/lor-stage-store.ts` (same as web's
  store). Lor's results in the transcript get "Show on stage" during the
  call. The dev simulator now makes you the approver of its approval and
  resolves it locally, and shows a tool while it works.
- [x] Rest 5: tapping a screen share opens `voice/share-viewer.tsx`, a
  full-screen viewer that turns with the phone (Jacob: a manual rotate
  button alone is bad practice; the first version had only that).
  `expo-screen-orientation`: app.json `orientation` is now `default` with
  the plugin's `initialOrientation: PORTRAIT_UP` (and
  `ios.requireFullScreen`), the root layout locks portrait, and the viewer
  unlocks while open and locks portrait again on close. "Landscape" forces
  it sideways for people who keep rotation lock on. Native change: needs a
  new dev client and TestFlight build; an old binary crashes on the import.
  Pinch or double-tap zooms (up to 4x), drag pans while zoomed, a turn
  resets zoom; a share that ends closes it. Drag down to close (the image
  viewer's gesture: a mostly downward drag at normal size, past 120pt or a
  900pt/s flick); the backdrop fades to show the call behind, and short of
  the threshold it snaps back crisply. Push
  deep links needed no code: a mention from a live call you aren't in is
  pushed with the voice channel only (no thread, no message), so a tap opens
  the lobby with Join; after the call, the push carries the call chat and
  message and opens it there.
- [ ] Android background audio: deferred (Jacob to decide). Neither the
  LiveKit SDK nor its Expo plugin keeps the microphone alive in the
  background on Android (their foreground service is for screen share
  only); it needs our own `microphone` foreground service (e.g. Notifee and
  a config plugin), a new EAS build, and an Android device to test. iOS
  already works through the `audio` background mode.
- [x] Polish A (Jacob, 2026-10-06), web and phone: your own avatar shows
  under the voice channel the moment this device connects, not after
  LiveKit's webhook (`withOwnVoiceCall` in
  `@repo/realtime-types/voice-presence`, derived so a refetch can't drop it;
  the server's entry wins once it lists you, and you're shown nowhere
  else). The people under a live voice channel are one button that opens
  the channel and joins (web sidebar, phone channel list); already in that
  call, it just opens it.
- [x] Polish B, web `voice/call-hero.tsx` and the phone lobby: a pre-join
  like Google Meet's (Jacob tried a centered "who's here" hero first, then
  chose this). A preview of how you'll appear: your camera (livekit
  `createLocalVideoTrack` on web, WebRTC `getUserMedia` + `RTCView` on the
  phone), started only when you turn the camera on so a visit never asks
  for camera access, else your avatar and "Camera is off"; microphone and
  camera controls on it (red when off; mic on, camera off by default). On
  web, as in Meet, the chosen devices sit in a row under the preview: a
  ghost picker per kind (microphone, camera, and speaker where `setSinkId`
  exists) showing the active device's name, with `DeviceRadioGroup` from
  the call controls as its menu (`activeDevice` shows LiveKit's "default"
  as the first listed device, since only Chrome lists a "default" entry, so
  the trigger and the checked item agree). Browsers hide device names, and
  list no speakers, until the page has used a microphone or camera, so the
  pickers read one shared list (`hooks/use-local-devices.ts`: a module
  store over `enumerateDevices`, kept across visits, refreshed on mount,
  `devicechange`, permission `change`, a started camera preview, and any
  grant). Before names, a picker reads "Default microphone" and its first
  click asks for access (`requestDeviceAccess`; a speaker asks for the
  microphone) and then opens the list; it is disabled only while the first
  listing loads or the prompt is up. A microphone already allowed is opened
  for a moment on arrival when names are still hidden (Safari, Firefox),
  never the camera. Per-picker lists failed: access granted in one never
  reached the others, so the speaker stayed grey until a remount. Pre-join
  LiveKit hooks pass `requestPermissions: false` (its default asks on a
  visit); the in-call settings menu keeps the default, so opening it asks.
  The preview carries your name like a call tile.
  Picking switches the call's shared room, which stores it as the capture
  default when nothing is published (livekit `switchActiveDevice`; the
  speaker as `audioOutput`), so the choice carries into the call; the
  preview follows the picked camera. Beside it (below on the phone): who's here ("Jacob, Bucky, and
  Alex are here", `whoIsHere` shared) and the live time, or "It's quiet in
  #channel", and "Join call" / "Start call". The preview stops before the
  call takes the camera; `join(target, devices)` on both. "Joining…",
  "Transfer here", and "Switch to this call" still replace the label. The
  web hero is a container query (`@2xl`), not a viewport one: the lobby
  column is `max-w-3xl`, and when the call panel narrows it the preview
  goes on top at full width with Join centered below, instead of both
  columns squeezing. Side by side, the Join column is centered (as in
  Meet) and placed on the preview's grid row, so it centers on the preview
  alone, with the device row in a second row under the preview. The
  pickers split the preview's width equally (`flex-1`; the kit's buttons
  are `shrink-0`, so natural widths overflowed), long names truncated,
  each centered in its share. The camera-off avatar is sized like the account
  settings one (`size-20`, `text-lg`).
- [x] Polish B2 (Jacob, 2026-10-06), the phone: the pre-join gets web's
  refinements (bordered card, your name like a call tile) and front/back
  camera in place of web's device row, since iOS picks the microphone and
  speaker itself. Jacob: camera flip is required before release. A flip
  button on the preview while the camera is on restarts the preview on the
  other side; the choice goes in `JoinDevices.facing` and the camera opens
  with it (`setCameraEnabled(true, { facingMode })`). In the call, the
  header shows the flip while your camera is on (like Meet's and
  Discord's, so the controls row keeps its shape). `flipCamera` in the call
  context calls `LocalVideoTrack.restartTrack({ facingMode })`; LiveKit
  keeps that in the track's constraints, so turning the camera off and on
  stays on the same side, and the in-call camera toggle passes the same
  facing for a fresh track. Your own video is mirrored only for the front
  camera (stage, floating tile, preview). Verified in source: LiveKit's
  `deviceId: { ideal: "default" }` matches no real camera, so iOS and
  Android both fall back to `facingMode`.
- [x] Polish C (Jacob, 2026-10-06), the phone: live captions, like web's.
  `@livekit/react-native` doesn't re-export `useTranscriptions`, so
  `hooks/use-call-captions.ts` registers the caption topic once on the
  app's room (LiveKit keeps handlers across disconnects; the store clears
  on `Disconnected`) and merges updates by segment id like LiveKit's
  `setupTextStream`, a late interim never undoing a final. Each update is
  one short stream (the transcriber writes once and closes), read with
  `readAll()`. `CAPTION_TOPIC` / `CAPTION_ATTRIBUTES` moved to
  `@repo/realtime-types/call-transcript` (re-exported by `@repo/voice`),
  since `@repo/voice` pulls in the database and server SDK. Captions show
  over the bottom of the stage (`call-captions.tsx`, three lines, interim
  muted); a CC button in the controls row hides them, remembered on the
  device (`expo-secure-store`, `lor.voice-captions`). Both apps use
  `ClosedCaptionIcon` (a box with "CC", Jacob's pick); the free set has no
  crossed-out version, so on reads like the chat toggle (accent on the
  phone, the filled button on web). The transcript of the
  call this phone is in merges caption lines (dimmed until final) in place
  of the old 10s polling, naming late joiners from the call, and Lor's
  window shows the speaker's live words while it listens.
- [x] Polish D (Jacob, 2026-10-06):
  - Past-call rows lead with Lor's title once the call is summarized, the
    day and time moving into the detail line (web and phone). The history
    and detail responses carry `title`, read as `summary->>'title'`, so a
    person's correction shows too; null until Lor summarizes.
  - The phone deletes a call by long-press (people with `voice: ["delete"]`,
    checked like `useMemberModeration`: custom roles count as members and
    the server enforces the grant). A haptic, then `CallActionsSheet` with
    Delete; `hooks/use-delete-call.ts` mirrors web's: the row hides at
    once, the delete is sent after 10s, Undo in a HeroUI toast never sends
    it, and going to the background sends waiting deletes at once.
  - The drawer's chat button shows a count of other people's call chat
    messages (accent badge), counted in the call context from the thread
    room it already holds and cleared while the drawer shows the Chat tab.
- [x] Polish E (Jacob, 2026-10-06): the call chat opens instantly, with
  every message, on both apps. Before, the first open of a call's chat
  loaded, and web's panel (unmounted when closed) stopped receiving
  messages: reopening within the 60s `staleTime` showed a copy missing what
  was sent meanwhile, though the unread badge had counted it.
  - Web: `VoiceCallProvider` runs `useThreadMessages` for the call chat for
    the whole call, so the `["thread", id]` cache loads at join, is never
    collected, and takes live messages while the panel is closed (edits,
    reactions, deletes, Lor's streams, and reconnect resyncs already write
    that cache). `fetchThreadPage` / `threadQueryOptions` are shared by the
    panel, the call, and `prefetchThread`, which past-call rows run on hover
    or focus. The live insert skips a message whose nonce matches an
    optimistic entry still in the cache (the sending hook swaps it), since
    the call's copy has no pending-nonce ref. Room joins are ref-counted,
    so the panel closing doesn't drop the call's rooms.
  - Phone: the drawer's chat mounts with the call instead of on first open
    (it already stayed mounted after that), so it loads at join and keeps
    up. Closed, the hidden content keeps the middle dock's height, so the
    list lays out at a real size. Its auto mark-read touches only the voice
    channel, and only while the call screen has focus, as it already did
    after the first open; the phone writes no per-call read state.
- [x] Polish F (Jacob, 2026-10-06): your own place in the channel list
  moves from the tap, both ways, on both apps. Polish A showed you once
  connected; now you show from the tap on Join (the join request and
  LiveKit connect take about a second), and leaving drops you at once
  instead of after the leave request's push. Each call context exposes
  `ownVoiceChannel`: the call being joined (which wins over the call it
  replaces) or in, else the call just left, kept `LEFT_PRESENCE_MS` (10s)
  or until the next join. `withOwnVoicePresence` (renamed from
  `withOwnVoiceCall`) takes `{ left: false, participant }` to place you
  (and remove you elsewhere) or `{ left: true, userId }` to remove you from
  that channel; its result has no session id, which nothing read.
  Unexpected disconnects don't mark you gone: "moved to another device"
  means you're still in the call.
- [x] Polish G (Jacob, 2026-10-06), web: the call controls have tooltips, one
  grouped tooltip for the row (`TooltipCreateHandle` with a payload per
  button, like the message action bar), naming each button's action
  (Mute, Turn camera on, Audio devices, Choose camera, Share screen, Show
  captions, Show chat, Leave call). A `pointer-fine:after` bridge spans
  the `gap-2` (and a 1px one each split button's divider) so the tooltip
  stays open between buttons; menus turn their tooltip off while open.
  Microphone and camera are split buttons, replacing the separate Devices
  button: the left half toggles, an up chevron opens the menu (the
  microphone's lists speakers too, where `setSinkId` exists). Both halves
  stay outlined while on (Jacob: no grey fill), the icon showing the
  state. On and off read by brightness, with no added colour: off is a dim
  (`muted-foreground`) icon in the outline, on (share, captions, chat
  open) a bright icon on a subtle `accent` fill; a camera that's off, the
  device chevrons, and the dev simulator are dim too. Tried first and
  rejected by Jacob: the grey "secondary" fill with bright icons (too close
  to off), a primary tint (an added colour), and an inverted solid fill
  like Meet's (too loud). A muted microphone takes
  Discord's red (Jacob wanted only the colour, not its layout): both
  halves take a soft `destructive/12` tint with a dark divider, and Leave
  takes the same tint (Jacob: one red, the softer one; a solid red for
  both was tried first). The menus read the shared
  device list and open through `useDeviceMenu` (asks for access first
  while names are hidden), the same as the pre-join pickers, instead of
  LiveKit's hook mounting an empty list on open. Deafen is removed (Jacob: nobody will use it): its button, the
  context's `deafened` / `toggleDeafen`, `RoomAudioRenderer muted`, and
  the unmute-undeafens rule in `useMicrophoneToggle`. The phone never had
  deafen, and its touch controls keep accessibility labels instead of
  tooltips.
- [x] Polish H (Jacob, 2026-10-06), web: a floating call window replaces the
  sidebar's "Voice connected" bar, like the phone's tile (`call-window.tsx`,
  mounted in the sidebar layout for the right panel's context). It shows
  while this device is in a call and not on the call's page: whoever spoke
  last, or the share while someone shares (a 4:3 window for a person,
  16:9 for a share, reshaping in its corner), with a name label, speaking
  ring, and muted badge; mute, chat (with the unread count), and leave
  show on hover. Clicking it opens the call; dragging snaps it to the
  nearest corner after a flick (Motion's `drag` with `useDragControls`
  started from the video area only, since Motion's native pointer listener
  can't be stopped by a child's React handler; a critically damped spring
  keeps only speed toward the corner). The corner is remembered in
  `localStorage`. The sidebar keeps only "In a call on another device"
  with Transfer here, and closing a left call's chat moved into the
  window's always-mounted wrapper. Same in the desktop app (same code);
  floating over other apps (a second Tauri window, or Document
  Picture-in-Picture in Chromium) is a later, separate step.
- [x] Polish I (Jacob, 2026-10-06), both apps: one set of call button states
  everywhere. Web exports `DIM` / `RED` / `ACTIVE` from `call-controls.tsx`
  for the pre-join and the floating window; the phone's drawer controls use
  `ControlButton` tones (`on` / `off` / `active` / `red` on HeroUI's
  outline, secondary, and danger-soft variants). So: off is a dim icon in an
  outline, a device that's on a bright one, a feature that's on (captions,
  chat open, sharing) a bright icon on a subtle fill, and a muted
  microphone and Leave share one soft red. The phone's muted microphone,
  which only swapped its icon, is now red; its captions and chat no longer
  use the accent colour for on. Both pre-join screens follow it (a camera
  that's off is no longer red); the phone's stay filled since they sit on
  the camera preview. The floating window's buttons take the same states
  and a grouped tooltip. "Reconnecting…" now shows on the floating window,
  the phone's call screen (a pill at the top), and its floating tile (an
  overlay), not only in web's call controls; only the full `Reconnecting`
  state, since audio keeps flowing during `SignalReconnecting`.
- [x] Polish J (Jacob, 2026-10-06):
  - A call chat's header shows Lor's title once the call is summarized,
    else "Call", on both apps. The thread replies response carries
    `voiceSessionTitle` (`summary->>'title'`, read with `voiceSessionId`);
    the phone keeps it in its thread snapshot too.
  - Web mutes and unmutes with ⌘⇧M (Ctrl+Shift+M off Mac) from anywhere
    while in a call, like Discord's (a document `keydown` listener in
    `VoiceCallProvider`, only while connected). The mute tooltips, in the
    bar and the floating window, show it as a `Kbd`, and the buttons carry
    `aria-keyshortcuts`. Call tooltips now take a `ControlTip` payload
    (label and optional shortcut) rendered by `ControlTooltip`. Unverified:
    Chrome binds the same keys to its profile menu and Firefox to
    responsive design mode. The handler calls `preventDefault`, which
    should win if the page gets the key first; check both browsers (the
    desktop app has no such binding).

- Voice channel screen (history, live session, Join or "Transfer here") from
  `apps/mobile/src/app/channel/[channelId]/index.tsx` for voice channels.
- Call screen: camera grid, share viewer with landscape and full screen (the app
  is portrait-only in `app.json`), mute, camera, and leave; no share button.
  Lor's window in the share slot, and Chat and Transcript tabs as a sheet.
- A persistent call pill across the navigation stack.
- Background audio and interruptions. No CallKit (V0 decision).
- Session chat through the thread screen
  (`apps/mobile/src/app/channel/[channelId]/thread/[threadRootId].tsx`).
- Participant rows in `apps/mobile/src/components/channel-list.tsx`.
- Push deep links into sessions (`apps/mobile/src/lib/push-target.ts`).
- Update `reference/mobile-parity-todo.md`.

---

### [x] V7 — Memory and Q&A

Plan (Jacob, 2026-10-05): 1 after-call summary + indexing, 2 Lor answers
from calls, 3 summary on screen (editable by anyone who can post in the
channel, "Edited by …"), 4 deleting a call (`voice: delete`, owner/admin).
No backfill script (no real calls yet). Calls under 2 minutes are left
alone. Indexing follows contextual retrieval, with the model choosing the
passages (Jacob, 2026-10-05): one read of the whole transcript (never cut)
returns the summary and the call's topic sections; each section is one
passage, labelled with the call, channel, date, speakers, and the section's
title and description. A section is only cut past the embedding model's
input limit. Lor reads around a hit with `read_call`. Search scope is the
existing `privateAudienceFilter`: the channel Lor answers in, never the
asker's access. Nothing happens silently: Lor posts the recap in the call
chat when it's done, and everyone who was in the call follows that chat.

- [x] 1 (built 2026-10-05): `voice_session.summary` (jsonb: summary,
  decisions, open questions, follow-ups, each item with `atMs`),
  `voice_session.memory_processed_at`, and the `voice_passage` table
  (transcript and summary passages, `context` + `text`, halfvec embedding,
  FTS over both) — **db:push owed**. `endSession` calls the notifier's
  `sessionEnded`, which the API and worker install to queue a
  `voice-session-memory` job (`voiceSessionMemoryJob`, id `memory-<id>`;
  code in `voice-session-memory.ts` in packages/voice, packages/lor, and
  the worker); the
  10-minute voice audit queues any ended call still unprocessed (backstop,
  no new scheduler). `processCallMemory`: calls under 2 minutes or 40 words
  are marked processed with nothing; otherwise `summarizeCall` reads the
  numbered transcript ("L12 [4:05] Alice: …", gap rule in the prompt) and
  returns the summary plus `sections` (start line, title, about);
  `buildSectionPassages` makes one passage per section (bad starts dropped,
  none → the whole call); embeddings in batches of 32 (a failed batch keeps
  keyword search); one transaction replaces the passages and sets the
  summary; then Lor posts the recap in the call chat (`postLorMessage` now
  takes `threadRootId`). `resolveThreadNotificationContext` counts a
  voice_session thread's call participants as subscribed. Session chat
  needs nothing: messages become searchable when the call ends. Fixed on
  the way: BullMQ rejects ":" in custom job ids, so the approval-resume job
  ids (6a) now use "-".
  Sectioning eval (2026-10-05): `apps/worker/src/scripts/eval-voice-session-memory.ts`
  runs seven written calls (`…-calls.ts`: fillers, back-channels, audio
  trouble, misheard names, unannounced topic changes; blocks mark expected
  section starts, `optional` where either reading is fine) through
  `summarizeCall` and tallies pass/split/merged, with gateway cost.
  `--model`, `--reasoning`, `--runs` compare settings (`SummarizeCallOptions`).
  Findings: the small model at medium reasoning scored 37/42; high reasoning
  split one subject by angle more often (26/36 on the earlier set); Kimi K3
  was consistent but split finer still (19/28) at 40x the cost; a prompt
  that pushed harder toward fewer sections made it merge distinct subjects
  (postmortem into incident, next steps into pricing), the costlier
  direction, so the rule stayed as is plus "one section per agenda item,
  the way the people on the call would list it". Remaining misses are
  over-splits of one problem into its steps.

- [x] 2 (built 2026-10-05): Lor answers from past calls. `search` gains a
  `calls` type (`packages/lor/src/calls.ts` `searchCalls`: keyword + vector
  over `voice_passage` by RRF, the run's `privateAudienceFilter`, at most 2
  hits per call, snippets of 1,500 chars with `truncated`); a `call` result
  carries the passage `context`, `from`–`to` call times, and `kind`.
  `read_call` reads an ended call's transcript (gaps as "not captured"
  lines), 300 lines a page with `nextFrom`, under the same audience rule.
  Citation `[[call:<sessionId>@<m:ss>]]`; grounding verifies the call is an
  ended call in the workspace and rewrites it to
  `[[call:<id>@<ms>|<channel>|<startedAt>]]` so clients label it without a
  lookup. Web: the chip ("standup call · Oct 5, 2026, 10:42 AM") opens the
  call chat panel's Transcript tab via a new `callAt` channel search param
  (`useThreadPanelUrlSync`), and the transcript scrolls to the block spoken
  then and flashes it. Mobile: the chip opens the call chat (no transcript
  tab yet; `reference/mobile-parity-todo.md`). Search previews and push text
  show "↗ <channel> call". The gap rule is in Lor's chat prompt. Call times
  floor to the second so `nextFrom` never skips a line.

- [x] 3 (built 2026-10-05, reworked 2026-10-06): the summary as Lor's card
  in the call chat (Jacob: a structured notification, like Ergo's meeting
  emails, not a freeform recap; shown in one place only, not also on the
  Transcript tab). Summary shape: `title` (a meeting-style name),
  `summary`, `decisions`, `openQuestions`, and `actionItems` (`owner` only
  when the call says who, a short `title`, one `detail` line), each with
  `atMs`. `voice_session` gains `summary_edited_at`, `summary_edited_by_id`
  and `summary_card_message_id`, and `message_type` gains `call_summary`
  — **db:push owed** (the last two are new on 2026-10-06). The after-call
  job posts the card through `postLorMessage` (type `call_summary`,
  `excludedFromMemory`, text fallback = title + paragraph for push and the
  phone) and records it with `setSummaryCard`; calls under 2 minutes get no
  card; a failed summary still gets one saying so. `GET`/`PUT
  /v1/voice/summary-cards/{messageId}`: the call (date, length, people),
  the current summary, who last edited it, and `canEdit` (channel access +
  `canWrite`, the posting rule). A save replaces the summary and its
  `voice_passage` summary row in one transaction (`saveEditedSummary`),
  re-embedded in the request (a failed embed keeps keyword search), so Lor
  never cites the corrected version. Web: the card shows the title, day,
  length and faces, the paragraph, then decisions (green check), open
  questions (amber), and action items (blue, owner in bold, detail muted),
  times in a right column; a row with a time opens the Transcript tab at
  that moment (`useCallCitation`), as does Open transcript. Footer: "Written
  by Lor" or "Edited by <name> · <time>", and Edit (or "Write one"), which
  edits every field in place. Past calls open on Chat when it has anything,
  else on the transcript. Phone: shows the text fallback for now
  (`reference/mobile-parity-todo.md`). Dev seed:
  `apps/worker/src/scripts/seed-call-summary.ts <sessionId> [--edited]`
  writes a fake summary, its passage, and the card without notifications.

- [x] 4 (built 2026-10-06): deleting a call. New permission `voice:
  delete` ("Delete calls"; owners and admins through `workspaceGrants`).
  `DELETE /v1/workspaces/{slug}/voice/sessions/{id}` (permission first,
  channel access, ended calls only) runs `deleteCall` in one transaction:
  Lor's runs in the call (`agent_run.scopeKey` = session id; each holds the
  transcript up to its request — Jacob: they go too), the session row
  (cascading participants, transcript, capture gaps, requests, passages),
  and the call chat's root message (cascading every reply and the summary
  card — Jacob: the chat goes too). Then `notifyVoicePresence` refetches
  past-call lists and `message:deleted` drops the chat root. Memory pages
  Lor wrote from the call stay (nothing records which sentences came from
  it). Undo (Jacob): the client hides the call, shows "Call deleted" with
  Undo for 10s (toast `timeout`), and only then sends the delete; Undo just
  never sends it; leaving the page sends waiting deletes at once
  (`keepalive`). Web: "Delete call" in a past call's "…" menu, for people
  with the permission. Phone: no past-call list yet.

- A summary per ended session (extend `packages/lor/src/meeting-insights.ts`)
  with decisions, open questions, and follow-ups; people can correct it.
- Index each ended session's transcript as a source under channel access, with
  links to transcript passages. Session chat messages are ordinary messages and
  become searchable when the session ends.
- Lor text Q&A with grounded links; corrections and deletions propagate.
- Capture gaps mean "not captured", never "something was said": Lor never
  infers content from a gap, and only qualifies claims about absence inside
  one ("nobody objected" → "nobody objected in the captured part").
- Session deletion: a permission statement, and propagation to derived memory.
- Private questions to Lor stay deferred (`reference/planned/private-lor-questions.md`).

---

### Later

- Lor browser and computer use, shown live in Lor's window (`liveView`).
- Spoken answers.
- A generic component kit for results no purpose-built card fits.
- Talking and muted signs on the people under a voice channel, for the call
  you're in (LiveKit already has the data; other calls need server work).
  Skipped by Jacob on 2026-10-06: not needed yet.
- Floating the call window over other apps (desktop: a second Tauri window;
  Chromium: Document Picture-in-Picture).

## Decisions & deviations log

- 2026-09-28 — Runbook created from the voice channel model Jacob decided the
  same day. Nothing is built yet; V0 waits on the LiveKit Cloud project and keys.
- 2026-09-28 — V0 code landed; manual calls pending. Spike shape, all replaced
  or hardened later:
  - Token source is the start of the V1 route:
    `POST /v1/channels/{channelId}/voice/join`
    (`apps/api/src/routes/v1/voice/`, `apps/api/src/lib/voice/livekit.ts`).
    Room = channel ID and identity = user ID until V1 introduces sessions and
    participants. So the same account on two devices already exercises the
    duplicate-identity transfer; two-person tests need two accounts.
  - Web builds minimal V2 pieces early: `VoiceCallProvider`
    (`apps/web/src/context/voice-call-context.tsx`, mounted in
    `_authenticated.tsx`), the voice channel page (`apps/web/src/components/voice/`,
    branched in `$channelId.tsx`), and a call bar above `UserBar`. Voice channel
    creation is enabled now so test channels can be made.
  - iPhone: `VoiceCallScreen` (`apps/mobile/src/components/voice/`) replaces
    the chat screen for voice channels. The call lives with that screen; V4
    moves it to an app-level provider. `@livekit/react-native` v3's
    `registerGlobals()` configures the iOS audio session itself.
  - Versions installed: `livekit-server-sdk` 2.19, `livekit-client` 2.22,
    `@livekit/components-react` 2.9, `@livekit/react-native` 3.0,
    `@livekit/react-native-webrtc` 144.2, `@livekit/react-native-expo-plugin`
    1.0, `@config-plugins/react-native-webrtc` 15.0 (peer `expo >= 56`).
    `pnpm-lock.yaml` pins the exact versions; upgrade them deliberately and
    re-run the V0 calls on all three clients after any LiveKit upgrade.
- 2026-09-29 — Jacob's manual calls: audio, camera, and screen share work on
  web, the packaged macOS app, and a physical iPhone. Desktop media path =
  the Tauri webview; no native bridge or browser handoff needed. Still to
  confirm before closing V0: device changes, iPhone lock/background audio,
  permission denial recovery, Wi-Fi to cellular reconnect, the
  duplicate-identity transfer, and the CallKit decision.
- 2026-09-29 — iPhone audio continues with the app in the background (the
  `UIBackgroundModes` audio entry is enough). Siri silences call audio while
  active, and audio returns afterward. CallKit decision: not needed for V4;
  revisit only if incoming-call UI or lock-screen controls are wanted. Other
  checks look fine so far, per Jacob.
- 2026-09-29 — V1 chunk 1 (schema, `packages/voice`) and chunk 2 (join on
  sessions, leave) landed. The session's root message type is `voice_session`
  and the column is `voice_session.thread_root_id` (renamed from the card
  naming: nothing renders as a card). The LiveKit room is now the session id
  and the identity is the participant id. Until chunk 4 adds the webhook and
  end job, `connectedAt` is never set and sessions never end, so every join
  reuses the channel's one live session.
- 2026-09-29 — V1 chunk 3: history (`GET /channels/{channelId}/voice/sessions`,
  `before` cursor), detail (`GET /voice/sessions/{sessionId}`), and presence
  (`GET /workspaces/{workspaceSlug}/voice/presence`), read queries in
  `apps/api/src/lib/voice/queries.ts`. Participants carry the workspace
  `avatarColor`. Voice read routes are `hide: true`, matching the leave route.
- 2026-09-29 — V1 chunk 4: LiveKit helpers and participant state moved to
  `@repo/voice/server` (`packages/voice/src/server/`) so the worker's sync job
  can share them; the API no longer depends on `livekit-server-sdk` directly.
  Webhook: plain route `POST /v1/voice/livekit/webhook` (raw body, signed
  Authorization header, 1 MB cap) handling participant joined/left and
  room finished. Deviation from "idempotent by event ID": updates are guarded
  by current state instead (duplicate events are no-ops), applied in arrival
  order, and the sync job corrects rare reordering. No event-ID store.
- 2026-09-29 — V1 chunk 5: session end moved from per-session delayed jobs to
  a 30s sweep plus a 10-minute audit (Jacob approved; the rate limit drove
  it). Sessions end 2:00–2:30 after the last person leaves. Local testing
  needs a webhook tunnel; without one, presence only updates when a sweep or
  audit reaches LiveKit. Unverified: that `listParticipants` on a closed
  room returns a 404 `TwirpError`. If it doesn't, sessions won't end and the
  worker logs "could not confirm session is empty".
- 2026-09-29 — V1 chunk 6: `workspace:voice:updated` (workspace room,
  invalidation only) and `voice:call:updated` (user room, the user's current
  call). `@repo/voice/server` stays transport-free: the API and worker install
  a notifier at startup (`setVoiceNotifier`). Each change sends the user's
  current call read from the database, not a delta, so reordered webhooks
  still converge. V1 code is complete; check V1 off after a tunnel test
  (join, leave, a session ending, presence refetch).
- 2026-09-29 — V2 chunks 1–2: sidebar participant rows
  (`VoicePresenceProvider`, push-invalidated refetch of the presence API) and
  the voice lobby (live session card + paged history). Mobile tiles are sized
  explicitly from the window width: `aspectRatio` produced no height for
  percentage-width tiles inside the ScrollView on device.
- 2026-09-29 — V2 chunk 3: `GET /v1/voice/call` + `voice:call:updated` now
  carry `channelName`/`workspaceSlug`; the provider derives `remoteCall` (call
  on another device) from them, and "Transfer here" is a plain join of the same
  session. Webhook `participant_left` carries the connection's `joinedAt`, so a
  replaced device's late leave can't clear the new device's connection. Leave
  button posts the leave hint. Workspace switch is blocked by
  `useBlocker` with a Leave/Stay dialog (`enableBeforeUnload` off, so reloads
  don't prompt). Tauri emits `main-window-hidden` on close; the provider leaves
  the call. Phone browsers see "Open the Lor app to join".
- 2026-09-29 — V2 chunk 4: deafen (`RoomAudioRenderer muted`, mic muted and
  restored on undeafen; unmuting while deafened undeafens), grid paging
  (`useVisualStableUpdate` + `usePagination`, 12 tiles per page), and
  moderation: new `voice: ["moderate"]` statement (owner/admin by default),
  `DELETE /workspaces/{slug}/voice/sessions/{id}/participants/{participantId}`
  (removes from the LiveKit room, then marks left), tile menu "Remove from
  call" for people with the permission. V2 code is complete; live QA owed
  on all of it.
- 2026-09-30 — Product direction change (Jacob): the goal is much better than a
  huddle, not a copy. Lor joins the call by being addressed by voice (ambient,
  no push-to-talk) and shows results in Lor's window, which appears in the
  screen-share slot only while it's working or showing something. Lor doesn't
  speak for now. First cards: Linear issues and GitHub pull requests. The
  session chat stays human-only with the normal look; Lor reads it passively
  and never takes commands from it. A Lor tab lists every request. Browser use
  is prepared for (a reserved `liveView` type, arriving as a LiveKit video
  track), not built. Phases reordered: V4 transcription (was V5), new V5 Lor in
  the call, V6 iPhone app (was V4), V7 memory and Q&A (was V6).
- 2026-09-30 — Address detection decided (Jacob): two stages, so only
  segments that contain Lor's name reach a language model. A local name gate
  matches "Lor" anywhere in a final segment, plus the homophones lore, law,
  lower, and Laura; V4 adds "Lor" as a Deepgram keyterm on every participant
  stream. Jev (`typesafe-ai/jev`) then answers `addressed`, `kind` (`request` |
  `mention` | `continuation`), and `complete` in one call, and fails closed on
  an error or timeout. Every trigger and rejection is logged. Lor's window
  opens listening on the gate; the run starts only on Jev's answer, and a
  rejection closes the window quietly. Follow-ups must be addressed in the
  first release; a bounded continuation window is deferred. Verified live the
  same day: `POST https://ai-gateway.vercel.sh/typesafe/v1/systemone` works
  with the existing `AI_GATEWAY_API_KEY` in about 250 ms, routed to
  DigitalOcean with typesafe-ai as fallback. The AI SDK path
  (`experimental_evaluate`) needs `ai` >= 7.0.105; `packages/lor` is on 7.0.11.
  Per-request gateway ZDR is plan-gated (Hobby returns 403), so it waits for
  Pro; on Pro, recheck the catalog, which flags jev `zdr=none` while Vercel's
  ZDR table lists both providers.
- 2026-09-30 — V3 code complete on web in five chunks; live QA with the
  webhook tunnel owed (the chat only opens once LiveKit's webhook marks the
  person connected). As built:
  - The live-only rule lives in `packages/db/src/queries/session-chat-access.ts`
    and is applied to sends, `thread:join`, channel-room summaries, thread
    reads, message links, the activity dock, search, unread counts, message
    fanout, and Lor retrieval.
  - Joining or leaving a call moves the person's sockets into or out of the
    live chat's thread room (`sessionChatChanged` on the voice notifier), so
    there's no race with the webhook.
  - A mention from a live chat reaches someone outside the call as "mentioned
    you in a call" with no preview; its push opens the voice channel.
  - The call chat is the existing right panel (thread view titled "Call
    chat"), opened from the call controls, the sidebar call bar, and history
    rows. A live chat never goes into `?threadId`; past chats do.
  - Composer @ suggestions everywhere now follow the channel audience
    (`GET /workspaces/{slug}/channels/{channelId}/audience`); voice chats
    offer no bots.
  - Workspace search now covers voice channels. History rows show new-reply
    and mention counts from `thread_read_state`.
- 2026-09-30 — V4 transcriber decided (Jacob), replacing "deployed as a
  LiveKit Cloud agent" and "through LiveKit Inference":
  - TypeScript `@livekit/agents` worker, self-hosted on Railway. Agent session
    minutes ($0.01/min) apply only to agents LiveKit hosts; a self-hosted
    worker is billed as a participant ($0.0005/min on Ship). That saves about
    $0.57 per call-hour and removes LiveKit's cap on concurrent agent sessions
    (5 on Build, 20 on Ship).
  - Deepgram Nova-3 direct. LiveKit Inference caps concurrent connections per
    project (5 on Build, 20 on Ship, 50 on Scale), so Ship can't transcribe one
    full 30-person call. Deepgram pay-as-you-go allows 150 concurrent streams
    at the same $0.0048/min (a promotion; regular $0.0077), plus $0.0013/min
    for keyterms.
  - One stream per unmuted microphone, not one mixed stream with Deepgram
    diarization: a mixed stream guesses who spoke, and Lor runs voice requests
    as the speaker. People mostly take turns, so with streams closed on mute
    the billed minutes stay close to the call length.
  - Self-hosting lets the transcriber write to Postgres directly, so the
    service-authenticated ingestion API is dropped.
  - Verified in `livekit-server-sdk` 2.19.1: token dispatch
    (`roomConfig.agents`) and `AgentDispatchClient.createDispatch`. Token
    dispatch fires only when LiveKit creates the room. Unverified: whether
    Deepgram bills an open stream that receives no audio.
- 2026-09-30 — V4 chunks 1–3 (storage, transcriber, captions) confirmed
  working locally by Jacob: speech to Deepgram, segments saved, live captions
  with the interim-to-final color change. Fixes found on the way:
  - The transcript foreign keys have explicit names; the generated ones passed
    Postgres's 63-byte limit and got truncated.
  - History counts use query-builder subqueries. drizzle strips table names
    from columns placed directly in a single-table select list, so the V1
    reply count had rendered as `thread_root_id = thread_root_id` and counted
    every thread reply in the database.
  - `pnpm dev` now offers the transcriber. A room created before the
    transcriber was running never gets one until it closes and reopens.
- 2026-10-01 — V4 chunk 4 (reliability) built:
  - The transcriber lease, audit re-dispatch, `no_transcriber` gaps, clean
    finish, and STT minutes, as described in V4. The audit now also covers a
    room created before the transcriber was running (within 10 minutes).
  - Two leaks fixed: a closed or failed speech stream left its LiveKit audio
    stream open and buffering frames. Each stream is now detached and
    cancelled.
  - A released lease records no gap, so time with nobody in the room is never
    marked as missed. Known limit: if people rejoin an emptied room and no
    transcriber arrives, the stretch until the audit's transcriber is not
    recorded.
  - Verified in the SDK sources: shutdown callbacks run after the room
    disconnects, and a client-side disconnect fires no participant-left
    events, so a drained or crashed job keeps its lease and the gap is
    recorded.
- 2026-10-01 — V4 chunk 5 (web transcript view) built, as described in V4.
  Details:
  - The transcript response carries the session start, every participant
    (so a live caption from someone who hasn't spoken yet still gets a name
    and avatar), and each segment's `segmentId`, which matches its captions'
    `lk.segment_id`. Live lines and saved segments merge on that ID.
  - Thread replies return `voiceSessionId` on a call chat's first page, so
    the panel finds the session from any entry point (lobby, URL, search,
    notification).
  - Deviation: the view loads every transcript page in the background
    instead of on scroll, so a live transcript's newest lines are always
    reachable. Live lines show only once all saved pages are in.
  - LiveKit's `useTranscriptions` shares one text-stream handler per room and
    topic (`setupTextStream` in components-core), so the captions overlay and
    the transcript can both listen.
  - The Chat button in the call controls counts unread while the panel shows
    the transcript, and switches the panel to Chat.
- 2026-10-01 — Stale sessions fixed (found in Jacob's testing). A call left
  while the API and worker were stopped kept its session live overnight. The
  next morning's join reused it, and the transcriber recorded a 15.5-hour
  `no_transcriber` gap: the session predated the lease columns, and nobody
  had been in the room. Fixes:
  - A join reconciles a live session with LiveKit before reusing it
    (`confirmLiveSession`). A session empty past the grace period ends there,
    and the join starts a new one. A failed check keeps the session, so a
    LiveKit error doesn't block joins.
  - `reconcileSession` dates missed leaves to the last sign of presence when
    nobody is left in the room, instead of to now. The transcriber's renewal
    makes this accurate to about 30s; without a transcriber, the estimate
    falls back to the latest connection or leave and may end the session
    early.
  - The sweep and the join share one compare-and-set end (`endSession`).
- 2026-10-02 — How Lor communicates (Jacob): no Lor tab, so results live in
  the transcript; no share to chat; reactions only through a model-called
  tool when acknowledging something said to Lor; no thinking or status text,
  only animation. Answers and questions with choices stay in the window.
  Chunks 3–5 replanned.
- 2026-10-01 — V5 design calls (Jacob), after chunk 1: the window opens only
  on Jev's accept; new requests steer the running one and Lor decides whether
  they replace it; results are generative UI from a component catalog, with
  Lor-built components reserved for later; approvals overlay Lor's window.
  Chunks 2–6 replanned to match.
- 2026-10-01 — Review fixes (CodeRabbit, verified by hand):
  - `reconcileSession` only clears connections older than its LiveKit
    snapshot, so a join during the check isn't marked left.
  - Call-mention pushes carry no `messageId`.
  - Leaving clears the cached server call, so "In a call on another device"
    doesn't flash.
  - The sidebar call bar's mute button undeafens like the call controls (one
    `useMicrophoneToggle` hook).
  - The V0 mobile call screen drops a join that finishes after the screen
    closes.
  - Menu side tooltips also show on keyboard focus.
  - Not changed: every transcript page returns all gaps by design; the client
    reads them from the first page.
- 2026-10-06 — Review fixes (CodeRabbit, verified by hand):
  - The leave hint is dropped while LiveKit still lists the person, so one
    that lands after a rejoin can't clear the new connection.
  - The LiveKit webhook route uses Hono's `bodyLimit`, which stops reading a
    chunked body at the limit instead of after it's all in memory.
  - Pinned-message lists and channel-feed thread summaries apply the
    live-only filter.
  - A resume whose run can't start in time fails the request instead of
    leaving it waiting.
  - Partial index `voice_request_runId_idx` on `voice_request` (db:push).
  - Pull request cards are cached in the API for 60s per installation and
    ref, so a whole call shares one GitHub fetch.
  - One `formatCallTime`, in `@repo/realtime-types/call-transcript` (floors).
    The voice package's copy rounded, so a stored passage and `read_call`
    could label the same line one second apart.
  - The phone pre-join preview comes back after a failed join; the Undo toast
    hides once the delete is sent; a Linear issue is overdue after its due
    day, not during it; `read_call` has a tool-trail label and detail; the
    simulator's id helper moved to `apps/web/src/lib/lor-simulation.ts` to
    break an import cycle.
  - Not changed: the transcriber Dockerfile installs like the other images;
    Biome's index-key rule is off in this repo; the pre-join notice stays out
    by decision.

## Production setup (do once at launch)

How it fits together: the API mints a short-lived LiveKit token for each join,
and the token tells LiveKit to dispatch `lor-transcriber` when it creates the
room. Each transcriber copy keeps one outbound connection to the LiveKit
project and reports its load (CPU by default; full above 70% in production),
so LiveKit spreads calls across copies by itself. The transcriber only makes
outbound connections (LiveKit, Deepgram, Postgres); it needs no public URL.

LiveKit Cloud:

- [ ] Move the project to the Ship plan (see Prerequisites).
- [ ] Webhook: `https://<production API host>/v1/voice/livekit/webhook`,
      signed with the same API key as `LIVEKIT_API_KEY`. Remove any ngrok
      webhook URLs; LiveKit sends every event to every configured URL.
- [ ] Optional: a separate LiveKit project for local development, so laptops
      never receive production webhooks. Agent names already keep dispatch
      apart (`lor-transcriber` in production, `lor-transcriber-dev` elsewhere).

Railway, all of API, worker, and transcriber:

- [ ] The same `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET`.

Railway, transcriber service (`apps/transcriber/Dockerfile`, repo root as the
build context):

- [ ] The worker's variables plus `DEEPGRAM_API_KEY`. The Dockerfile sets
      `NODE_ENV=production`, which selects the `lor-transcriber` agent name and
      the SDK's production mode.
- [ ] `PORT=8081`. In production mode the agents SDK serves a health endpoint
      on 8081: `/` returns 200 only while it's connected to LiveKit (503
      otherwise), and `/worker` returns JSON with the active call count.
      Railway health-checks whatever `PORT` says.
- [ ] Health check path `/`. Railway makes a new deployment active only after
      this returns 2xx (it retries for up to 5 minutes by default), so a broken
      build never replaces a working one.
- [ ] `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=3600`. Railway's default is 0, which
      would SIGKILL the old copy at once and cut transcription in every live
      call. With 3600, the old copy gets SIGTERM, the SDK stops taking new calls
      and lets current ones finish (its own drain limit is 60 minutes), while
      the new copy takes new calls. A call still running after an hour gets a
      fresh transcriber from the 10-minute audit, with the missing stretch
      recorded as a gap.
- [ ] Before launch, check two things not yet verified: whether Railway caps
      the draining time, and whether these settings can live in a checked-in
      Railway config file instead of the dashboard.
- [ ] Scaling: add replicas when one copy runs hot. Each copy registers itself
      and LiveKit sends it new calls; no code change.
