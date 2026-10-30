# Code session dev environment runbook (environments, preview, terminal)

Started 2026-10-29 with Jacob. Code sessions gain three things for launch:
**Environments** (a repo's env vars, stored by Lor), a **Preview** tab (the
app's dev server in an iframe) and a **Terminal** tab (a shell in the
session's sandbox). They launch on Blaxel. Code sandboxes move to a cheaper
provider after launch, and maybe to Lor's own infrastructure later, so every
part is built against a provider seam, not against Blaxel.

Why not move providers first: boat.dev (researched 2026-10-29) has no
terminal API, the same iframe cookie problem for previews, no per-command
env, file access only under `/home/user` and `/tmp`, a 600 s command limit,
no process survival across stop, no idle standby, no network rules (so no
per-turn Claude credential injection) and EU-only hosting. Pricing already
assumes the cheaper provider: sandbox time is 10 credits per code-sandbox
hour, about 23¢ under Blaxel's cost, as a beta-only subsidy
(`beta-pricing-runbook.md`, Cost basis).

## 1. Architecture: one seam, features above it

```
packages/lor/src/sandbox/
  provider.ts        SandboxProvider: the only provider-specific surface
  blaxel/…           today's adapter (session-sandbox.ts, blaxel.ts moved behind it)
  <next>/…           boat / Modal / Daytona / Lor's own VMs later
packages/lor/src/dev-env/
  environments.ts    store, render and write env files      (provider-neutral)
  previews.ts        dev server lifecycle + exposePort       (provider-neutral)
  terminal.ts        terminal server lifecycle + exposePort  (provider-neutral)
```

The seam the three features need, beyond today's `SandboxSession`:

```ts
// Expose a port of the session's sandbox. "public": a URL that works with no
// credential (for iframes). "private": a URL plus a short-lived credential
// the caller passes (header or query) — for the terminal and the harness
// bridge.
exposePort(owner, { port, access: "public" | "private", ttlMs })
  : Promise<{ url: string; credential?: { header?: [string, string]; query?: [string, string] }; expiresAt: Date }>
revokePort(owner, port): Promise<void>

// Long-lived named processes that turn fencing never stops (prefixes
// `preview-`, `terminal-`). Idempotent: start only when not running.
ensureProcess(owner, { name, command, cwd, env }): Promise<"running" | "started">
listProcesses(owner) / stopProcess(owner, name)

// Is something listening on the port inside the sandbox?
portReady(owner, port, timeoutMs): Promise<boolean>
```

How each provider fills it:

| Seam | Blaxel (now) | boat | Modal / Daytona | Lor's own VMs |
|---|---|---|---|---|
| exposePort public | preview `public: true`, random `prefixUrl`, `ttl` | `host --public` (custom subdomain) | tunnels / preview links | Lor gateway route |
| exposePort private | preview + `tokens.create`, `X-Blaxel-Preview-Token` or `?bl_preview_token=` | `?_token=` / `_port_auth` cookie | tunnel + token | Lor gateway + Lor session |
| ensureProcess | `process.exec({ name, keepAlive:false })` | detached command; names kept by us (pid map) or a systemd unit | exec | in-VM agent |
| survives idle | yes: standby snapshots processes | no: stop kills them, so ensure re-starts on resume | depends | our choice |
| env delivery | file write (any provider) | file write (only under `/home/user`) | file write | file write |

Rule: **features never call a provider SDK**, and **never assume processes
survive idle**. Every open of the Preview or Terminal tab calls
`ensureProcess` + `portReady` first. On Blaxel that is a cheap no-op; on
boat or Lor's VMs it re-starts what a stop killed.

### The edge (where browser traffic enters)

Two ways to hand a browser a preview or terminal:

| | Provider URL (launch) | Lor gateway (later) |
|---|---|---|
| What | the browser loads the provider's URL directly | `<session>.preview.lor.chat` proxies to the provider URL and adds the provider credential server-side |
| Auth | public random URL (preview) or a short-lived token in the URL (terminal) | the person's Lor session, first-party, so iframes work and access is checked per request |
| Portability | URL format changes when the provider changes | URLs never change; swapping provider is invisible |
| Own infra | – | becomes the real router (Caddy/Envoy) in front of Lor's VMs |
| Cost | none | wildcard DNS + TLS, WebSocket proxying, bandwidth through Lor |
| Build | hours | about a day plus ops |

Launch on provider URLs behind `exposePort`. The gateway is the first step
of the own-infrastructure path and the fix for "anyone with the preview URL
can see it".

## 2. Environments

A repo's env vars, stored encrypted by Lor and written into the code
session's work folder.

Options considered:

| Option | Pros | Cons | Portability |
|---|---|---|---|
| **A. Env file in the work folder** (`.env` / `.env.local`) | works for every framework, DB URLs, signing keys, browser vars; one file write | Lor (and Claude Code/Codex) can read every value; values can reach transcripts and model providers | any provider and own infra: it is a file write |
| B. Env only in the dev server's / terminal's process | not on disk | root reads `/proc/<pid>/environ` anyway; frameworks expect files; boat has no per-command env | provider-specific |
| C. Egress proxy fills secrets (placeholders) | the agent never sees HTTP API keys | headers to known hosts only: no DB URLs, signing keys, browser vars; each secret needs its host; provider-specific (Blaxel routing, boat `$NAME_BASE_URL`) unless Lor runs the proxy | portable only as Lor's own proxy |
| D. Provider env/secret features (boat Environments, Blaxel variables) | built-in | lock-in; per-sandbox, not per repo | none |

**Decision: A for launch, data model ready for C.** Each variable is stored
with a `delivery` of `file` (launch) or `proxy` (later, with `hosts[]`), so
adding Lor's own egress proxy later changes no stored data. The UI says
plainly that Lor can read file values: use development credentials.

- Scope: one environment per workspace + repo (all code sessions on the
  repo, every branch). Named environments (Development / Staging) later.
- Storage: `repo_environment` (workspace, repo, file name, encrypted body,
  updated by/at), AES-GCM with `INTEGRATION_ENCRYPTION_KEY` like custom tool
  secrets. Values are write-only after save, except to people who can
  manage it (reveal on request).
- Delivery: each turn's `prepareCodeWorkFolder` writes the file (default
  `.env.local`, configurable) and adds it to `.git/info/exclude`, so it is
  never committed even when the repo does not ignore it. Checkpoints already
  skip ignored files. A saved change writes into an awake sandbox at once
  (`attachSessionSandbox`), else at the next turn.
- Network: the egress allowlist opens fully (Jacob, 2026-10-28), so dev
  servers can call their APIs. Per-turn credential routing for Claude Code
  and Codex stays.

## 3. Preview tab

- **Dev server.** Per repo, a dev command and port (`pnpm dev`, 3000),
  detected from `package.json` on first use and editable. The Preview tab's
  Start runs it as the named process `preview-<port>` with `HOST=0.0.0.0`,
  `PORT`, and the env file. Lor is told the command and that the Preview
  tab exists; it can start it the same way. Turn fencing kills only `run-`,
  `spawn-` and `bridge-`, so the dev server outlives turns.
- **URL.** `exposePort({ access: "public" })` with an unguessable prefix and
  a TTL; revoked on archive, on Stop, and by the beta credit sweep (it
  already deletes previews).
- **Tab.** An iframe with the URL bar text, Reload, Open in browser, Stop.
  The desktop app's CSP needs `frame-src` for the preview domain.
- **Framework host checks.** Vite refuses unknown hosts by default
  (`server.allowedHosts`); Next.js limits cross-origin dev requests
  (`allowedDevOrigins`). The spike checks what the env can fix without
  editing the repo.

## 4. Terminal tab

Options:

| Option | Pros | Cons |
|---|---|---|
| **A. `ttyd` in the sandbox, exposed port, xterm.js** | provider-neutral (needs only exposePort); real PTY (colors, vim, Ctrl-C, resize); one static binary | image change (`bl push`; boat: snapshot); one more process |
| B. exec + stdin pipe + log polling | no image change | no PTY: no echo, no interactive tools; polling cost |
| C. SSH bridge in Lor's API | standard | Lor holds long connections; provider-specific access (boat `/sshkey`) |
| D. Lor's own in-VM agent with a PTY endpoint | the own-infra end state | months away |

**Decision: A.** `ttyd -W tmux new -A -s main` as named process `terminal`:
tmux keeps the shell (and its history and running commands) across
reconnects. The browser gets `exposePort({ access: "private" })`, a
short-lived credential minted by the API for people who can write in the
channel, and connects xterm.js with ttyd's protocol. A terminal is a root
shell in the session's sandbox, with the same reach as Lor.

## 5. Idle: what "disconnect when idle" means

A Blaxel sandbox is billed while anything holds a connection to it: Lor's
turn, an open terminal WebSocket, an open preview iframe (page requests and
the dev server's hot-reload WebSocket). About 15 seconds after the last
connection closes it goes to standby, which is free. Standby snapshots
memory, so **running processes are frozen, not killed**, and continue on
resume (Blaxel docs: "Any running processes are included in this snapshot
and will be instantly restored").

"Disconnect when idle" is client behavior only: when the session tab is
hidden or nobody touched the Preview or Terminal tab for N minutes (default
5), the client unmounts the iframe and closes the terminal socket. Blaxel
itself recommends this (Standby control: hide iframes on tab inactivity,
auto-disconnect on tab switch).

| | While connected | After disconnect (standby) | On return |
|---|---|---|---|
| Dev server | runs, billed | frozen with the sandbox, not billed | continues where it was |
| Preview URL | serves | stays valid until its TTL | iframe reloads; the sandbox resumes |
| Terminal | live | shell keeps running in tmux, frozen | reconnects to the same tmux session |
| Someone else with the preview URL | – | a request wakes it (spike: 249 ms) | – |

Blaxel does not document it; the spike (step 0) showed a preview request
served from standby in 249 ms with the dev server's process unchanged.

On boat or Lor's VMs, idle means stop: processes die, so the tab's
`ensureProcess` re-starts the dev server and terminal on return (slower
first load). The client behavior is the same.

## 6. Steps

- [x] **0. Spike** (2026-10-29, `packages/lor/src/sandbox/dev-env-spike.ts`,
  throwaway sandbox, deleted). Vite on `0.0.0.0` with
  `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=.bl.run`:
  - Public preview with our random `prefixUrl`:
    `https://lor-<prefix>-lor.preview.bl.run` (Blaxel appends the
    workspace). Page 200, asset 200, HMR WebSocket connected. Blaxel sends
    no `X-Frame-Options` and no CSP.
  - Private preview: `?bl_preview_token=` answers 200 and sets cookie
    `bl_preview_token` (`HttpOnly; SameSite=None; Secure`, 24 h); without
    token or cookie, 401. In an iframe that is a third-party cookie.
  - ttyd 1.7.7 (static binary) through a private preview over `wss` with
    the query token: input and output work.
  - Standby about 40 s after the last connection. A preview request then
    answered 200 in 249 ms; the dev server kept the same pid. The control
    plane still read `STANDBY` right after (lag).
  - The image has no `tmux` or `zsh` (Node 22): step 4 rebuilds it.
  - Not checked: Vite without the allowed-hosts variable, Next.js, the
    desktop app's iframe.
- [x] **1. Seam.** Built 2026-10-29 in
  `packages/lor/src/sandbox/sandbox-ports.ts`: `exposePort` (stable name,
  random `prefixUrl`, `LOR_PREVIEW_DOMAIN` as Blaxel `customDomain` when
  set; private ports return a `bl_preview_token`), `revokePort`,
  `ensureProcess` (named, not keepAlive), `stopProcess`, `listProcesses`,
  `portReady`. None creates a sandbox. Turn fencing already stops only
  `run-`/`spawn-`/`bridge-`.
- [ ] **2. Environments.** Schema (additive `db:push`), API (read keys,
  reveal, write), settings UI in the code session, write per turn +
  `.git/info/exclude`, open the egress allowlist.
  - [x] Schema, API (`apps/api/src/routes/v1/environments/`), session link
    and per-turn write (`packages/lor/src/dev-env/environments.ts`), built
    2026-10-29.
  - [x] New session UI (2026-10-29): `EnvironmentPicker` at the far right of
    the repo row (`environment-picker.tsx`), `EnvironmentDialog` to create
    and edit (`environment-dialog.tsx`: name, env files as key/value rows,
    Paste .env, Reveal values), pick remembered per repo
    (`use-environments.ts`). A row left empty with a saved value keeps it.
  - [ ] The open session shows its environment (chip + edit); a saved edit
    writes into an awake sandbox now instead of at the next turn.
  - [ ] Open the egress allowlist (Blaxel's "all methods, all hosts" rule
    syntax to check).
- [x] **3. Preview tab.** Built 2026-10-29, not run live yet.
  - `packages/lor/src/dev-env/previews.ts`: `suggestDevServer` (package.json
    `dev`, else `start`; runner from the lockfile; port from `-p`/`--port`,
    Vite 5173, else 3000; Vite gets `--host 0.0.0.0`), `startPreview`
    (process `preview-<port>`, installs dependencies first when
    `node_modules` is missing, env `HOST`/`PORT`/`BROWSER=none`/
    `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS`, waits for the port up to 45 s,
    or 180 s on a fresh start), `listPreviews`, `stopPreview`. Private on
    `LOR_PREVIEW_DOMAIN`, else public.
  - `portReady` checks in rounds of 20 s: Blaxel's `waitForCompletion`
    stops at 60 s.
  - API: `GET/POST /sessions/{id}/preview`, `DELETE
    /sessions/{id}/preview/{port}` (code sessions; start/stop need channel
    write access). No sandbox: 409 "send Lor a message"; port silent: 400.
  - Web: `preview` tab kind, `PreviewTab` (command/port form prefilled from
    the repo; iframe with Reload, Copy URL, Open in browser, Stop; unmounts
    after 2 minutes hidden), Preview button in the session strip. Desktop
    CSP: `frame-src https://*.bl.run https://*.lor.chat`, `connect-src
    wss://*.bl.run`.
  - Not built: Lor told about the Preview tab in its prompt; a preview the
    agent starts by itself does not show (it is not a `preview-` process).
- [x] **4. Terminal tab.** Built 2026-10-29, not run live yet.
  - Image (`sandbox-image/Dockerfile`, `terminal/tmux.conf`,
    `terminal/zshrc`): ttyd 1.7.7 static binary, tmux (no status bar, mouse
    on, 50k history), zsh with autosuggestions, syntax highlighting and
    starship; history on `/workspace`. Needs `bl push`. Until then
    `openTerminal` installs ttyd and tmux on first open.
  - `packages/lor/src/dev-env/terminal.ts`: process `terminal` runs
    `ttyd -W -a -p 7681 lor-terminal`; the launcher attaches tmux session
    `main-<user id>` in the repo folder, so each person has their own shell
    and it outlives disconnects. Private port, 15-minute token.
  - API: `POST /sessions/{id}/terminal` (code sessions, channel write
    access) returns the `wss` URL.
  - Web: `terminal` tab kind, `TerminalTab` (xterm.js 6, WebGL with DOM
    fallback, fit, ttyd protocol, links: `localhost:<port>` opens the
    Preview tab, others open in the browser; disconnects after 2 minutes
    hidden, Reconnect gets a new token). Preview and Terminal buttons in
    the session strip.
  - Spike 2026-10-29: a preview reaches `0.0.0.0` servers only (`127.0.0.1`
    and `::1` answered 502). The image has no `ss`/`netstat`/`socat`;
    `/proc/net/tcp*` lists listening ports. Next: the Browser tab (open
    ports from `/proc/net/tcp*`, a Node TCP relay for localhost-bound
    servers, address bar at `localhost:<port>`, "Ask Lor to start the
    app") replaces the Preview form.
- [ ] **5. Live QA.** A Next app with a `.env.local`: preview, edit through
  Lor with hot reload, terminal, idle and return, archive revokes.

## Decisions (Jacob, 2026-10-29)

- Environments are named and multi-repo in the schema:
  `environment` → `environment_repo` → `environment_file` →
  `environment_variable` (one repo may have several files, e.g. monorepo
  apps). The API and UI allow one repo per environment, and a session uses
  one repo, until sessions can hold several repos (a bigger change: Changes
  panel, commit/push and checkpoints per repo).
- A code session stores its environment (`agent_session.environment_id`),
  picked at start and checked to include the session's repo. Each turn
  writes that environment's files for the repo. Picker (UI): a settings icon
  at the far right of the repo row opens a menu of environments that
  include the repo, plus "Create environment"; a picked one shows as a chip
  next to the repo.
- Previews go private on a custom domain (`<prefix>.preview.lor.chat`,
  Blaxel `customDomain`) so the preview cookie is same-site with the web
  app. To check: tokens on custom domains (undocumented), and the desktop
  app, whose `tauri://localhost` origin keeps the cookie third-party. Until
  the domain is registered, previews use Blaxel's domain behind
  `exposePort`.
- A new permission `environment: ["manage"]` (`workspace-statements.ts`),
  owner and admin by default: edit and reveal values. It cannot hide values
  from people in a code session: Lor and the terminal read the env file, so
  anyone who can talk to Lor or open the terminal can see them. The UI says
  so.
- Terminal: `tmux` keeps the shell across reconnects (ttyd starts a new
  shell per connection, so without it every idle disconnect kills the shell
  and what runs in it). One tmux session per person
  (`main-<userId>`), status bar hidden, mouse on. External terminal apps
  (Warp, iTerm) need SSH: boat and Lor's own VMs can offer it, Blaxel
  cannot; later, behind the Lor gateway.

## Deviations log

(none yet)
