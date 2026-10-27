# Mobile ↔ Web Parity Todo

Tracking what's left to bring `apps/mobile` close to `apps/web` functionality.
Status: `[ ]` todo · `[~]` in progress · `[x]` done. Keep this file updated as items land.

Last audited: 2026-10-12 for sessions (the workspace model); other sections as of their own dates. Nothing here gates the TestFlight beta — everything below is deferred post-launch polish.

## Sessions (workspace model, mobile shipped 2026-10-12, `reference/workspace-model-runbook.md` Phase F)

The phone matches web's session model: `@Lor` starts a session, Lor works only in sessions, and chat is for people. Built in Steps 20–34 (as-built notes per step in the runbook). Needs a new EAS build (`expo-crypto` is native) and on-device QA.

- [x] Send path: `@Lor` in chat or a human thread starts a session (client-picked ids, optimistic session, opens it); "New session in #channel" chip — Step 20
- [x] Session screen (`app/session/[sessionId].tsx`): heading with live typed-out titles, event lines, read marking, archived bar — Step 21
- [x] Document look (gutter avatars, muted people-only turns), "To Lor" / "To" + subscriber faces switch, queued turns, Stop — Step 22 (faces: Step 33 follow-up)
- [x] Session rows under each channel on the Channels tab (top 3, "N more", state, collapse); replaced `LorChannelStatus` — Steps 23–24
- [x] New session screen, "Ask Lor" in the long-press menu, meeting follow-ups open sessions — Step 25
- [x] Call Summary tab (read only) and the `call_summary` push opens it — Step 26
- [x] Approvals in every state ("Approved by …"), forwarded-message card — Step 27
- [x] Push, search and pins open sessions at the message — Step 28
- [x] Chat cleanup: no Lor streams, run controls or run queue in chat — Step 29
- [x] Subscriber sheet (add, remove, follow, "Everyone in #channel"), "Added you" toast — Step 30
- [x] Archive with Undo, rename, a channel's Sessions list — Step 31
- [x] Session sheet (Context, Plan, Files, Rename, Archive) and the redesigned proposal card with favicon badges — Step 32
- [x] Forward, avatar typing lines, `sessions_intro` and `session_reply` hints — Step 33
- [x] How Lor works bottom sheet (phone-shaped scenes) — Step 34
- [ ] A failed start from the New session screen lands on "Session unavailable" and loses the draft (the channel composer gets it back).
- [ ] Approve or reject doesn't move the Channels-tab row (needs you → running) at once; the server's activity push moves it a moment later.
- [ ] Search has no Sessions group for title matches (web ⌘K shows one; the API already returns `sessions` on page 1). Mobile shows the session title on message hits — `planned/session-memory.md` Step 2.

## Code sessions (catch-up pass started 2026-10-26, `reference/planned/code-sessions-runbook.md`)

Goal (Jacob): mobile works with code sessions, including starting one, without web's full capability yet.

- [x] M1: readable session event rows (continued, committed, pushed, forked, rewound) with their icons and links to the other session or the GitHub commit; a rewind's set-aside turns folded under a "Previous history" row.
- [x] M2: Claude Code plan card (Approve and accept edits / Approve, ask for edits / Keep planning) and question stepper (options, a written answer, Previous / Skip / Next, Send), through the approve-plan and answer endpoints; answered cards show "Answered by … · Color: Blue". Approving a plan does not change the mode of mobile's next message (mobile has no mode picker; it sends Auto).
- [x] M3: a code icon on Channels-tab session rows and the repo on a channel's Sessions page; the heading shows repo and branch (opens GitHub), the harness, and "Forked from" / "Continued from" (a fork opens its source at the reply); the session sheet links the source and, in a code session, drops Files and shows Plan only for Lor's own agent (as web's Details tab); the people-only notice above the composer in a Claude Code session for senders without a linked Claude account (connecting is on web for now); tool icons for Claude Code's web and notebook tools and Codex's file changes and images.
- [x] M4: starting a code session from New session: Chat | Code tabs, "on <repo> <branch> with <agent>" picks in bottom sheets (repo search on the device, branch search on the server, the default branch tagged), remembered on the device like web; Claude Code without a linked account blocks the send with a "connect on web" note. The start sends `code` and `harness`, and the session shows as a code session before the server confirms it. Its turns use the server's defaults (Claude Code: Auto on Opus; Codex: GPT-6.1 Sol).
- [x] D1 (Changes and Files drawer, Jacob 2026-10-26: all three chunks): a code button in a code session's header with the changed-file count opens a tall sheet: changed files (Tracked / Untracked, status dot, +/- counts), each file's diff, the Lor-working and merge notes, and the restoring / gone states; live through the same socket events as web.
- [x] D2: Changes | Files tabs in the drawer; the Files tab is the repo tree (folders first, changed files and the folders holding them marked, a "Find a file" filter) and a read-only viewer (text with line numbers, images loaded with the session cookie, notes for binary, too large and missing files). The header button shows the lines added and removed (Jacob: +/−, not a file count).
- [ ] D3: stage and unstage, commit message (with the model's draft), Commit, Push, Pull, the pull-request link; needs a GitHub account linked on web.
- [ ] Later: fork and rewind actions, composer mode and model pickers, context meter, syntax highlighting in the drawer (skipped 2026-10-26; recommended: the API returns Shiki tokens with web's themes, since Hermes has no WebAssembly for Shiki's default engine).

## Post-launch — onboarding (web shipped 2026-10-08, `reference/onboarding.md`)

- [ ] `lor_reply` hint. Web shows it on the tool trail of the first Lor reply you watched finish ("Lor shows its work…"); mobile never built it (`MobileHintKey` has no `lor_reply`).
- [ ] Native setup checklist. Web has `/{key}/setup`; mobile only shows a "Finish setup on the web" card on the Channels tab (Step 9) with an Open on web button. A native screen would cover the invite link, the join-by-domain switch, and the Ask Lor suggestions, with GitHub and Linear as "Connect on web" rows: their install and OAuth callbacks land on `app.lor.chat` in the phone's browser, outside the app. Revisit if workspace creation on mobile becomes common.
- [ ] Creator edit of their own channel (rename, topic). Web shows Edit Channel to the creator since Step 6a; mobile's channel options still gate on `channel:update`.

## Post-launch — sidebar Lor activity (web shipped 2026-09-14, `reference/archive/sidebar-realtime-activity-plan.md`)

- Superseded 2026-10-11: session rows replaced the per-channel Lor state (workspace-model Steps 23–24), and the server no longer sends `ChannelActivity.lor` (Step 35). History:
- [x] Per-channel Lor state in mobile's channel list — 2026-09-14, same session as web. `src/hooks/use-workspace-activity.ts` mirrors web (AppState replaces window focus: refresh on active, clear on background; 100ms coalesce; 15s poll fallback); `LorChannelStatus` in `channel-list.tsx` (accent ActivityIndicator scaled 0.7 = working, accent dot = queued, `bg-warning-soft` `!` badge = needs_approval/needs_input, same tokens as plan-ui.tsx) rendered in `ChannelRow` via `lorState` prop, workspace id from `useWorkspace()` inside `ChannelList`. Precedence lives server-side. JS-only → ships via `eas update`. Needs on-device QA. NOTE: channel viewer avatars were removed from web by design (surveillance concern) — do NOT port those.

## Post-launch — push notification follow-ups

Core push is live and verified on TestFlight (2026-08-04).

- [ ] Badge counts on the app icon.
- [ ] Remote-clearing stale pushes after reading on desktop (needs background push).
- [ ] Expo push receipt sweep (delayed job checking receipts for DeviceNotRegistered beyond ticket-level pruning).
- [ ] Mute control on the mobile DM screen (web DM header has it; mobile mute UI lives only in the channel options sheet).
- [ ] Muted-channel visual styling in sidebars/lists.

## Post-launch — Tasks

Renamed **Plans** on 2026-09-12 (LOR-61); the file names below are from before the rename. Sessions keep their plan and files in the session sheet (workspace-model Step 32). The thread work header was deleted 2026-10-13 (`session-files-runbook.md` Step M3): Lor never works in human threads.

Core task surfaces shipped 2026-08-10 (`use-tasks.ts`, `task-ui.tsx`, `task-card.tsx`, `task-thread-header.tsx`; needs on-device QA):

- [x] `task_card` messages render as a task card (title, status badge, live plan, deliverable file rows; tap opens the thread) — 2026-08-10
- [x] Task thread: header says **Task**, docked strip with status + Plan/Files anchored popovers (heroui-native `Popover`, Outputs vs Sources split) + always-visible approval card — 2026-08-10
- [x] Approve/reject from mobile (`POST /v1/approvals/:id/approve|reject`) — 2026-08-10
- [x] Deliverables at the end of Lor messages (`files` on create_artifacts tool calls) as tappable file rows — 2026-08-10
- [x] File viewer (2026-10-13, `session-files-runbook.md` Step M2): every file chip opens `app/file.tsx`, a read-only modal for Lor's files and uploads (CSV table, markdown and text, images; Share and Open in browser for the rest).
- [x] Sandbox sub-step diffs (2026-10-13, `session-files-runbook.md` Step M4): sub-steps are flat rows with +N −N counts, a file chip for delivered files and a tap-to-open diff and output, as on web. The parent's live `detail.summary` opens in the tool drawer.
- [x] Tasks v2 re-anchor (2026-09-12): task rows anchor to `threadRootId` (card is a projection); mobile `useTaskForThread`, thread-screen re-skin predicate, card tap target, and a screen-level `useChannelTasks` subscription on the channel screen all shipped with the web steps (`reference/tasks-v2.md` Steps 2/7).
- [x] Lor activity collapsible ported 2026-09-12 (`lor-activity.tsx` + work/answer split in `lor-message-body.tsx`). Deliberately single-level: web's inner `LorActivityGroup` tier is skipped because mobile's reasoning/tool-trail rows already carry their own disclosures — one outer "Worked · N tool calls" collapsible wraps them.
- ~~Thread work header Activity chip~~ (2026-09-12): deleted with `ThreadWorkHeader` in `session-files-runbook.md` Step M3.
- ~~Known gap: deep-linked thread misses live task:updated~~ Closed 2026-09-12: `useThreadMessages` joins the channel room and the thread screen now mounts `useChannelTasks` via `useTaskForThread`, so task flips land live on deep-linked threads.
- Active-tasks indicator in the channel header — dropped; web removed its own header chip in the 2026-08-09 design round.

## Post-launch — Loops

`loop_card` rendering + draft activation shipped 2026-08-24 (`use-loops.ts`, `loop-card.tsx`; mirrors web's compact pill — infinity icon, name, plain-english schedule via `@repo/realtime-types/loops`, status chip, kept live by `loop:updated`; drafts show a Create Loop button that activates in the device timezone, with the high-frequency 422 confirm as a native Alert). Still web-only:

- [ ] Loop detail view (web: right-panel `loop-panel.tsx` — full prompt, structured schedule editor `PATCH /v1/loops/:id`, timezone picker; mobile activation always pins the device tz).
- [ ] Pause/resume/complete once those routes land (L3, web-first).

## Approval policies (LOR-81/83, shipped mobile 2026-09-02)

- [x] Generalized approval card under any parked run reply (`approval-card.tsx`
  in `message-row.tsx`, gated by `lorTriggerMessageId`); task header uses
  the same card; buttons gated by shared `canResolveApproval` with real
  custom-role grants. Since workspace-model Steps 27 and 29 only thread and
  session screens mount `useChannelApprovals`; a session lists every
  approval in it (`?threadRootId=`), decided ones too.
- [x] Approval push (`type: "approval"`) opens the session at the message
  (`sessionId` in push data, workspace-model Step 28).

## Change proposals (pillar 3, shipped mobile 2026-09-05)

- [x] `proposal_card` renderer (`proposal-card.tsx`); redesigned to match
  web's 2026-10-09 card in workspace-model Step 32 (one framed card, a row
  per change, favicon source badges via `/v1/favicon`, optimistic
  approve/reject); hooks in `use-proposals.ts` (all-statuses channel query,
  `proposal:updated` invalidation, authority-union mirror via
  `workspaceAuthorityHasPermissions`).
- [x] Proposal push (`type: "proposal"`) opens the session at the message
  (workspace-model Step 28).
- [x] `channel:created` listener (in `use-project-updates.ts`) refetches the
  channel list when a proposal apply (or a teammate) creates a channel.

## Post-launch — custom roles (web shipped 2026-08-31, `reference/custom-roles.md`)

- [x] **Custom-role grants fetchable on mobile** — `dynamicAccessControl`
  enabled in the auth client + `use-workspace-roles.ts` hook (2026-09-02,
  LOR-83). Approval cards gate their buttons with real grants; NOT yet
  threaded into `use-member-moderation.ts` / `use-channel-permissions.ts`,
  which still degrade custom roles to member-tier (server enforces).
- [ ] Thread the custom-role grants map through `use-member-moderation.ts`
  and `use-channel-permissions.ts` so e.g. `workspaceMember:kick` holders see
  moderation UI on mobile.
- [ ] **Assign custom roles from mobile** — `roleOptionsFor` offers static
  roles only; the role PATCH endpoint accepts custom names already.
- [ ] Roles management UI (create/edit/delete) stays web-side — same tier as
  invite management; probably never a mobile surface.

## Post-launch — DM follow-ups

- [ ] Group-DM member list sheet (group DMs can't be created from either client yet).
- [ ] DM threads (API exists; web has no DM thread UI either — do together or not at all).

## Post-launch — composer & detail polish

Deliberately parked until the composer/keyboard rework settles (active in message-composer.tsx / chat-keyboard-layout.tsx).

- [ ] **Full emoji reaction picker** — mobile has only 6 quick reactions in the long-press menu.
- [ ] **Slash commands** — mobile composer's `/` toolbar button is a dead placeholder (web: `composer/slash-command-list.tsx`).
- [ ] **Formatting toolbar** — mobile composer's text-format button is also a no-op.
- [ ] **Bio editing** — profile sheet displays bio but nothing can edit it anywhere (column is dormant since web removed it). Needs a product call on whether bios come back before any UI work.

## Voice calls (reference/voice-channels-runbook.md, V6)

- [x] Join, mute, camera, tiles, share viewer, call chat, leave — 2026-10-05
- [x] Lor's window, read-only (all block types, Linear/GitHub rows, approval waiting line, cancel/clear) — 2026-10-05
- [x] Approval buttons, "Show on stage", step-back, tappable question choices, tool logos and reactions in Lor's window — 2026-10-06
- [x] Live words in Lor's window while it listens, from the call's captions — 2026-10-06
- [x] Floating call tile across navigation (the call outlives its screen), "Switch to this call", and who's connected under voice channels in the channel list — 2026-10-06
- [x] Full-screen share viewer (rotate, pinch and double-tap zoom) and push deep links into a call (worked already) — 2026-10-06
- [ ] Android background call audio: needs our own `microphone` foreground service (not in the LiveKit SDK or its Expo plugin), a native build, and an Android device — deferred
- [x] Voice channel screen before joining: live call card (who's in, how long, Join or "Transfer here") and past calls with unread dots and mention counts; a past call opens its chat — 2026-10-06
- [x] Pre-join like web's (camera preview, mic and camera toggles, your name) and front/back camera before and during a call, in place of web's device pickers — 2026-10-06
- [x] Lor's call summary card, read-only (`call-summary-card.tsx`): title, day, length, faces, decisions, open questions, action items, byline — 2026-10-06; since workspace-model Step 26 it is the body of the call's Summary tab
- [x] Transcript tab (speaker turns, gaps, Lor's results inline), opening at a moment from summary-card times, "Open transcript", and `[[call:…]]` citations — 2026-10-06
- [x] Live captions: over the stage with a CC button remembered on the device, and in the transcript of the call you're in (replaces the 10s refetch) — 2026-10-06
- [ ] Summary editing. Web's Summary tab has Edit / "Write one" (`PUT /v1/voice/sessions/{sessionId}/summary`, gated by `canEdit`); the phone's tab is read only.
- [x] Delete a call with Undo: long-press a past call, 10s Undo toast — 2026-10-06
- [x] Lor's call title on past-call rows, and an unread count on the call drawer's chat button — 2026-10-06

## Explicitly not gaps (don't chase)

- **Session turn rail** (`session-turn-rail.tsx`) — a hover feature; web-only by decision (workspace-model Phase F).
- **Integration OAuth setup (GitHub/Linear), channel webhooks tab** — inherently web-side. (Onboarding itself exists on mobile as `src/app/onboarding.tsx`; the setup checklist is tracked under onboarding above.)

## Done (recent parity work)

- [x] Push notifications verified live on TestFlight (EAS/APNs credentials in place; code was complete since 2026-07-23, see entry below) — 2026-08-04
- [x] Profile sheet in pins + home search results (`useProfileSheet.openAuthorProfile` widened to a structural author type so `ChannelSearchResult` rows qualify; pins screen `MessageRow` passes `onPressAuthor`, home search result avatars are now pressable; both screens render `UserProfileSheet` with the Message action wired to `useOpenDM`, Mention omitted — no composer there) — 2026-08-03
- [x] DM search (search icon on the Messages tab → `dm-search-overlay` + `use-dm-search` hitting `GET /v1/dms/search`, debounced + paginated like channel search; tapping a result opens `/dm/[dmId]?focusMessageId=` — the DM screen gained the same loadAround + focus handling the channel screen has) — 2026-08-03
- [x] Workspace settings + agent profiles (workspace sheet gained a management section: Instructions row for everyone → existing `/settings/instructions` screen — previously push-deep-link-only; admin/owner-gated rows → new `/settings/workspace` screen for rename + icon via `workspace-icon` presign upload, and `/settings/agent-profiles` screen mirroring web's profile cards + capability tile editor; refreshes workspace context via `reloadWorkspaces`) — 2026-08-03
- [x] Member management (long-press a row in the channel member sheet → `member-actions-sheet` with Make admin/member + Kick; gating in `use-member-moderation.ts` mirrors the server hierarchy rules — self/bots excluded, admins can only kick members, only the owner can promote to admin; kick confirms via alert, mutations invalidate `workspace-members`) — 2026-08-03

- Note (2026-10-11, workspace-model Step 29): Lor no longer runs in channel chat, so the channel parts of the next two entries are gone (`use-channel-messages.ts` Lor handlers, `LorRunControls`; sessions stop runs from the composer). Thread and session screens keep replay, steering and `RoutedChip`.
- [x] Lor run replay on late join (`src/lib/run-replay.ts` mirrors web's `use-lor-stream.ts` gate: pending Lor placeholders fetch `GET /v1/runs/by-message/:messageId/events`, live frames buffer during the fetch then drain gated by `seq`, terminal runs silent-reload the page instead; both message hooks route stream/reasoning/tool/memory/steer frames through `gateRunFrame` + a shared `applyLorFrame`) — 2026-08-02
- [x] Lor run steering/stop affordances (`message:routed` steered/queued chip on the sender's message, "Applying {name}'s new direction…" via `lor:steer`, Stop button on in-flight replies → `POST /v1/runs/by-message/:messageId/stop` with optimistic "Stopping…" — `LorRunControls`/`RoutedChip` in `message-row.tsx`, socket handlers in `use-channel-messages.ts` + `use-thread-messages.ts`; chips are transient client state, same as web) — 2026-08-02
- [x] Workspace instructions (LOR.md) approval flow (`/settings/instructions` screen: jsdiff line diff vs active version, rationale, Approve/Reject with 409-stale handling, read-only for non-admins; `instructions-proposal` push taps deep-link to it incl. workspace switch — never approve from the push itself; web reference `instructions-section.tsx` + admin alert banner in the workspace sidebar) — 2026-08-01
- [x] Channel mutes (`channel_mute` table + `/v1/channel-mutes` GET/PUT/DELETE with lazy expiry pruning; mute silences push + desktop notifications for everything incl. mentions, badges untouched; durations 15m/1h/8h/24h/forever; server-state so it syncs across devices, instant via `channel-mute:updated` user-room event; web bell menu in chat header + sidebar `⋯` menu for channels + DMs, mobile row in channel options sheet + long-press channel row → `channel-actions-sheet` with Mark as read / Mute / Copy ID) — 2026-07-23
- [x] Push notifications, code-complete (`push_token` table + `/v1/push-tokens` register/remove; `sendMessagePushNotifications` in `@repo/messaging` called from realtime sends, Lor worker replies, and webhook bot posts — pushes only to users with zero connected sockets, decided once at send time so presence changes never flush a backlog; respects `desktopNotifications`/`dmNotifications`; Expo push API with DeviceNotRegistered pruning; mobile registers token on sign-in, removes on sign-out, deep-links taps to channel/thread/DM incl. workspace switch, suppresses foreground banners, clears delivered notifications on app-active) — 2026-07-23
- [x] DMs (Messages tab with conversation list + unread badges; `/dm/[dmId]` chat screen reusing the channel message machinery via `useChannelMessages` source discriminator; "Message" action on the user profile sheet → get-or-create DM; group DMs render but can't be created — same as web) — 2026-07-21
- [x] Workspace sheet (Discord-style: tap home header → `workspace-sheet` with Invite people row, workspace switcher list replacing header chips, create/join row → onboarding) — 2026-07-20
- [x] Sign-up end to end (`sign-up` → `check-email` → `verify-email` deep link with session hand-off via expo plugin `?cookie=` param) + onboarding screen (create/join workspace, mirrors web's gate; the username step was removed in LOR-89) + create workspace on mobile — 2026-07-20
- [x] Required typed env (`lib/env.ts` Zod schema, no fallbacks; `.env.example` added) — 2026-07-20
- [x] Invites (create/share via `create-invite-sheet` on home header; `lor://invite/CODE` deep-link join screen with preview/accept/sign-in handoff; invite *management* list/revoke stays web-side, admin-tier) — 2026-07-20. LOR-43 (2026-10-13): admins only, email invites with a role picker in the same sheet, and pending email invites listed in onboarding. The invite email links to the web app (no universal links), so an app sign-up gets the normal verification email, not the invite-link shortcut.
- [x] Channel creation (header + button → `create-channel-sheet`, name normalization + category picker; category *creation* stays web-side) — 2026-07-19
- [x] Typing indicators (channel + thread scoped; `use-typing-indicator` mirrors web's throttle/expiry) — 2026-07-19
- [x] React Query for all REST reads (matching web's query-key conventions + 60s staleTime; socket message stores intentionally not migrated) — 2026-07-19
- [x] User profile sheet (tap avatar/name in messages, member list, thread participants) with bio/status/presence, Mention action (Copy username removed in LOR-89) — 2026-07-19
- [x] Uncategorized channels render flat (no collapsible group) — 2026-07-19
- [x] Workspace search (channels + messages, thread-aware navigation)
- [x] Unread/mention badges (socket-driven), auto-mark-read
- [x] Pins, threads, reactions, edits, replies, attachments, mentions, Lor rendering, member presence
