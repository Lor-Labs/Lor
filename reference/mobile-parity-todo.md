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

Renamed **Plans** on 2026-09-12 (LOR-61); the file names below are from before the rename. Sessions keep their plan and files in the session sheet (workspace-model Step 32); the thread work header shows on human threads only.

Core task surfaces shipped 2026-08-10 (`use-tasks.ts`, `task-ui.tsx`, `task-card.tsx`, `task-thread-header.tsx`; needs on-device QA):

- [x] `task_card` messages render as a task card (title, status badge, live plan, deliverable file rows; tap opens the thread) — 2026-08-10
- [x] Task thread: header says **Task**, docked strip with status + Plan/Files anchored popovers (heroui-native `Popover`, Outputs vs Sources split) + always-visible approval card — 2026-08-10
- [x] Approve/reject from mobile (`POST /v1/approvals/:id/approve|reject`) — 2026-08-10
- [x] Deliverables at the end of Lor messages (`files` on create_artifacts tool calls) as tappable file rows — 2026-08-10
- [ ] Artifact viewer — deliberately punted: artifacts open in the in-app browser sheet (`openExternalUrl`), same as attachments. A native CSV/markdown viewer screen is post-demand, mirroring web's read-only decision.
- [ ] Sandbox sub-step diffs + live summary (2026-08-13, web shipped): `lor:tool` frames now carry `diff` ({path, additions, deletions, patch}) on write/edit sub-steps and stream the sandbox agent's text into the parent call's `detail.summary` mid-run. Mobile's `lor-message-body.tsx` ignores both (additive, nothing breaks) — needs +N/−N counts and an expandable diff row to match web's `lor-tool-trail.tsx`.
- [x] Tasks v2 re-anchor (2026-09-12): task rows anchor to `threadRootId` (card is a projection); mobile `useTaskForThread`, thread-screen re-skin predicate, card tap target, and a screen-level `useChannelTasks` subscription on the channel screen all shipped with the web steps (`reference/tasks-v2.md` Steps 2/7).
- [x] Lor activity collapsible ported 2026-09-12 (`lor-activity.tsx` + work/answer split in `lor-message-body.tsx`). Deliberately single-level: web's inner `LorActivityGroup` tier is skipped because mobile's reasoning/tool-trail rows already carry their own disclosures — one outer "Worked · N tool calls" collapsible wraps them.
- [x] Thread work header Activity chip ported 2026-09-12 (`task-thread-header.tsx` → `thread-work-header.tsx`, `ThreadWorkHeader`): renders for any thread with Lor tool activity; Activity `SectionPopover` shows the newest run's trail via the trail's new `embedded` prop; Plan/Files stay task-gated. Needs on-device QA + `eas update` (JS-only).
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
