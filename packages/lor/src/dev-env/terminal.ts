import { shellQuote } from "@ai-sdk/harness/utils"
import { ensureProcess, exposePort, portReady } from "../sandbox/sandbox-ports"
import { attachSessionSandbox } from "../sandbox/session-sandbox"
import { sessionWorkDir } from "./work-dir"

// The code session's Terminal tab (reference/dev-environment-runbook.md §4):
// ttyd serves a PTY over a WebSocket on a private port; each connection runs
// the launcher, which attaches one of the person's own tmux sessions (one per
// terminal tab, LOR-150), so each shell and what runs in it outlive
// disconnects. Built on the provider seam.

export const TERMINAL_PORT = 7681
export const MAX_TERMINAL_TABS = 8
// Versioned: a sandbox whose ttyd predates terminal tabs runs the old
// launcher, so the new name starts over (its command stops the old ttyd).
const PROCESS = "terminal-2"
const PREVIEW = "terminal"
const READY_WAIT_MS = 90_000
const TOKEN_TTL_MS = 15 * 60_000
const TTYD_VERSION = "1.7.7"

// Newer images ship ttyd, tmux and zsh; older sandboxes get them on first
// open.
// ttyd's URL args: the person's key, the tab number and the person's name
// (shown to Lor by `lor-terminal list`). Tab 1 keeps the name older sandboxes
// used, so a shell from before tabs stays the person's first tab.
const LAUNCHER = `#!/bin/sh
cd "$LOR_TERMINAL_DIR" 2>/dev/null || cd /workspace
name="main-$(printf %s "$1" | tr -cd 'a-zA-Z0-9-' | cut -c1-40)"
tab="$(printf %s "$2" | tr -cd '0-9' | cut -c1-2)"
[ "\${tab:-1}" -gt 1 ] && name="\${name}_$tab"
tmux has-session -t "=$name" 2>/dev/null || tmux new-session -d -s "$name"
tmux set-option -t "=$name:" @lor_person "$(printf %s "$3" | tr -d ';')"
exec tmux attach-session -t "=$name"
`

// Lor's read-only view of people's terminals (LOR-150): every harness runs it
// from its own shell, so "why did that fail?" needs no pasted output.
const READER = `#!/bin/sh
usage() {
  cat <<'EOF'
lor-terminal list               the terminals people have open in this session
lor-terminal read [NAME] [-n N] the last N lines (default 200, up to 5000) of one,
                                scrollback included. NAME comes from list;
                                without it, the terminal a person used last.
Read only: these are people's own shells.
EOF
}
sessions() {
  tmux list-sessions -F '#{session_activity}|#{session_name}|#{pane_current_command}|#{pane_current_path}|#{@lor_person}' 2>/dev/null |
    grep '^[0-9]*|main-' | sort -rn
}
describe() {
  awk -F'|' -v now="$(date +%s)" '{
    tab = 1; if (match($2, /_[0-9]+$/)) tab = substr($2, RSTART + 1)
    who = $5; for (i = 6; i <= NF; i++) who = who "|" $i
    if (who == "") who = "someone"
    age = now - $1
    if (age < 60) used = "just now"
    else if (age < 3600) used = int(age / 60) " min ago"
    else if (age < 86400) used = int(age / 3600) " h ago"
    else used = int(age / 86400) " d ago"
    printf "%s  %s, terminal %s: running %s in %s, last used %s\\n", $2, who, tab, $3, $4, used
  }'
}
case "\${1:-}" in
  list)
    all="$(sessions)"
    [ -n "$all" ] || { echo "No terminals are open."; exit 0; }
    printf '%s\\n' "$all" | describe
    ;;
  read)
    shift
    name=""
    lines=200
    while [ $# -gt 0 ]; do
      case "$1" in
        -n) lines="\${2:-}"; shift; [ $# -gt 0 ] && shift ;;
        *) name="$1"; shift ;;
      esac
    done
    case "$lines" in '' | *[!0-9]*) lines=200 ;; esac
    [ "$lines" -gt 5000 ] && lines=5000
    all="$(sessions)"
    [ -n "$all" ] || { echo "No terminals are open."; exit 0; }
    if [ -z "$name" ]; then
      row="$(printf '%s\\n' "$all" | head -n 1)"
    else
      row="$(printf '%s\\n' "$all" | awk -F'|' -v name="$name" '$2 == name' | head -n 1)"
    fi
    if [ -z "$row" ]; then
      echo "lor-terminal: no terminal named $name. Open terminals:" >&2
      printf '%s\\n' "$all" | describe >&2
      exit 1
    fi
    name="$(printf '%s\\n' "$row" | cut -d'|' -f2)"
    printf '# %s\\n' "$(printf '%s\\n' "$row" | describe)"
    tmux capture-pane -p -J -t "=$name:" -S "-$lines" |
      awk '{ line[NR] = $0 } /[^[:space:]]/ { last = NR } END { for (i = 1; i <= last; i++) print line[i] }' |
      tail -n "$lines"
    ;;
  *)
    usage
    ;;
esac
`

function terminalCommand(): string {
  return [
    "set -e",
    `command -v ttyd >/dev/null || { curl -fsSL -o /usr/local/bin/ttyd https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.$(uname -m) && chmod +x /usr/local/bin/ttyd; }`,
    "command -v tmux >/dev/null || { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq tmux zsh >/dev/null; }",
    `printf %s ${shellQuote(LAUNCHER)} > /usr/local/bin/lor-terminal-attach`,
    `printf %s ${shellQuote(READER)} > /usr/local/bin/lor-terminal`,
    "chmod +x /usr/local/bin/lor-terminal-attach /usr/local/bin/lor-terminal",
    // A ttyd from before terminal tabs still holds the port.
    "if pkill -x ttyd 2>/dev/null; then sleep 1; fi",
    // -W: writable; -a: the URL's ?arg= values reach the launcher.
    `exec ttyd -W -a -p ${TERMINAL_PORT} -t disableLeaveAlert=true /usr/local/bin/lor-terminal-attach`,
  ].join("\n")
}

// Mirrors the launcher's name for a person's tab.
function tmuxSession(personKey: string, tab: number): string {
  const person = personKey.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40)
  return tab > 1 ? `main-${person}_${tab}` : `main-${person}`
}

export type TerminalEndpoint =
  | { status: "ready"; url: string; expiresAt: string }
  | { status: "no_sandbox" }
  | { status: "not_ready" }

// A WebSocket URL for one of a person's shells, with a short-lived token.
export async function openTerminal(
  sessionId: string,
  person: { key: string; name: string },
  tab = 1
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
    name: PREVIEW,
    port: TERMINAL_PORT,
    access: "private",
    tokenTtlMs: TOKEN_TTL_MS,
  })
  if (!exposed?.token) return { status: "no_sandbox" }
  const params = new URLSearchParams({
    [exposed.token.param]: exposed.token.value,
  })
  const name = person.name
    .replace(/[\s;|]+/g, " ")
    .trim()
    .slice(0, 60)
  for (const arg of [person.key, String(tab), name]) params.append("arg", arg)
  return {
    status: "ready",
    url: `${exposed.url.replace(/^http/, "ws")}/ws?${params.toString()}`,
    expiresAt: exposed.token.expiresAt.toISOString(),
  }
}

// `command`: what runs in the tab right now (`zsh`, `node`), for its label.
export type TerminalTabInfo = { tab: number; command: string }

// The person's terminal tabs whose shells still run. Null: no sandbox.
export async function listTerminals(
  sessionId: string,
  personKey: string
): Promise<TerminalTabInfo[] | null> {
  const sandbox = await attachSessionSandbox({ sessionId })
  if (!sandbox) return null
  try {
    const result = await sandbox.session.run({
      command:
        "tmux list-sessions -F '#{session_name}|#{pane_current_command}' 2>/dev/null || true",
    })
    const first = tmuxSession(personKey, 1)
    const tabs: TerminalTabInfo[] = []
    for (const line of result.stdout.split("\n")) {
      const [name = "", command = ""] = line.trim().split("|")
      const tab =
        name === first
          ? 1
          : name.startsWith(`${first}_`)
            ? Number(name.slice(first.length + 1))
            : Number.NaN
      if (Number.isInteger(tab) && tab >= 1 && tab <= MAX_TERMINAL_TABS) {
        tabs.push({ tab, command })
      }
    }
    return tabs.sort((a, b) => a.tab - b.tab)
  } finally {
    sandbox.close()
  }
}

// Closing a tab ends its shell and what runs in it. Null: no sandbox.
export async function closeTerminal(
  sessionId: string,
  personKey: string,
  tab: number
): Promise<true | null> {
  const sandbox = await attachSessionSandbox({ sessionId })
  if (!sandbox) return null
  try {
    await sandbox.session.run({
      command: `tmux kill-session -t ${shellQuote(`=${tmuxSession(personKey, tab)}`)} 2>/dev/null || true`,
    })
    return true
  } finally {
    sandbox.close()
  }
}
