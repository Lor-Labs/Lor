# Boat fallback sandboxes

Status: built 2026-11-05; template `lor-workbench` saved. Checked live on Boat
VMs: commands, files, env, spawn, named processes, fencing, keep-alive,
private ports and WebSockets, and on a sandbox from the template the browser
stack (Selkies, gateway on a public port, `lor-browser`), the terminal, a
dev-server preview and usage metering. Through the real session code
(LOR_SANDBOX_PRIMARY=boat): open, reopen, attach, the harness bridge URL, the
terminal and the browser view; with a dev session: charging, the blocked
check, stop, resume (files kept, processes ended) and the idle sweep. A
session forced onto Boat in the app (Lor turn, Claude Code turn with a real
token, live view in the panel) is still owed.

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
  - Keep-alive: every command and open sets `ttlSeconds` to 30 minutes (at most
    once a minute), which moves Boat's stop deadline to now + 30 minutes. A
    stopped sandbox is resumed on the next open; one still stopping answers
    409 `sandbox_stopping`, so resume retries for up to 3 minutes (a stop
    took about 40 s).
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
    which also works on a WebSocket upgrade (terminal, harness bridge); over
    HTTP it answers 302 and sets a `_port_auth` cookie.
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
- A live view or terminal left open with no commands still lets the VM stop
  30 minutes after Lor's last command.
