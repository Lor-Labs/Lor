import { shellQuote } from "@ai-sdk/harness/utils"
import { ensureProcess, exposePort, portReady } from "../sandbox/sandbox-ports"
import { sessionWorkDir } from "./previews"

// The code session's Terminal tab (reference/dev-environment-runbook.md §4):
// ttyd serves a PTY over a WebSocket on a private port; each connection runs
// the launcher, which attaches the person's own tmux session, so the shell
// and what runs in it outlive disconnects. Built on the provider seam.

export const TERMINAL_PORT = 7681
const PROCESS = "terminal"
const READY_WAIT_MS = 90_000
const TOKEN_TTL_MS = 15 * 60_000
const TTYD_VERSION = "1.7.7"

// Newer images ship ttyd, tmux and zsh; older sandboxes get them on first
// open.
const LAUNCHER = `#!/bin/sh
cd "$LOR_TERMINAL_DIR" 2>/dev/null || cd /workspace
name="main-$(printf %s "$1" | tr -cd 'a-zA-Z0-9-' | cut -c1-40)"
exec tmux new-session -A -s "$name"
`

function terminalCommand(): string {
  return [
    "set -e",
    `command -v ttyd >/dev/null || { curl -fsSL -o /usr/local/bin/ttyd https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.$(uname -m) && chmod +x /usr/local/bin/ttyd; }`,
    "command -v tmux >/dev/null || { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq tmux zsh >/dev/null; }",
    `printf %s ${shellQuote(LAUNCHER)} > /usr/local/bin/lor-terminal`,
    "chmod +x /usr/local/bin/lor-terminal",
    // -W: writable; -a: the URL's ?arg= reaches the launcher (the person).
    `exec ttyd -W -a -p ${TERMINAL_PORT} -t disableLeaveAlert=true /usr/local/bin/lor-terminal`,
  ].join("\n")
}

export type TerminalEndpoint =
  | { status: "ready"; url: string; expiresAt: string }
  | { status: "no_sandbox" }
  | { status: "not_ready" }

// A WebSocket URL for one person's shell, with a short-lived token.
export async function openTerminal(
  sessionId: string,
  personKey: string
): Promise<TerminalEndpoint> {
  const owner = { sessionId }
  const started = await ensureProcess(owner, {
    name: PROCESS,
    command: terminalCommand(),
    env: {
      HOME: "/root",
      TERM: "xterm-256color",
      LOR_TERMINAL_DIR: sessionWorkDir(sessionId),
    },
  })
  if (!started) return { status: "no_sandbox" }
  if (!(await portReady(owner, TERMINAL_PORT, READY_WAIT_MS))) {
    return { status: "not_ready" }
  }
  const exposed = await exposePort(owner, {
    name: PROCESS,
    port: TERMINAL_PORT,
    access: "private",
    tokenTtlMs: TOKEN_TTL_MS,
  })
  if (!exposed?.token) return { status: "no_sandbox" }
  const params = new URLSearchParams({
    [exposed.token.param]: exposed.token.value,
    arg: personKey,
  })
  return {
    status: "ready",
    url: `${exposed.url.replace(/^http/, "ws")}/ws?${params.toString()}`,
    expiresAt: exposed.token.expiresAt.toISOString(),
  }
}
