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
- Never commit; Jacob owns git. Deliver code in chunks of about 300-400
  changed lines. Stop after each chunk so Jacob can review and commit it.
  Nothing is pushed until the whole feature is done.
- New API routes need `apps/api` and `packages/api-client` rebuilds before
  mobile sees the types.
- Native mobile dependencies need a new dev client build (`pod install`), not an
  OTA update.

## Prerequisites (Jacob)

Before V0:

- [ ] Create a LiveKit Cloud project. The free Build plan is enough for V0 (5
      concurrent connections). Put `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and
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

Before real team use:

- [ ] Move to the Ship plan. Build's 5 concurrent connections can't hold a
      30-person call.

## Locked decisions (do not relitigate without logging a deviation)

| Topic | Decision |
|---|---|
| Transport | LiveKit Cloud. Media never passes through `apps/realtime`; Socket.IO carries Lor state only. |
| Source of truth | Postgres owns sessions and participants. LiveKit webhooks and room APIs are reconciled into Postgres. A client leave request is a hint, never the authority. |
| Session identity | The `voice_session` ID. The LiveKit room name is that ID; the room SID is transport detail. A rejoin inside the grace period reuses the room name, so LiveKit recreates the room if it already closed. |
| One live session per channel | Partial unique index on `voice_session(channel_id) WHERE ended_at IS NULL`; get-or-create in one transaction. |
| Session end | A new session starts empty (`emptySince = startedAt`); the first connection clears `emptySince`, and the last human out sets it. Webhooks drive these changes. A 30s maintenance sweep (`sweep-voice-sessions`) finds sessions empty longer than `VOICE_SESSION_GRACE_MS` (120,000), confirms with LiveKit once that the room is empty, then ends them by compare-and-set on `emptySince` (`endedAt = emptySince`). A 10-minute audit (`audit-voice-sessions`) reconciles occupied sessions. No per-session delayed jobs. LiveKit's server API allows 1,000 requests/minute per project, so only these two paths call it. |
| Participant identity | One `voice_session_participant` row per person per session. Its ID is the LiveKit identity, reused for reconnects and transfers. Display names are never used to map speech to people. |
| Transfer | "Transfer here" joins with the same identity; LiveKit disconnects the older connection, and that device shows where the call went. Verify the disconnect reason in V0. |
| One call per person | Joining a different session removes the person's participant from the old one through the LiveKit room API before the new token is issued. |
| Room cap | 30 people, enforced in the join handler by counting connected humans. The transcriber also joins the room, and LiveKit's docs don't say whether agents count toward its own room limit, so never set that limit to exactly 30. |
| Join response | `{ url, token, sessionId, participantId }`. Clients need no LiveKit env. Tokens are short-lived and grant only that room. |
| Access | Every voice handler starts with `resolveChannelAccess` (`packages/db/src/queries/channel-access.ts`), then requires `channel.type = "voice"` and a non-archived channel. |
| Session chat | Plan pattern: a `voice_session` message is the thread root, `voice_session.threadRootId` is unique, and the session chat is that thread. Voice channels accept no other top-level messages. Root messages post silent. The chat is human-only: Lor mention routing ignores session threads on the server, and the composer doesn't offer Lor. Lor reads the thread as passive context for voice requests. |
| Lor requests | Voice only, triggered from the live transcript when someone addresses Lor directly, then confirmed by an intent check. A request is its own record (session, requester, heard text, run, status, what it showed), not a chat message. It runs as a run with no chat message attached (the automation-run shape), scoped to the session thread, as the speaker, with normal approvals. |
| Lor's window | Mounted only while a request is thinking, working, or showing a result; it animates in and out of the screen-share slot. Shared state for everyone in the call; anyone can clear it or step through the session's earlier results. Content is a typed union from day one: `cards` (Linear issues, GitHub PRs), `answer`, and a reserved `liveView`. A future Lor browser joins the LiveKit room as its own participant and publishes a video track into this slot; non-UUID identities are already ignored by presence and sync. |
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

---

### [ ] V4 — Transcription

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
- Segments are the input V5 listens to for "Lor, …", so ingestion latency
  matters: persist and publish final segments as they arrive, not in batches.

---

### [ ] V5 — Lor in the call

Design: the spec's "Lor in the call" section.

- Address detection on final transcript segments: a cheap text match for
  direct address ("Lor, …", "Hey Lor, …") at the start of an utterance, then a
  fast model check that it's a request to Lor, not discussion about Lor. Log
  every trigger and every rejection so false triggers can be tuned.
- Schema: a request record in `voice.ts` (session, requester participant and
  user, heard text, agent run, status, stage payload, timestamps).
  **db:push owed.**
- Runs: a run with no chat message attached (the automation-run shape; see
  `reference/automation-primitives.md`), scoped to the session thread, as the
  speaker, with the full toolset and approval policies. Context: the recent
  transcript, the session chat as passive background, and the request text.
- Output: tools return typed results; the stage payload is the typed union
  (`cards` | `answer` | reserved `liveView`). Cards: Linear issues and GitHub
  pull requests first, with actions routed through the normal tools and
  approvals.
- Realtime: request and stage events to the session's thread room only
  (live-only rule), so late joiners and every device see the same window.
- Web: Lor's window in the screen-share slot, mounted only while a request is
  active or its result is showing: enter animation, thinking state with "Lor
  heard: …" and Cancel, result, exit animation. Shared clear and step-back
  ("2 of 3"). A Lor tab beside Chat lists the session's requests, with
  "Show on stage".
- Past sessions: Chat, Lor, and Transcript tabs.

---

### [ ] V6 — iPhone app

- Voice channel screen (history, live session, Join or "Transfer here") from
  `apps/mobile/src/app/channel/[channelId]/index.tsx` for voice channels.
- Call screen: camera grid, share viewer with landscape and full screen (the app
  is portrait-only in `app.json`), mute, camera, and leave; no share button.
  Lor's window in the share slot, and Chat and Lor tabs as a sheet.
- A persistent call pill across the navigation stack.
- Background audio and interruptions. No CallKit (V0 decision).
- Session chat through the thread screen
  (`apps/mobile/src/app/channel/[channelId]/thread/[threadRootId].tsx`).
- Participant rows in `apps/mobile/src/components/channel-list.tsx`.
- Push deep links into sessions (`apps/mobile/src/lib/push-target.ts`).
- Update `reference/mobile-parity-todo.md`.

---

### [ ] V7 — Memory and Q&A

- A summary per ended session (extend `packages/lor/src/meeting-insights.ts`)
  with decisions, open questions, and follow-ups; people can correct it.
- Index each ended session's transcript as a source under channel access, with
  links to transcript passages. Session chat messages are ordinary messages and
  become searchable when the session ends.
- Lor text Q&A with grounded links; corrections and deletions propagate.
- Session deletion: a permission statement, and propagation to derived memory.
- Private questions to Lor stay deferred (`reference/private-lor-questions.md`).

---

### Later

- Lor browser and computer use, shown live in Lor's window (`liveView`).
- Spoken answers.
- A generic component kit for results no purpose-built card fits.

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
