# Mobile ↔ Web Parity Todo

Tracking what's left to bring `apps/mobile` close to `apps/web` functionality.
Status: `[ ]` todo · `[~]` in progress · `[x]` done. Keep this file updated as items land.

Last audited: 2026-07-19.

## Tier 1 — big functional gaps

- [ ] **Push notifications** — `expo-notifications` installed but nothing wired. Full-stack: token registration on device, server-side send pipeline (mention/DM/thread activity), tap-to-deep-link. Biggest retention lever.
- [ ] **DMs** — largest missing surface. API fully built (`/dms`, `/dms/:id/messages`, thread, search). Needs own tab/stack per the scoped-vs-global nav rule (never mixed into workspace sidebar). Also unblocks a "Message" action on the mobile user profile sheet.

## Tier 2 — admin & workspace management

- [ ] **Member management** — role change + kick from the member sheet (API exists: `PATCH /members/:userId/role`, `POST /members/:userId/kick`; mobile sheet is read-only).
- [ ] **Workspace settings** — rename/logo + Merlin profiles section (web: `workspace-settings-dialog.tsx`, `merlin-profiles-section.tsx`).

## Tier 3 — composer & detail polish

- [ ] **Full emoji reaction picker** — mobile has only 6 quick reactions in the long-press menu.
- [ ] **Slash commands** — mobile composer's `/` toolbar button is a dead placeholder (web: `composer/slash-command-list.tsx`).
- [ ] **Formatting toolbar** — mobile composer's text-format button is also a no-op.
- [ ] **Bio editing** — profile sheet displays bio but nothing can edit it anywhere (column is dormant since web removed it). Add to mobile account settings if bios should be real.
- [ ] **Wire profile sheet into pins screen + home search results** — `MessageRow`s there don't pass `onPressAuthor` yet.

## Explicitly not gaps (don't chase)

- **Voice** — web has no real voice implementation either (no WebRTC/LiveKit); voice channels are just a list type.
- **Onboarding dialog, integration OAuth setup (GitHub/Linear), channel webhooks tab** — inherently web-side.

## Done (recent parity work)

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
