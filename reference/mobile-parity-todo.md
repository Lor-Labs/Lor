# Mobile ↔ Web Parity Todo

Tracking what's left to bring `apps/mobile` close to `apps/web` functionality.
Status: `[ ]` todo · `[~]` in progress · `[x]` done. Keep this file updated as items land.

Last audited: 2026-08-04. Tiers 1–2 are done — nothing here gates the TestFlight beta. Everything below is deferred post-launch polish.

## Post-launch — push notification follow-ups

Core push is live and verified on TestFlight (2026-08-04).

- [ ] Badge counts on the app icon.
- [ ] Remote-clearing stale pushes after reading on desktop (needs background push).
- [ ] Expo push receipt sweep (delayed job checking receipts for DeviceNotRegistered beyond ticket-level pruning).
- [ ] Mute control on the mobile DM screen (web DM header has it; mobile mute UI lives only in the channel options sheet).
- [ ] Muted-channel visual styling in sidebars/lists.

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

- [x] Merlin run replay on late join (`src/lib/run-replay.ts` mirrors web's `use-merlin-stream.ts` gate: pending Merlin placeholders fetch `GET /v1/runs/by-message/:messageId/events`, live frames buffer during the fetch then drain gated by `seq`, terminal runs silent-reload the page instead; both message hooks route stream/reasoning/tool/memory/steer frames through `gateRunFrame` + a shared `applyMerlinFrame`) — 2026-08-02
- [x] Merlin run steering/stop affordances (`message:routed` steered/queued chip on the sender's message, "Applying {name}'s new direction…" via `merlin:steer`, Stop button on in-flight replies → `POST /v1/runs/by-message/:messageId/stop` with optimistic "Stopping…" — `MerlinRunControls`/`RoutedChip` in `message-row.tsx`, socket handlers in `use-channel-messages.ts` + `use-thread-messages.ts`; chips are transient client state, same as web) — 2026-08-02
- [x] Workspace instructions (LOR.md) approval flow (`/settings/instructions` screen: jsdiff line diff vs active version, rationale, Approve/Reject with 409-stale handling, read-only for non-admins; `instructions-proposal` push taps deep-link to it incl. workspace switch — never approve from the push itself; web reference `instructions-section.tsx` + admin alert banner in the workspace sidebar) — 2026-08-01
- [x] Channel mutes (`channel_mute` table + `/v1/channel-mutes` GET/PUT/DELETE with lazy expiry pruning; mute silences push + desktop notifications for everything incl. mentions, badges untouched; durations 15m/1h/8h/24h/forever; server-state so it syncs across devices, instant via `channel-mute:updated` user-room event; web bell menu in chat header + sidebar `⋯` menu for channels + DMs, mobile row in channel options sheet + long-press channel row → `channel-actions-sheet` with Mark as read / Mute / Copy ID) — 2026-07-23
- [x] Push notifications, code-complete (`push_token` table + `/v1/push-tokens` register/remove; `sendMessagePushNotifications` in `@repo/messaging` called from realtime sends, Merlin worker replies, and webhook bot posts — pushes only to users with zero connected sockets, decided once at send time so presence changes never flush a backlog; respects `desktopNotifications`/`dmNotifications`; Expo push API with DeviceNotRegistered pruning; mobile registers token on sign-in, removes on sign-out, deep-links taps to channel/thread/DM incl. workspace switch, suppresses foreground banners, clears delivered notifications on app-active) — 2026-07-23
- [x] DMs (Messages tab with conversation list + unread badges; `/dm/[dmId]` chat screen reusing the channel message machinery via `useChannelMessages` source discriminator; "Message" action on the user profile sheet → get-or-create DM; group DMs render but can't be created — same as web) — 2026-07-21
- [x] Workspace sheet (Discord-style: tap home header → `workspace-sheet` with Invite people row, workspace switcher list replacing header chips, create/join row → onboarding) — 2026-07-20
- [x] Sign-up end to end (`sign-up` → `check-email` → `verify-email` deep link with session hand-off via expo plugin `?cookie=` param) + onboarding screen (username → create/join workspace, mirrors web's gate) + create workspace on mobile — 2026-07-20
- [x] Required typed env (`lib/env.ts` Zod schema, no fallbacks; `.env.example` added) — 2026-07-20
- [x] Invites (create/share via `create-invite-sheet` on home header — any member; `lor://invite/CODE` deep-link join screen with preview/accept/sign-in handoff; invite *management* list/revoke stays web-side, admin-tier) — 2026-07-20
- [x] Channel creation (header + button → `create-channel-sheet`, name normalization + category picker; category *creation* stays web-side) — 2026-07-19
- [x] Typing indicators (channel + thread scoped; `use-typing-indicator` mirrors web's throttle/expiry) — 2026-07-19
- [x] React Query for all REST reads (matching web's query-key conventions + 60s staleTime; socket message stores intentionally not migrated) — 2026-07-19
- [x] User profile sheet (tap avatar/name in messages, member list, thread participants) with bio/status/presence, Mention + Copy username actions — 2026-07-19
- [x] Uncategorized channels render flat (no collapsible group) — 2026-07-19
- [x] Workspace search (channels + messages, thread-aware navigation)
- [x] Unread/mention badges (socket-driven), auto-mark-read
- [x] Pins, threads, reactions, edits, replies, attachments, mentions, Merlin rendering, member presence
