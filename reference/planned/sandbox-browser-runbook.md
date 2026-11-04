# Sandbox browser and run setup runbook (code sessions)

> Status: planned, not started. Written 2026-11-03 with Jacob. Vendor,
> Blaxel and tool facts were checked on the web on 2026-11-03; check them
> again at the spike. Covers LOR-125 (revamp `.lor/environment.json`).

Status legend: `[ ]` todo · `[x]` done. Update the checkboxes as steps land,
and add to the **Deviations log** at the bottom when reality forces a change.

This runbook does three things in one pass:

1. **A real browser in the session sandbox.** Chromium runs next to the dev
   server, so `http://localhost:3000` works. People watch and drive it in the
   Browser panel. Lor drives the same browser to check its own work. It
   replaces the iframe of `dev-environment-runbook.md` §3 and step 3b.
2. **Run setup v2** (LOR-125). `.lor/environment.json` gets profiles,
   readiness checks, start order, a path to open and notes for Lor. It
   extends step 4b of `dev-environment-runbook.md`.
3. **Sandbox size on the Lor environment.** A memory setting (8 or 16 GB)
   on the `environment` row, not in the repo file.

Out of scope: the hosted browser for web tasks with logins (#gtm). That stays
in `agent-browser.md`. Both browsers share the Browser panel and Lor's
browser commands where they can.

## Why the iframe fails

The Browser panel today is an iframe of the port's preview URL
(`lor-….preview.bl.run`). The page's origin is the preview host, not
localhost. That breaks real apps (found 2026-11-03):

- **Next.js 16 dev never hydrates.** Next 16 answers 403 to requests for
  `/_next/*` dev resources when the `Origin` is not localhost or in
  `allowedDevOrigins` (`block-cross-site-dev.js` in Next 16.4.3). The HMR
  WebSocket always sends an `Origin`. `reactDebugChannel` is on by default
  and feeds over that socket. The page renders its server HTML, and buttons
  that wait for hydration stay disabled. Next has no env var for this, so
  `SANDBOX_PROCESS_ENV` cannot fix it the way it fixes Vite.
- **Auth origin checks** (better-auth `trustedOrigins`, CSRF guards) reject
  the preview origin on sign-in.
- **Other ports go to the wrong machine.** A client call to
  `http://localhost:3001` goes to the viewer's own computer, not the
  sandbox.
- **Private previews need a cookie** that is third-party in the iframe
  (and always third-party in the desktop app, origin `tauri://localhost`).
- JSON and plain-text pages showed white text on white in OS dark mode.
  The iframe's `scheme-light` class fixes that (2026-11-03). It goes away
  with the iframe.

A hosted browser (Browserbase, Steel, Kernel) cannot fix this. It runs
outside the sandbox and would load the same preview URL. Chrome skips proxies
for localhost, and Kernel's private networking rejects loopback addresses.

## Decisions (Jacob, 2026-11-03)

- **Build it on Blaxel, behind the provider seam.** No sandbox provider has
  a better primitive. E2B Desktop, Daytona, Hopx and Blaxel's own templates
  all show the desktop through noVNC over a WebSocket, and none of them gives
  secure take-over with several viewers. Moving providers costs about 1,200
  lines of sandbox code and the credit metering. Features use only
  `ensureProcess`, `exposePort` and `portReady`, and never assume that
  processes survive idle: the beta runbook plans to evaluate Boat right
  after launch (Boat keeps the disk, not memory or processes).
- **No Cua.** It controls a whole desktop with screenshots and clicks (no
  DOM refs). Its hosted cloud ended 2026-10-18, its computer server is no
  longer maintained, and its live-view daemon is FSL-licensed and streams over
  UDP.
- **The browser runs in the session sandbox** for code sessions. The hosted
  vendor in `agent-browser.md` stays for web tasks: CAPTCHA solving,
  per-channel logins that outlive sandboxes, non-datacenter IPs.
- **Live view v1: VNC over WebSocket.** x11vnc or KasmVNC behind a private
  preview, with noVNC as the client. It needs no TURN relay and shows native
  dialogs and dropdowns. neko over WebRTC comes later, and only if VNC
  quality is not good enough. It needs a TURN relay unless Blaxel exposes
  UDP.
- **No CDP screencast for the interactive view.** Steel measured 4–12 fps
  and missing native dialogs, and moved its cloud to WebRTC.
- **Lor drives the browser over CDP from inside the sandbox.** It uses a
  command-line tool (agent-browser `--cdp` or playwright-cli) that returns
  page snapshots with element refs. CDP binds to 127.0.0.1 and is never
  exposed.
- **One browser per session**, shared by everyone who watches. One person
  controls it at a time, and Lor pauses while a person has control.
- **Keep `.lor/environment.json`.** Lor writes it and fixes it, as it does
  now. Products where people "just tell the agent" (Codex, Claude Code,
  Jules) have no Start buttons. Every product with Start buttons keeps a
  structured service list (Conductor, Replit, Ona, Dev Containers). The file
  never holds secrets or the sandbox size.
- **Sandbox size lives on the Lor environment.** Three reasons:
  - The repo is cloned inside the sandbox after the sandbox is created, so
    a size in the file arrives too late.
  - Blaxel cannot change memory in place: a memory change redeploys the VM.
    `createIfNotExists` ignores a new size.
  - Size is a cost setting on the shared credit pool, and one sandbox may
    hold several repos later.

  People with `environment: ["manage"]` set it. Lor asks for a change; it
  never makes one.
- **Multi-repo stays later.** The schema already allows it
  (`environment_repo`); this runbook builds nothing for it (see Later).

## Research summary (2026-11-03)

**Sandbox providers.** All of them cost about $0.33 an hour at 8 GB.

| Provider | Live view | Agent control | Notes |
|---|---|---|---|
| Blaxel | Hub templates: `xfce-vnc` (TigerVNC + noVNC on 6901), `chromium` (headless CDP), `playwright-chromium` | DIY over CDP | Standby resume under 25 ms. Idle WebSockets close after 15 min. Live traffic keeps the sandbox active and billed |
| E2B Desktop | noVNC, x11vnc `-shared` | xdotool; CDP DIY | 8 GiB max, 24 h cap. `view_only` is only a URL setting |
| Daytona | noVNC through previews | Mouse/keys/screenshot, accessibility tree; CDP DIY | Containers lose memory on stop. Default org cap 4 vCPU / 8 GB |
| Runloop | Live view (technology undocumented) | Playwright over CDP | $0.42–0.63 an hour |
| Cua | Cloud ended 2026-10-18 | Screenshot/click | Not used |

**Building blocks.**

| Part | Choice | Alternatives |
|---|---|---|
| Display | Xvfb (or the Xorg dummy driver) + openbox, about 1280×800 | — |
| Browser | Headful Chromium: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --user-data-dir=<on /workspace> --no-sandbox --disable-dev-shm-usage` | Kernel's `kernel-images` as a reference design (about 1.09 GB, needs `--privileged`) |
| Live view | x11vnc or KasmVNC + websockify, noVNC client (MPL-2.0) | neko v3 (WebRTC, Apache-2.0, built-in control lock, needs TURN) |
| Agent control | agent-browser `--cdp` (`snapshot -i`, `@e1` refs) or playwright-cli `attach --cdp` | Playwright `connectOverCDP` + `ariaSnapshot({ mode: "ai" })`; Chrome DevTools MCP |

**Run setup in other products.** Patterns worth copying:

- The agent writes the config (Devin opens a PR; Codex and Conductor write
  their own).
- Named run sets with a default: Conductor `default`, Compose profiles,
  Ona `manual` triggers, `turbo --filter`.
- `dependsOn` with readiness checks: process-compose `http_get`, Ona
  `ready`.
- Port metadata and a page to open: Dev Containers `portsAttributes`.
- Notes for the agent: Cursor terminal descriptions, Devin `knowledge`.
- Size as a minimum clamped by the workspace: Dev Containers
  `hostRequirements` and Codespaces' allowed machine types.
- Secrets by name only, outside the file.

**Blaxel sizing.**

- Memory is set in MB at create.
- CPU follows memory, but the docs disagree on the ratio: 16 GB gives 6 or
  8 cores. Check with `nproc`.
- The root filesystem's writable layer lives in RAM, about half of memory,
  and `/dev/shm` uses RAM too. Browser profile and cache go on `/workspace`.
- An ephemeral volume's size cannot change after create.
- A persistent volume can be re-attached to a new, larger sandbox, but this
  runbook doesn't need it.
- Standby has no compute charge.
- `QUOTA_EXCEEDED` is the account tier's memory limit, so bigger sandboxes
  reach it sooner (`SandboxCapacityError`).

## Design

### 1. Run setup v2 (`.lor/environment.json`)

v2 replaces v1 with no compatibility (Jacob, 2026-11-03). `services` becomes
an object keyed by service name, so `dependsOn` and `profiles` refer to keys.
A v1 file reads as invalid, and the panel's "Ask Lor to fix it" rewrites it.

```json
{
  "install": "pnpm install",
  "services": {
    "api": {
      "command": "pnpm dev",
      "cwd": "apps/api",
      "port": 8787,
      "ready": { "http": "/health", "timeout": 120 }
    },
    "web": {
      "command": "pnpm dev",
      "cwd": "apps/web",
      "port": 3000,
      "dependsOn": ["api"],
      "open": "/",
      "description": "Main app. Sign in with the seeded user from apps/api/seed.ts."
    },
    "www": { "command": "pnpm dev", "cwd": "apps/www", "port": 3001, "open": "/" }
  },
  "profiles": { "default": ["web"], "marketing": ["www"] }
}
```

- Service keys use today's name rule: short, lowercase letters, digits and
  dashes.
- `install` runs before each start under the existing flock, as now.
- `ready`: optional. `http` is a path that must answer 2xx or 3xx on the
  service's port. `timeout` is in seconds (default 120). Without `ready`, the
  service is ready when its port listens, which is today's rule.
- `dependsOn`: services to start first. A service starts when everything it
  depends on is ready. The schema rejects cycles and unknown names.
- `open`: the path the Browser panel opens when the service is ready. A
  service without `open` (an API, a worker) gets no Open action.
- `description`: notes for Lor (seed users, quirks). The panel doesn't show
  them.
- `profiles`: named lists of services. Starting a profile also starts each
  service's `dependsOn`. The key `default` is what the panel's Start runs.
  Without `profiles`, Start runs every service, which is today's rule.
- Start is idempotent. A service whose port already listens counts as
  running, whoever started it (today's rule).
- After a profile starts, the browser goes to the first service in it with
  `open`.
- Lor's code-session prompt explains each field, and says to write profiles
  for monorepos and to fix the file when a start fails.

### 2. Sandbox size

- `environment.sandbox_memory_mb`: nullable integer. Null means the default
  (`LOR_CODE_SANDBOX_MEMORY_MB`). The API accepts only 8192 and 16384 for
  now. Code sessions only; chat sessions keep their size.
- `createSessionSandbox` reads it through the session's
  `agent_session.environment_id`. A sandbox keeps its size until it is
  replaced, as today. Applying a new size to a live session (replace the
  sandbox, restore from the newest checkpoint) is a later action, not v1.
- The environment editor shows the cost: 1.25 credits per GB-hour, so 16 GB
  costs 20 credits an hour while it runs. In the beta that also doubles
  Lor's subsidy per sandbox-hour (`beta-pricing-runbook.md`, Cost basis).
  Hosted beta caps the size at 16 GB.
- **Lor asks.** When builds, servers or the browser die from lack of memory
  (exit 137, `Killed`, all processes restarted after an out-of-memory
  crash), Lor says so and names the larger size. When change proposals
  (`change-proposals.md`) can carry it, Lor files an operation that sets
  `sandbox_memory_mb` and that a manager approves.

### 3. Browser process

- **Image** (`packages/lor/sandbox-image/Dockerfile`): Xvfb, openbox,
  Chromium, the VNC server, websockify and the agent browser command. Copy
  the details from Blaxel's `xfce-vnc` and `chromium` hub templates (fake
  D-Bus socket, hostname fix, `slim: false`).
- **One named process, `browser`**, started through `ensureProcess` the
  first time the Browser panel opens or Lor runs a browser command. A start
  script runs the display, Chromium, the VNC server and the gateway (§4),
  and restarts Chromium when it exits. Turn fencing does not kill it.
  Nothing assumes it survives idle: each open calls `ensureProcess` first.
- Chromium's profile and cache go under `${WORKSPACE_MOUNT}/.cache/lor-browser`
  (disk, not RAM, and outside the repo).
- Add 9222 (CDP), the VNC port and the gateway port to `HIDDEN_PORTS`.
- **Lor's browser command.** A small `lor-browser` command in the image
  wraps agent-browser with `--cdp 9222` and refuses while a person has
  control. It is a command, not a Lor tool, so it works the same in Pi,
  Claude Code and Codex. Lor posts screenshots with `share_file`. The
  prompt tells Lor to check its UI changes in the browser and how to start
  the run setup's services.

### 4. Live view

- **Gateway** (a small Node process in the sandbox, part of `browser`):
  - It serves the noVNC WebSocket and relays it to the local VNC server.
  - It checks a per-viewer token on connect.
  - It forwards input (RFB key, pointer and clipboard messages) only from
    the controller, so view-only is enforced in the sandbox, not by a URL
    setting. If KasmVNC's view-only users cover this, use them instead and
    record it in the log.
  - It also pushes the page URL and title from CDP, for the address bar.
  - Roles live in a control file under `/workspace/tmp/lor-browser` that the
    API writes through process exec. The gateway and `lor-browser` read it.
    Files and processes keep it provider-neutral.
- **API** (code sessions, channel write access, like the terminal):
  - `POST /sessions/{id}/browser` runs `ensureProcess` and `portReady`,
    writes a viewer token, and returns the gateway's `wss` URL through a
    private `exposePort`.
  - `POST /sessions/{id}/browser/navigate` changes the page over CDP.
  - `POST /sessions/{id}/browser/control` takes or releases control and
    emits a socket event to the session room.
- **Panel** (`session-browser-panel.tsx`):
  - The noVNC client (`@novnc/novnc` RFB) runs inside our app, the way
    xterm.js runs for the terminal. The view scales to the panel.
  - The address bar shows the real `localhost:<port>/path` from the
    gateway. Back, forward and reload go over CDP.
  - Start (profile) and Open (service) from §1 stay. "Take control" and
    "Hand back" sit in the toolbar; watchers see who controls.
  - The view disconnects when the page has been hidden for 2 minutes, as
    the iframe does now, because live traffic keeps the sandbox billed. It
    reconnects on show and after Blaxel's 15-minute idle WebSocket close.
  - "Open in your browser" stays (the preview URL), so the TCP relay and
    `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` stay.
- **Desktop:** the CSP already allows `wss://*.bl.run`. Add the custom
  preview domain when `LOR_PREVIEW_DOMAIN` is set.
- **Phone:** a Browser row in the session sheet opens the view full screen.
  noVNC supports touch. Typing on iOS is unverified.

### 5. Element comments

People point at elements on the page and send notes to Lor ("make this
button match the header"). Prior art: Cursor's browser element picker sends
the element to its agent; React Grab (MIT) copies an element's HTML and its
component file for coding agents.

- **Pick.** "Comment" in the toolbar takes control and turns on Chromium's
  own element picker over CDP (`Overlay.setInspectMode` with
  `searchForNode`). Chromium draws the DevTools hover highlight inside the
  page, so it shows in the live view for every viewer, whatever the
  transport. A click fires `Overlay.inspectNodeRequested` with the node's
  `backendNodeId`.
- **Context.** The gateway reads the node over CDP:
  - a unique CSS selector;
  - its role and accessible name;
  - its text and a truncated `outerHTML`;
  - its box, and a cropped screenshot (`Page.captureScreenshot` with a
    clip);
  - the page URL.
- **Note.** The panel opens a note box next to the element's box. People
  can pick several elements with a note each, then send them together. Each
  picked element gets a numbered marker, drawn by a small overlay in a CDP
  isolated world (shadow root, no pointer events) so the app's own scripts
  never see it.
- **Send.** The notes go into the session as one message with element
  chips: selector, snippet and screenshot for each. Lor finds the source
  file in the repo from that context, makes the change, then checks it
  with `lor-browser` (same selector, new screenshot).
- **Not in v1:** component source paths (React Grab style; it needs a hook
  that runs before the page's scripts), and comments that stay on the page
  across reloads.

### 6. Provider requirements

Everything in the sandbox is plain Linux processes in our image, so the
browser moves with the sandbox. A provider needs:

- a custom image, root (or a user that can run Chromium with
  `--no-sandbox`) and 1–2 GB of spare memory (the spike measures it);
- long-running background processes (`ensureProcess`);
- HTTPS and WebSocket ingress to a port with a short-lived credential
  (`exposePort`);
- outbound internet (and only for a later WebRTC transport: TCP or UDP out
  to a TURN relay).

Rules that keep it portable:

- Browser code uses only `ensureProcess`, `exposePort` and `portReady`.
- Paths come from the seam, not from `WORKSPACE_MOUNT` (Boat allows files
  only under `/home/user` and `/tmp`).
- Nothing assumes the browser survives idle. After a stop, `ensureProcess`
  starts it again, and the profile on disk brings back the logins. Open
  tabs are lost unless Chromium restores the last session.
- The image build (`bl push` today) and preview domains are the only other
  per-provider parts.

## Steps

Each step is a review chunk of about 300–400 lines.

- [x] **0. Spike** (2026-11-03).
  - [x] Image with Xvfb, openbox, headful Chromium, x11vnc, websockify and
    noVNC; RAM and CPU measured locally and on Blaxel (notes below).
    KasmVNC was not compared: x11vnc was fast enough.
  - [x] noVNC through a private preview: Jacob in Safari on macOS, "feels
    pretty damn responsive to be a remote desktop", and in iPhone Safari,
    "worked pretty good too". The Tauri app needs the panel (step 4).
    The spike sandbox and image were deleted afterwards.
  - [x] agent-browser attaches to the headful Chromium over CDP. Chosen;
    playwright-cli not tried.
  - [x] A Next.js 16 app hydrates at localhost with no `allowedDevOrigins`
    edit. better-auth sign-in moves to the live QA in step 6.
  - Dropped: asking Blaxel about UDP (WebRTC is on hold).
  - Moved to the Boat evaluation: WebSockets through Boat's port exposure
    and the browser restart after a stop.
  - Exit: the default code sandbox stays 8 GB (the stack used 1.8 GB with a
    Next dev server and two tabs); x11vnc; agent-browser.
  - Local run, 2026-11-03 (Docker on arm64, the workbench's Debian trixie
    base). Image section and `browser/lor-browser-start` added to
    `sandbox-image/`; not pushed to Blaxel yet.
    - Packages: Chromium 156, x11vnc 0.9.17, noVNC 1.6, websockify 0.12,
      agent-browser 0.41.1. The browser layer adds 1.06 GB to the image.
    - Memory (PSS): Chromium with three real tabs (a Next app, GitHub,
      react.dev) about 673 MB; Xvfb, openbox, x11vnc and websockify about
      67 MB; the agent-browser daemon 20 MB; a fresh Next 16.4.5 dev server
      about 480 MB. The container total was 1.08 GiB, CPU about 1% at rest.
      Idle on `about:blank` the stack took about 240 MB.
    - `agent-browser connect 9222` attaches to the headful Chromium (no
      second browser). `snapshot -i`, `open`, `tab new`, `eval` and
      `screenshot` work.
    - A `create-next-app` Next 16.4.5 page opened at
      `http://localhost:3000` hydrates (React fibers on the DOM, origin
      localhost, no blocked cross-origin requests in the dev log), with no
      `allowedDevOrigins` edit. Not yet tried with better-auth.
    - playwright-cli was not tried; agent-browser covers what Lor needs.
  - Blaxel run, 2026-11-03: image `sandbox/workbench-browser-spike` (pushed
    with `bl push --name`, so `workbench` was untouched), one 8 GB sandbox
    with the production egress config (`proxy: { routing: [] }`).
    - 8 GB gives 4 cores (`nproc`), so the API schema's MB / 2048 rule holds.
    - **Blaxel's egress proxy re-signs HTTPS** ("Blaxel MITM CA", in
      `SANDBOX_EXTRA_CA_CERTS`). Chromium trusts only its NSS store, so every
      outside site failed with `ERR_CERT_AUTHORITY_INVALID`.
      `lor-browser-start` now imports that CA with `certutil` (new package
      `libnss3-tools`) before it starts Chromium; react.dev and GitHub then
      loaded. `NO_PROXY` covers localhost, so dev servers never touch the
      proxy.
    - The private preview carries the noVNC page and its WebSocket:
      `vnc.html` 200 with `bl_preview_token`, then the cookie alone; the
      `/websockify` upgrade answers 101 with the cookie and 401 without.
    - A Next 16.4.5 dev app at `http://localhost:3000` hydrates in the
      sandbox's Chromium, with no blocked requests in the dev log.
    - Memory (PSS) with two tabs (the Next app, GitHub): Chromium 624 MB,
      Next dev 462 MB, display and VNC 76 MB, agent-browser 17 MB; 1.8 GB
      used of 8 GB. CPU idle with no viewer connected.
    - Chromium's restart loop works: killing Chromium brought it back on the
      same profile within seconds.
    - Standby keeps it: after the sandbox sat idle, Chromium, noVNC and
      the Next dev server were still running with both tabs.
    - CPU with Jacob connected from Safari for 90 s: the sandbox stayed
      81–95% idle on 4 cores. x11vnc and Xvfb together took about 3–12% of
      one core (websockify under 1%). Chromium itself reached 43% of one
      core while rendering, which any browser spends.
- [ ] **1. Sandbox size on the environment.** Column
  `environment.sandbox_memory_mb` (Jacob runs `db:push`), API validation,
  the editor field with the credit cost, `createSessionSandbox` reads it,
  the hosted-beta cap, and Lor's prompt line about memory failures.
- [ ] **2. Run setup v2.** Schema and validation in `repo-setup.ts`
  (services keyed by name; `ready`, `dependsOn`, `open`, `description`,
  `profiles`; no v1 support). Start a
  profile in dependency order with readiness checks. API
  `POST /sessions/{id}/setup/profiles/{name}/start`. The panel's Start runs
  the default profile, and a menu lists the other profiles and services.
  Prompt update in `code-session.ts`. Works with the iframe until step 4.
- [ ] **3. Browser process and Lor's browser command.** Image (`bl push`),
  the `browser` process and start script, `HIDDEN_PORTS`, `lor-browser`
  with the control-file check, prompt lines, and screenshots through
  `share_file`.
- [ ] **4. Live view.** Gateway, the three API routes, the panel with the
  noVNC client, address bar over CDP, take control and hand back, the
  hidden-tab and idle reconnects, desktop CSP, and the phone row. Probably
  two chunks: view and navigation, then control.
- [ ] **5. Element comments.** Picker over CDP, node context and cropped
  screenshot in the gateway, the note box and markers, the message with
  element chips, and Lor's prompt line for acting on them.
- [ ] **6. Remove the iframe and run live QA.** Delete the iframe path and
  its `scheme-light` fix. Keep "Open in your browser". Live QA on a Next.js
  16 monorepo with better-auth: profile start, sign in, Lor checks a UI
  change, two viewers, take control, element comments, idle and return.
  Then move this doc to the root as the as-built reference (link sweep).

## Later

- **Multi-repo.** One environment with several repos and one sandbox. Each
  repo is cloned into its own folder, and its file's services are named
  `repo/service`. Profiles that span repos live on the environment.
- **Better video.** Only if VNC is not smooth enough for scrolling and
  animations. Jacob, 2026-11-03: not in the spike. Options:
  - neko over WebRTC with a TURN relay (Cloudflare: $0.05/GB after 1,000 GB
    free a month), at about 2–2.5 cores of software encoding during
    full-screen 1080p motion;
  - voxl (H.264 over a WebSocket, no TURN; young, GPL through x264).

  The transport sits behind the gateway, so control, navigation and
  comments do not change.
- **Resize a live session.** Replace the sandbox at the new size and restore
  from the newest checkpoint.
- **Larger sizes** (32 GB) once there's real demand and a price.
- **Comments that stay on the page** across reloads, anchored by selector
  and text, and component source paths for picked elements.
- **Recording** of browser sessions.

## Open questions

- Whether 16 GB stays the hosted-beta cap. (The default stays 8 GB, and
  Lor uses agent-browser: spike, 2026-11-03.)
- Whether Lor's browser use counts against anything beyond sandbox time.
- How the Browser panel picks between this browser and the hosted vendor
  browser when a code session needs a site with logins.

## Sources

- Next.js: `node_modules/next/dist/server/lib/router-utils/block-cross-site-dev.js`
  (16.4.3), [allowedDevOrigins](https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins),
  [tester-army/e2e#751](https://github.com/tester-army/e2e/issues/751)
- Blaxel: [templates](https://docs.blaxel.ai/Sandboxes/Templates),
  [hub source](https://github.com/blaxel-ai/sandbox/tree/main/hub),
  [overview](https://docs.blaxel.ai/Sandboxes/Overview.md),
  [update sandbox](https://docs.blaxel.ai/api-reference/compute/update-sandbox.md),
  [latest image / createIfNotExists](https://docs.blaxel.ai/knowledge-base/configuration-and-operation/ensure-sandboxes-use-the-latest-deployed-image.md),
  [WebSocket 15-minute limit](https://docs.blaxel.ai/knowledge-base/troubleshooting/websocket-connection-timeouts-and-15-minute-limit.md),
  [standby billing](https://docs.blaxel.ai/knowledge-base/configuration-and-operation/understanding-sandbox-active-vs-standby-states-and-billing.md),
  [volumes](https://docs.blaxel.ai/Sandboxes/Volumes.md),
  [quotas](https://docs.blaxel.ai/Security/Quotas.md),
  [pricing](https://blaxel.ai/pricing)
- Other sandboxes: [E2B desktop](https://github.com/e2b-dev/desktop),
  [Daytona computer use](https://www.daytona.io/docs/en/computer-use.md),
  [Runloop browser](https://docs.runloop.ai/docs/devboxes/capabilities/browser),
  [Cua](https://github.com/trycua/cua), [Cua Cloud ended](https://cua.ai/docs/fleets.md)
- Hosted browsers: [Kernel private networking](https://www.kernel.sh/docs/browsers/private-networking.md),
  [Browserbase live view](https://docs.browserbase.com/platform/browser/observability/session-live-view),
  [Steel on WebRTC](https://steel.dev/blog/webrtc),
  [Chrome proxy bypass](https://chromium.googlesource.com/chromium/src/+/HEAD/net/docs/proxy.md)
- Building blocks: [neko WebRTC](https://neko.m1k1o.net/docs/v3/configuration/webrtc),
  [neko room control](https://neko.m1k1o.net/docs/v3/api/room-control),
  [KasmVNC](https://github.com/kasmtech/KasmVNC), [noVNC](https://github.com/novnc/noVNC),
  [kernel-images](https://github.com/onkernel/kernel-images),
  [agent-browser](https://github.com/vercel-labs/agent-browser),
  [playwright-cli](https://github.com/microsoft/playwright-cli),
  [Playwright connectOverCDP](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)
- Element comments: [CDP Overlay domain](https://chromedevtools.github.io/devtools-protocol/tot/Overlay/),
  [React Grab](https://github.com/aidenybai/react-grab),
  [Cursor 2.0 browser](https://cursor.com/changelog/2-0)
- Run setup: [Cursor environment.json schema](https://www.cursor.com/schemas/environment.schema.json),
  [Codex cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environments),
  [Claude Code cloud environments](https://code.claude.com/docs/en/cloud-environments),
  [Copilot setup steps](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/customize-the-agent-environment),
  [Dev Containers reference](https://containers.dev/implementors/json_reference/),
  [Codespaces minimum spec](https://docs.github.com/en/codespaces/setting-up-your-project-for-codespaces/configuring-dev-containers/setting-a-minimum-specification-for-codespace-machines),
  [Ona config](https://ona.com/docs/ona/reference/ona-config-schema.md),
  [Conductor settings](https://www.conductor.build/docs/reference/settings/reference),
  [Devin blueprints](https://docs.devin.ai/onboard-devin/environment/blueprint-reference),
  [process-compose health](https://f1bonacc1.github.io/process-compose/health/)

## Deviations log

(none yet)
