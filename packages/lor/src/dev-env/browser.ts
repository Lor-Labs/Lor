import { randomBytes } from "node:crypto"
import { shellQuote } from "@ai-sdk/harness/utils"
import { WORKSPACE_MOUNT } from "../sandbox/blaxel"
import { ensureProcess, exposePort, portReady } from "../sandbox/sandbox-ports"
import { attachSessionSandbox } from "../sandbox/session-sandbox"

// The code session's browser (reference/planned/sandbox-browser-runbook.md):
// headful Chromium in the sandbox, started by `lor-browser-start` in the
// image. These match its defaults. CDP and both VNC servers stay on
// 127.0.0.1; only the gateway's view port is meant for a preview. Who has
// control lives in files in the browser's folder (provider-neutral): the
// gateway routes viewers by it and `lor-browser` refuses Lor while it is set.
export const BROWSER_CDP_PORT = 9222
export const BROWSER_VNC_PORT = 5900
export const BROWSER_WATCH_VNC_PORT = 5901
export const BROWSER_VIEW_PORT = 6080

export const BROWSER_PORTS = [
  BROWSER_CDP_PORT,
  BROWSER_VNC_PORT,
  BROWSER_WATCH_VNC_PORT,
  BROWSER_VIEW_PORT,
]

const BROWSER_DIR = `${WORKSPACE_MOUNT}/.cache/lor-browser`
const AGENT_BROWSER = "/opt/agent-browser/bin/agent-browser"
const PROCESS = "browser"
const READY_WAIT_MS = 30_000
const PREVIEW_TOKEN_TTL_MS = 15 * 60_000
// Exit code: the sandbox's image predates the browser, or has the first
// browser build whose websockify view had no tokens or view-only.
const MISSING = 3
const GATEWAY = "/opt/lor-browser/gateway.mjs"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const owner = (sessionId: string) => ({ sessionId })
const q = shellQuote

export type BrowserController = { userId: string; name: string }

export type BrowserView =
  | {
      status: "ready"
      url: string
      expiresAt: string
      role: "control" | "watch"
      controller: BrowserController | null
    }
  | { status: "no_sandbox" | "unavailable" | "not_ready" }

// Prints the controller's id, then their name; empty when Lor may drive.
const readControl = [
  `printf '%s\\n' "$(cat "$d/controller-id" 2>/dev/null)"`,
  `cat "$d/controller" 2>/dev/null || true`,
]

function parseControl(stdout: string): BrowserController | null {
  const [userId = "", ...name] = stdout.split("\n")
  if (!UUID.test(userId.trim())) return null
  return { userId: userId.trim(), name: name.join(" ").trim() || "Someone" }
}

async function runInBrowserDir(
  sessionId: string,
  lines: string[]
): Promise<{ exitCode: number; stdout: string } | null> {
  const sandbox = await attachSessionSandbox(owner(sessionId))
  if (!sandbox) return null
  try {
    const result = await sandbox.session.run({
      command: [
        `[ -f ${GATEWAY} ] || exit ${MISSING}`,
        `d=${q(BROWSER_DIR)}`,
        `mkdir -p "$d/viewers"`,
        ...lines,
      ].join("\n"),
    })
    return { exitCode: result.exitCode, stdout: result.stdout }
  } finally {
    sandbox.close()
  }
}

async function startBrowser(
  sessionId: string,
  port: number
): Promise<boolean | null> {
  const started = await ensureProcess(owner(sessionId), {
    name: PROCESS,
    command: "exec lor-browser-start",
    env: { HOME: "/root", LOR_BROWSER_DIR: BROWSER_DIR },
  })
  if (!started) return null
  return portReady(owner(sessionId), port, READY_WAIT_MS)
}

// A WebSocket URL to the live view for one person: a one-time gateway token
// (written with the sandbox's clock, which the gateway checks it against)
// and the private preview's token.
export async function openBrowserView(
  sessionId: string,
  userId: string
): Promise<BrowserView> {
  if (!UUID.test(userId)) return { status: "not_ready" }
  const token = randomBytes(16).toString("hex")
  const prepared = await runInBrowserDir(sessionId, [
    `find "$d/viewers" -type f -mmin +5 -delete 2>/dev/null`,
    `printf '{"userId":"%s","at":%s}' ${q(userId)} "$(date +%s%3N)" > "$d/viewers/${token}"`,
    ...readControl,
  ])
  if (!prepared) return { status: "no_sandbox" }
  if (prepared.exitCode === MISSING) return { status: "unavailable" }
  if (prepared.exitCode !== 0) return { status: "not_ready" }
  const ready = await startBrowser(sessionId, BROWSER_VIEW_PORT)
  if (ready === null) return { status: "no_sandbox" }
  if (!ready) return { status: "not_ready" }
  const exposed = await exposePort(owner(sessionId), {
    name: PROCESS,
    port: BROWSER_VIEW_PORT,
    access: "private",
    tokenTtlMs: PREVIEW_TOKEN_TTL_MS,
  })
  if (!exposed?.token) return { status: "no_sandbox" }
  const controller = parseControl(prepared.stdout)
  const params = new URLSearchParams({
    token,
    [exposed.token.param]: exposed.token.value,
  })
  return {
    status: "ready",
    url: `${exposed.url.replace(/^http/, "ws")}/vnc?${params.toString()}`,
    expiresAt: exposed.token.expiresAt.toISOString(),
    role: controller?.userId === userId ? "control" : "watch",
    controller,
  }
}

export type BrowserControlResult =
  | { status: "ok"; controller: BrowserController | null }
  | { status: "no_sandbox" | "unavailable" }
  | { status: "not_controller"; controller: BrowserController | null }

// Taking control always wins (the last person to take it has it); handing
// back works only for the person who has it.
export async function setBrowserControl(
  sessionId: string,
  person: BrowserController,
  take: boolean
): Promise<BrowserControlResult> {
  if (!UUID.test(person.userId)) return { status: "no_sandbox" }
  const name = person.name.replace(/\s+/g, " ").trim().slice(0, 80)
  const result = await runInBrowserDir(
    sessionId,
    take
      ? [
          `printf '%s' ${q(name || "Someone")} > "$d/controller"`,
          `printf '%s' ${q(person.userId)} > "$d/controller-id"`,
          ...readControl,
        ]
      : [
          `[ "$(cat "$d/controller-id" 2>/dev/null)" = ${q(person.userId)} ] && rm -f "$d/controller-id" "$d/controller"`,
          ...readControl,
        ]
  )
  if (!result) return { status: "no_sandbox" }
  if (result.exitCode === MISSING) return { status: "unavailable" }
  const controller = parseControl(result.stdout)
  if (!take && controller) return { status: "not_controller", controller }
  return { status: "ok", controller }
}

export type BrowserOpenResult =
  | { status: "ok" }
  | { status: "no_sandbox" | "unavailable" | "not_ready" }
  | { status: "busy"; controller: BrowserController }

// Shows a sandbox page (a service's Open, a port from the list). Refused
// while someone else has control, so a click in one panel never moves the
// page under the person driving.
export async function openBrowserPage(
  sessionId: string,
  userId: string,
  target: { port: number; path: string }
): Promise<BrowserOpenResult> {
  const control = await runInBrowserDir(sessionId, readControl)
  if (!control) return { status: "no_sandbox" }
  if (control.exitCode === MISSING) return { status: "unavailable" }
  const controller = parseControl(control.stdout)
  if (controller && controller.userId !== userId) {
    return { status: "busy", controller }
  }
  const ready = await startBrowser(sessionId, BROWSER_CDP_PORT)
  if (ready === null) return { status: "no_sandbox" }
  if (!ready) return { status: "not_ready" }
  const url = `http://localhost:${target.port}${target.path}`
  const opened = await runInBrowserDir(sessionId, [
    `${AGENT_BROWSER} --cdp ${BROWSER_CDP_PORT} open ${q(url)} >/dev/null`,
  ])
  if (!opened) return { status: "no_sandbox" }
  return opened.exitCode === 0 ? { status: "ok" } : { status: "not_ready" }
}
