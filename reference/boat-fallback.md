# Boat fallback sandboxes

Status: built 2026-11-05; template `lor-workbench` saved. Checked live on Boat
VMs: commands, files, env, spawn, named processes, fencing, keep-alive,
private ports and WebSockets, and on a sandbox from the template the browser
stack (Selkies, gateway on a public port, `lor-browser`), the terminal, a
dev-server preview and usage metering. Through the real session code
(LOR_SANDBOX_PRIMARY=boat): open, reopen, attach, the harness bridge URL, the
terminal and the browser view; with a dev session: charging, the blocked
check, stop, resume (files kept, processes ended) and the idle sweep.
Production, 2026-11-06 (Jacob, LOR_SANDBOX_PRIMARY=boat): a new session on
Boat ran a Lor turn and a Claude Code turn, and the Browser and Terminal tabs
worked. The desktop app needed `*.on.boat.dev` in its CSP (frame-src,
connect-src).

## Why

Blaxel Tier 2 caps the RAM all running sandboxes may use at once, and two
people with a few code sessions reach it. Tier 3 needs $200 a month of spend.
Boat (boat.dev) is cheaper ($0.036/h for 4 vCPU / 8 GB) and allows 100 VMs at
once on its $20 plan, so it takes the overflow (Jacob, 2026-11-05).

## Decisions (Jacob, 2026-11-05)

- Blaxel stays primary. A new session sandbox goes to Boat only when Blaxel
  answers `QUOTA_EXCEEDED`; an existing sandbox never moves. Boat full too
  (its own 402/429) is the same capacity error people already see.
- Claude Code and Codex turns on Boat get the real credential in place of the
  proxy placeholder (Boat has no credential proxy): sandbox code can read it
  while the turn runs.
- Boat time is metered into the same credit pool before anyone uses it:
  GB-hours from `boat.usage`, 1.25 credits per GB-hour, like Blaxel.
- Boat has no standby: a stopped VM keeps its disk but its processes end. A
  Boat sandbox stays running until 30 minutes after Lor last used it.

## As built

- `packages/lor/src/sandbox/boat.ts`: the Boat backend.
  - Found by name (`ses-<id>`, `call-<id>`) with Boat's `namePrefix` list, so
    no table records the provider. Created from the saved snapshot
    `LOR_BOAT_TEMPLATE` with label `lor=session`; small/default/large for 4/8/16
    GB.
  - Create's `Idempotency-Key` is the name plus a hash of the request
    (2026-11-11). Boat binds a key to its request body for 24 hours and a
    delete frees it only for that same body, so the name alone made a
    sandbox replaced at a new size answer `409 idempotency_key_reused`. Two
    creates at once (a restore and a turn) end on one VM: the second gets
    `409 idempotency_in_progress` and retries. A deleted sandbox is gone from
    `get` and the name list at once. Checked live through `createBoatSandbox`,
    `boatExec` and `deleteBoatSandbox`: racing creates, then 4 GB, 8 GB and
    4 GB again under one name. Not checked: the size change from the app.
  - A Boat sandbox replaced by one on Blaxel (Blaxel is tried first) clears
    the worker's memory of the session being on Boat when the Blaxel sandbox
    opens, so harness turns get the proxy's credential rule again.
  - Keep-alive: every command and open sets `ttlSeconds` to 30 minutes (at most
    once a minute), which moves Boat's stop deadline to now + 30 minutes. A
    stopped sandbox is resumed on the next open; one still stopping answers
    409 `sandbox_stopping`, so resume retries for up to 3 minutes (a stop
    took about 40 s).
  - A command sent while the VM starts (a create or resume) is held by Boat
    for up to 60 s, then answers `409 boat_starting`. `startCommand` retries
    that one answer through `whileSandboxStarts` (2026-11-11, not run live)
    and gives up with `SandboxStartingError`, like Blaxel's
    `WORKLOAD_UNAVAILABLE` (`artifacts.md`, Booting and waking). A failed
    command or create throws `BoatRequestError` with Boat's status and error
    code (seen live: `404 not_found`); the SDK's own error names neither.
  - Commands run as root through `sudo -n -H` (Boat runs as `user` with
    passwordless sudo), detached, with output read by offset. Env values the
    caller passes go through a `/tmp` file the script reads and deletes, so a
    credential never sits in Boat's command history. A `: lor-cmd <label>`
    first line lets fencing find a run's leftovers (`pgrep -f`).
  - Files: Boat's file API reaches only `/home/user` and `/tmp`, so reads are
    a root `base64` command and writes go to `/tmp/lor-io` then `cat >` the
    target (keeps an existing file's mode).
  - Named processes (previews, terminal, browser): a process group per name
    with a pid file in `/tmp/lor-procs`.
  - Ports: `https://<box>-<port>.on.boat.dev`. Private ones take `?_token=`,
    which answers with a redirect and sets a `_port_auth` cookie.
    The worker's harness bridge sends `Cookie: _port_auth=<token>` directly
    instead of the query token, avoiding the authentication redirect in its
    WebSocket client (which does not follow redirects). Boat's direct-token
    harness turns skip the Blaxel placeholder credential probe.
  - Usage per sandbox-hour for billing, `stopBoatSandbox` for blocked
    workspaces, `deleteIdleBoatSandboxes` for VMs stopped longer than
    `LOR_SESSION_SANDBOX_TTL` (Blaxel deletes its own).
- `session-sandbox.ts`: `SessionSandbox.provider`; open, attach, create,
  delete, parked bridges and the harness bridge URL fall through to Boat.
- `sandbox-ports.ts`: every seam function has a Boat branch.
- Worker `jobs/sandbox-usage.ts`: charges and blocks over both providers;
  the hourly job also deletes idle Boat sandboxes.
- Template: `packages/lor/sandbox-image/boat/setup.sh` (the Dockerfile's tools
  on Ubuntu 24.04; Google Chrome under the name `chromium`, Selkies' Ubuntu
  package) and `build-template.ts`, which runs it on a fresh VM and saves the
  snapshot. Rebuild after any image change:
  `pnpm --filter @repo/lor exec tsx sandbox-image/boat/build-template.ts`.
- Env: `BOAT_API_KEY` (unset: Blaxel only), `LOR_BOAT_TEMPLATE`
  (`lor-workbench`), `LOR_SANDBOX_PRIMARY` (`boat` sends new sandboxes to
  Boat first: QA, or a Blaxel outage).

## Limits

- Boat plan: $20 is 100 VMs at once and 200 starts a day; the free trial is
  2 VMs, a 2-hour TTL cap and no `large` (16 GB) type.
- Each command or file operation is a Boat API round trip, about 0.5 s.
- A new sandbox is ready in about 5 s, but Boat copies the template disk in
  for a while after (`hydrated: false`): commands work, slower (a first command
  touching Node, Python and Chrome took 42 s).
- Boat's own Node 24 (`/usr/local/bin/node`) and its `pi` come first on root's
  PATH, ahead of the Node 26 setup.sh installs; bridges and repos run on 24.
  Lor's Pi runs in the worker, so Boat's `pi` is never used.
- The free trial allows no saved snapshots: the template needs the paid plan.
- Boat runs only in Europe ("Germany, Finland and France", docs.boat.dev
  compliance); no region choice in its API. Sites see a European visitor
  (Google answers in French by IP), and the live view and terminal are
  80–150 ms further from US users than Blaxel's us-pdx-1. Keep Boat as
  overflow (LOR_SANDBOX_PRIMARY unset) unless Boat offers a US region.
- A live view or terminal left open with no commands still lets the VM stop
  30 minutes after Lor's last command.
