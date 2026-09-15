# Mobile ↔ Web Parity Todo

Tracking what's left to bring `apps/mobile` close to `apps/web` functionality.
Status: `[ ]` todo · `[~]` in progress · `[x]` done. Keep this file updated as items land.

Last audited: 2026-08-04. Nothing here gates the TestFlight beta — everything below is deferred post-launch polish.

## Post-launch — sidebar Lor activity (web shipped 2026-09-14, `reference/sidebar-realtime-activity-plan.md`)

- [x] Per-channel Lor state in mobile's channel list — 2026-09-14, same session as web. `src/hooks/use-workspace-activity.ts` mirrors web (AppState replaces window focus: refresh on active, clear on background; 100ms coalesce; 15s poll fallback); `LorChannelStatus` in `channel-list.tsx` (accent ActivityIndicator scaled 0.7 = working, accent dot = queued, `bg-warning-soft` `!` badge = needs_approval/needs_input, same tokens as plan-ui.tsx) rendered in `ChannelRow` via `lorState` prop, workspace id from `useWorkspace()` inside `ChannelList`. Precedence lives server-side. JS-only → ships via `eas update`. Needs on-device QA. NOTE: channel viewer avatars were removed from web by design (surveillance concern) — do NOT port those.

## Post-launch — push notification follow-ups

Core push is live and verified on TestFlight (2026-08-04).

- [ ] Badge counts on the app icon.
- [ ] Remote-clearing stale pushes after reading on desktop (needs background push).
- [ ] Expo push receipt sweep (delayed job checking receipts for DeviceNotRegistered beyond ticket-level pruning).
- [ ] Mute control on the mobile DM screen (web DM header has it; mobile mute UI lives only in the channel options sheet).
- [ ] Muted-channel visual styling in sidebars/lists.

## Post-launch — Tasks

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
  custom-role grants; channel + thread screens mount `useChannelApprovals`.
- [x] Approval push (`type: "approval"`) deep-links through the existing
  message target (channelId/threadRootId) — no push-target change needed.
- Known gap (same shape as task:updated): `approval:created/updated` arrive
  via the channel room; a deep-linked thread without the channel screen
  mounted still refetches on mount, so the card settles on open. Fine for v1.

## Change proposals (pillar 3, shipped mobile 2026-09-05)

- [x] `proposal_card` timeline renderer (`proposal-card.tsx`; mirrors web —
  indicator-on-rail per op, framed detail panels, status chip, secret
  TextInputs, reject-with-note, copy webhook URL, Open #channel provenance);
  hooks in `use-proposals.ts` (all-statuses channel query, `proposal:updated`
  invalidation, authority-union mirror via `workspaceAuthorityHasPermissions`).
- [x] Proposal push (`type: "proposal"`) deep-links through the existing
  message target — no push-target change needed.
- [x] `channel:created` listener (in `use-project-updates.ts`) refetches the
  channel list when a proposal apply (or a teammate) creates a channel.
- Web-only for now: collapsible step panels (mobile panels always expanded)
  and favicon source badges (mobile shows hostname chips, no favicon fetch).

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

## Explicitly not gaps (don't chase)

- **Voice** — web has no real voice implementation either (no WebRTC/LiveKit); voice channels are just a list type.
- **Onboarding dialog, integration OAuth setup (GitHub/Linear), channel webhooks tab** — inherently web-side.

## Done (recent parity work)

- [x] Push notifications verified live on TestFlight (EAS/APNs credentials in place; code was complete since 2026-07-23, see entry below) — 2026-08-04
- [x] Profile sheet in pins + home search results (`useProfileSheet.openAuthorProfile` widened to a structural author type so `ChannelSearchResult` rows qualify; pins screen `MessageRow` passes `onPressAuthor`, home search result avatars are now pressable; both screens render `UserProfileSheet` with the Message action wired to `useOpenDM`, Mention omitted — no composer there) — 2026-08-03
- [x] DM search (search icon on the Messages tab → `dm-search-overlay` + `use-dm-search` hitting `GET /v1/dms/search`, debounced + paginated like channel search; tapping a result opens `/dm/[dmId]?focusMessageId=` — the DM screen gained the same loadAround + focus handling the channel screen has) — 2026-08-03
- [x] Workspace settings + agent profiles (workspace sheet gained a management section: Instructions row for everyone → existing `/settings/instructions` screen — previously push-deep-link-only; admin/owner-gated rows → new `/settings/workspace` screen for rename + icon via `workspace-icon` presign upload, and `/settings/agent-profiles` screen mirroring web's profile cards + capability tile editor; refreshes workspace context via `reloadWorkspaces`) — 2026-08-03
- [x] Member management (long-press a row in the channel member sheet → `member-actions-sheet` with Make admin/member + Kick; gating in `use-member-moderation.ts` mirrors the server hierarchy rules — self/bots excluded, admins can only kick members, only the owner can promote to admin; kick confirms via alert, mutations invalidate `workspace-members`) — 2026-08-03

- [x] Lor run replay on late join (`src/lib/run-replay.ts` mirrors web's `use-lor-stream.ts` gate: pending Lor placeholders fetch `GET /v1/runs/by-message/:messageId/events`, live frames buffer during the fetch then drain gated by `seq`, terminal runs silent-reload the page instead; both message hooks route stream/reasoning/tool/memory/steer frames through `gateRunFrame` + a shared `applyLorFrame`) — 2026-08-02
- [x] Lor run steering/stop affordances (`message:routed` steered/queued chip on the sender's message, "Applying {name}'s new direction…" via `lor:steer`, Stop button on in-flight replies → `POST /v1/runs/by-message/:messageId/stop` with optimistic "Stopping…" — `LorRunControls`/`RoutedChip` in `message-row.tsx`, socket handlers in `use-channel-messages.ts` + `use-thread-messages.ts`; chips are transient client state, same as web) — 2026-08-02
- [x] Workspace instructions (LOR.md) approval flow (`/settings/instructions` screen: jsdiff line diff vs active version, rationale, Approve/Reject with 409-stale handling, read-only for non-admins; `instructions-proposal` push taps deep-link to it incl. workspace switch — never approve from the push itself; web reference `instructions-section.tsx` + admin alert banner in the workspace sidebar) — 2026-08-01
- [x] Channel mutes (`channel_mute` table + `/v1/channel-mutes` GET/PUT/DELETE with lazy expiry pruning; mute silences push + desktop notifications for everything incl. mentions, badges untouched; durations 15m/1h/8h/24h/forever; server-state so it syncs across devices, instant via `channel-mute:updated` user-room event; web bell menu in chat header + sidebar `⋯` menu for channels + DMs, mobile row in channel options sheet + long-press channel row → `channel-actions-sheet` with Mark as read / Mute / Copy ID) — 2026-07-23
- [x] Push notifications, code-complete (`push_token` table + `/v1/push-tokens` register/remove; `sendMessagePushNotifications` in `@repo/messaging` called from realtime sends, Lor worker replies, and webhook bot posts — pushes only to users with zero connected sockets, decided once at send time so presence changes never flush a backlog; respects `desktopNotifications`/`dmNotifications`; Expo push API with DeviceNotRegistered pruning; mobile registers token on sign-in, removes on sign-out, deep-links taps to channel/thread/DM incl. workspace switch, suppresses foreground banners, clears delivered notifications on app-active) — 2026-07-23
- [x] DMs (Messages tab with conversation list + unread badges; `/dm/[dmId]` chat screen reusing the channel message machinery via `useChannelMessages` source discriminator; "Message" action on the user profile sheet → get-or-create DM; group DMs render but can't be created — same as web) — 2026-07-21
- [x] Workspace sheet (Discord-style: tap home header → `workspace-sheet` with Invite people row, workspace switcher list replacing header chips, create/join row → onboarding) — 2026-07-20
- [x] Sign-up end to end (`sign-up` → `check-email` → `verify-email` deep link with session hand-off via expo plugin `?cookie=` param) + onboarding screen (create/join workspace, mirrors web's gate; the username step was removed in LOR-89) + create workspace on mobile — 2026-07-20
- [x] Required typed env (`lib/env.ts` Zod schema, no fallbacks; `.env.example` added) — 2026-07-20
- [x] Invites (create/share via `create-invite-sheet` on home header — any member; `lor://invite/CODE` deep-link join screen with preview/accept/sign-in handoff; invite *management* list/revoke stays web-side, admin-tier) — 2026-07-20
- [x] Channel creation (header + button → `create-channel-sheet`, name normalization + category picker; category *creation* stays web-side) — 2026-07-19
- [x] Typing indicators (channel + thread scoped; `use-typing-indicator` mirrors web's throttle/expiry) — 2026-07-19
- [x] React Query for all REST reads (matching web's query-key conventions + 60s staleTime; socket message stores intentionally not migrated) — 2026-07-19
- [x] User profile sheet (tap avatar/name in messages, member list, thread participants) with bio/status/presence, Mention action (Copy username removed in LOR-89) — 2026-07-19
- [x] Uncategorized channels render flat (no collapsible group) — 2026-07-19
- [x] Workspace search (channels + messages, thread-aware navigation)
- [x] Unread/mention badges (socket-driven), auto-mark-read
- [x] Pins, threads, reactions, edits, replies, attachments, mentions, Lor rendering, member presence
