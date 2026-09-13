# Lor Mobile — iOS Architecture Plan

Expo + React Native client for Lor, reaching feature parity with `apps/web`.
iOS-only for v1. This plan assumes the existing Turborepo and reuses every
framework-agnostic package we already ship.

## Goal & guiding principle

Rebuild the **view layer**, reuse the **logic layer**. The web app already
decoupled its backend contract, API client, realtime types, and auth into
shared packages. Mobile consumes those directly. We do **not** fork business
logic — a bug fixed in a shared hook is fixed everywhere.

Non-goals for v1: Android, voice/video (not wired on web yet either), tablet
layouts, offline-first sync.

---

## 1. What we reuse vs. rebuild

| Layer | Package | Mobile action |
|---|---|---|
| API contract | `@repo/api` (types only) | reuse as-is |
| Typed RPC client | `@repo/api-client` (`honoClient`) | reuse, swap fetch impl |
| Realtime event/room types | `@repo/realtime-types` | reuse as-is |
| Auth client | `@repo/auth/client` (better-auth) | reuse, swap transport (see §5) |
| Env schema | `@repo/env` | reuse |
| Utils | `@repo/utils` | reuse |
| **UI primitives** | `@repo/ui` (shadcn/Radix/Tailwind) | **rebuild** as `@repo/ui-native` |
| **Screens & feature components** | `apps/web/src` | **rebuild** in `apps/mobile` |
| **Data/socket hooks** | `apps/web/src/hooks/*` | **extract & share** (see §4) |

Rule of thumb from the audit: ~70% of component code is layout/state that
adapts cleanly, ~15% is web-only primitives (dialogs, editor, popovers) needing
native equivalents, ~15% needs gesture handling.

---

## 2. Monorepo placement

```
apps/
  web/            existing Vite SPA
  www/            existing marketing site
  mobile/         NEW — Expo app
packages/
  api-client/     reused
  auth/           reused (+ expo transport)
  realtime-types/ reused
  ui/             web only, unchanged
  ui-native/      NEW — RN mirror of ui's component API
  chat-core/      NEW — shared headless hooks (extracted from web)
```

- `apps/mobile` is a standard Expo app added to the pnpm workspace.
- Metro `watchFolders` + `nodeModulesPaths` configured to resolve workspace
  symlinks (Expo's monorepo guide).
- Turbo `build`/`check-types`/`lint` tasks extended to cover mobile.
- Shared packages stay TS-source (no build step) to match the existing
  uncompiled-package convention.

---

## 3. Tech stack

| Concern | Choice | Rationale |
|---|---|---|
| Framework | **Expo (managed)** + React Native | OTA updates, EAS build, dev client |
| Language | TypeScript | monorepo consistency |
| Routing | **Expo Router** | file-based, 1:1 map from TanStack Router tree |
| Data fetching | **TanStack Query v5** | identical API to web, hooks port directly |
| Client state | React Context | mirror web (`Socket`, `Unread`, sidebar contexts) |
| Auth | **better-auth + `@better-auth/expo`** | reuse client, secure-store session |
| Realtime | `socket.io-client` | same lib, add lifecycle handling |
| Styling | **NativeWind v4** | Tailwind syntax → reuse class knowledge & tokens |
| Animation | **Reanimated 3** + Gesture Handler | replaces `motion` + `@dnd-kit` |
| Markdown | `react-native-markdown-display` (custom rules) | replaces `streamdown` |
| Code highlight | `react-native-syntax-highlighter` / Shiki-via-webview fallback | replaces `lowlight` |
| Rich composer | **custom controlled `TextInput`** (see §6) | no TipTap equivalent |
| Icons | `@hugeicons/react-native` (+ `lucide-react-native` fallback) | matches web default |
| File picking | `expo-image-picker`, `expo-document-picker` | replaces `react-dropzone` |
| Notifications | `expo-notifications` | replaces Tauri notify + browser notify |
| Secure storage | `expo-secure-store` | session token |
| Build/deploy | **EAS Build + EAS Update** | CI builds + OTA |

---

## 4. Sharing the logic layer (`packages/chat-core`)

The web hooks in `apps/web/src/hooks/` are ~80% portable logic and ~20% DOM.
Extract the portable core so both clients import it.

**Pure/portable → move to `packages/chat-core`:**
- `use-channel-messages`, `use-thread-messages` (query + socket subscription)
- `use-message-sending/editing/deletion/reactions/pinning` (optimistic mutations)
- `use-typing-indicator` (debounced emits)
- `use-lor-stream` (streaming event assembly)
- `use-thread-activity`, `use-auto-mark-read` (logic portion)

**Platform-specific → stay per-app, thin wrappers:**
- `use-browser-notifications` → `use-push-notifications` (Expo) on mobile
- `use-file-upload` → same presign flow, different picker source
- `use-app-version` / `use-update-check` → EAS Update on mobile

Approach: refactor each shared hook so socket + query logic is
platform-agnostic and any DOM touch (scroll position, `document`, `window`) is
injected via params or moved to the wrapper. Do this incrementally — extract a
hook to `chat-core`, update the web import, verify web still works, then mobile
picks it up for free.

---

## 5. Auth & transport (the plumbing that differs)

Web uses cookie auth (`credentials: "include"`, `withCredentials`). RN has no
cookie jar, so switch to bearer-token transport — the same problem already
solved for Tauri via the `appFetch` custom fetch impl.

- Use `@better-auth/expo` plugin: stores the session token in
  `expo-secure-store`, attaches it as a bearer header automatically.
- Wire `honoClient` (`@repo/api-client`) with a mobile fetch that injects the
  same bearer header (mirror `apps/web/src/lib/api-client.ts`, minus cookies).
- **Socket.IO handshake:** pass the token in the `auth` payload of
  `io(url, { auth: { token } })` — the realtime gateway already supports a
  handshake-token fallback (built for Tauri). No server change needed.
- OAuth connector callbacks (GitHub/Linear/Datadog) use `expo-web-browser` +
  `expo-auth-session` with a deep-link redirect (`lor://integrations/...`).

Server changes required: **none anticipated** — bearer + handshake-token paths
already exist. Verify during the week-1 spike.

---

## 6. The hard subsystem: rich composer

TipTap/ProseMirror is DOM-only; there is no drop-in RN port. Rebuild as a
controlled `TextInput` with overlay affordances:

- Base: multiline `TextInput` holding markdown source.
- **Mentions** (`@user`): detect trigger, render a suggestion sheet, insert a
  styled token. Track mention ranges in state (mirror web `mention-types.ts`).
- **Slash commands** (`/code-block` etc.): same trigger/overlay pattern.
- **Formatting:** send markdown; the server + renderer already speak markdown,
  so WYSIWYG is optional for v1 (defer bold/italic toolbar).
- Evaluate `@10play/tentap-editor` (webview-backed TipTap) as a fallback if the
  custom input can't hit fidelity — but prefer native for input latency.

This is the #1 risk. Spike it in week 1 before committing the estimate.

---

## 7. UI component mapping (`packages/ui-native`)

Mirror `@repo/ui`'s export surface so screens stay thin and portable. NativeWind
lets us keep the Tailwind token vocabulary (`bg-background`, `bg-sidebar`,
`bg-accent` — see `packages/ui/src/styles/globals.css`; per project convention,
use tokens, never hardcoded colors).

| Web primitive | RN replacement |
|---|---|
| Radix Dialog / AlertDialog | RN `Modal` + custom sheet |
| Radix Popover / DropdownMenu | `@gorhom/bottom-sheet` or anchored overlay |
| Radix Tooltip / HoverCard | long-press popover (or drop — low value on touch) |
| Sheet (mobile sidebar) | drawer via Expo Router / Reanimated |
| ScrollArea | native `ScrollView` |
| Message list virtualization | **`FlashList`** (Shopify) or `FlatList` |
| Resizable sidebar | N/A — mobile uses drawer, not split pane |
| `@dnd-kit` channel reorder | Reanimated + Gesture Handler (or defer to v1.1) |
| `motion` transitions | Reanimated 3 |
| `emoji-picker-react` | `@gorhom/bottom-sheet` grid or native keyboard |

Message rendering (`message-markdown`, `lor-message-body`, tool trail,
reasoning) rebuilds on `react-native-markdown-display` with custom rules for
citations (`[[/path]]`, `[[msg:id]]`, `[[src:id|title|url]]`) and streaming.

---

## 8. Realtime lifecycle

Socket.IO runs on RN, but mobile app lifecycle needs handling web doesn't:

- Single lazy socket (mirror `apps/web/src/lib/socket.ts`), connect after auth.
- On `AppState` background → disconnect (or let heartbeat lapse); on foreground
  → reconnect and re-emit `channel:join` / `presence:subscribe` for the active
  view. Re-fetch the current channel's tail to fill any gap.
- `notification:mention` / `notification:unread` drive badge counts; when
  backgrounded, hand off to `expo-notifications` for local/push display.
- Throttle presence updates while backgrounded.

Event set is unchanged from web (channel/thread/message/typing/presence/lor/
notification families in `@repo/realtime-types`).

---

## 9. Screen inventory (maps to Expo Router)

Auth stack (unauthenticated):
- `login`, `signup`, `forgot-password`, `reset-password`, `check-email`
- `invite/[code]`

App stack (authenticated, guarded layout):
- workspace + channel: `[workspaceSlug]/[channelId]` (chat, threads, right-panel
  as sheets/drawers on mobile)
- DMs: `dms`, `dms/[dmId]`
- settings: account / appearance / notifications / workspace (native screens,
  not URL-dialogs)
- integrations OAuth callbacks: `integrations/github`, `integrations/linear`,
  `integrations/datadog`
- onboarding: create-workspace flow (shown when no workspaces)

Right-panel views (thread / pinned / members) become bottom sheets or pushed
screens rather than a side pane.

---

## 10. Phased delivery

**Phase 0 — Risk spikes (week 1).** De-risk the two unknowns before committing:
composer prototype (mentions + slash) and auth+socket handshake end-to-end
(login → connect → receive a live `message:created`). Scaffold `apps/mobile`,
Metro monorepo config, NativeWind, Expo Router shell.

**Phase 1 — Foundation (week 2).** `packages/ui-native` core primitives; extract
first shared hooks to `packages/chat-core`; auth flow (login/signup/session
persistence); authenticated shell + navigation.

**Phase 2 — Core chat (weeks 3–4).** Channel list + workspace switcher; message
list (`FlashList`) with pagination; send/edit/delete/react/pin; typing; read
state; realtime wiring. This is the demo-able core loop.

**Phase 3 — Lor & threads (week 5).** Streaming Lor responses, reasoning,
tool trail, memory; threads (sheet); citation rendering.

**Phase 4 — DMs & settings (week 6).** DM list + conversation; settings screens;
onboarding; invites.

**Phase 5 — Integrations & polish (weeks 7–8).** OAuth connector flows; push
notifications; channel reorder (or defer); empty/error/loading states; EAS
build + TestFlight.

**Estimate:** ~6–8 weeks to a shippable core (through Phase 4), ~2–3 months to
full parity. Solo dev; parallelizable across two.

---

## 11. Open questions / decisions to confirm

- **Composer fidelity:** custom `TextInput` vs. webview TipTap — settle after
  the Phase 0 spike.
- **Server auth paths:** confirm bearer + socket handshake-token work without
  server changes (expected yes; verify).
- **Channel reorder:** ship in v1 or defer to v1.1? (Low value on mobile.)
- **Push notifications:** APNs setup + whether backend already emits a
  push-worthy event, or we derive from `notification:mention`.
- **Icons:** confirm `@hugeicons/react-native` parity with the web icon set.
- **Distribution:** TestFlight-only for v1, or straight to App Store review?

---

## 12. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Composer has no RN port | High | Phase 0 spike; markdown-first, defer WYSIWYG |
| Socket lifecycle on mobile flaky | Medium | AppState reconnect + tail re-fetch; test on device early |
| `ui-native` scope creep (~50 primitives) | Medium | Build on demand per screen, not all upfront |
| Shared-hook extraction breaks web | Medium | Extract incrementally, verify web after each move |
| Markdown/streaming render fidelity | Medium | Custom renderer rules; accept minor visual drift v1 |
| Push/APNs setup overhead | Low | Standard Expo path; scope to mentions only |
