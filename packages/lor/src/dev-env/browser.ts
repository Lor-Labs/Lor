import { randomBytes } from "node:crypto"
import { shellQuote } from "@ai-sdk/harness/utils"
import { WORKSPACE_MOUNT } from "../sandbox/blaxel"
import {
  ensureProcess,
  exposePort,
  portReady,
  runNamed,
} from "../sandbox/sandbox-ports"
import { attachSessionSandbox } from "../sandbox/session-sandbox"

// The code session's browser (reference/planned/sandbox-browser-runbook.md):
// headful Chromium in the sandbox, started by `lor-browser-start` in the
// image. These match its defaults. CDP stays on 127.0.0.1 and Selkies on a
// Unix socket; only the gateway's view port is meant for a preview. Who has
// control lives in files in the browser's folder (provider-neutral): the
// gateway routes viewers by it and `lor-browser` refuses Lor while it is set.
export const BROWSER_CDP_PORT = 9222
export const BROWSER_VIEW_PORT = 6080

export const BROWSER_PORTS = [BROWSER_CDP_PORT, BROWSER_VIEW_PORT]

const BROWSER_DIR = `${WORKSPACE_MOUNT}/.cache/lor-browser`
const AGENT_BROWSER = "/opt/agent-browser/bin/agent-browser"
const PROCESS = "browser"
// The gateway's preview. Public: the view is an iframe on another site, where
// Safari drops the private preview's cookie. Each viewer's grant in the URL
// path is the credential.
const VIEW_PREVIEW = "browser-view"
const READY_WAIT_MS = 30_000
// Exit code: the sandbox's image predates the Selkies live view (older
// images streamed over VNC).
const MISSING = 3
const SELKIES = "/usr/bin/selkies"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const owner = (sessionId: string) => ({ sessionId })
const q = shellQuote

export type BrowserController = { userId: string; name: string }

export type BrowserView =
  | {
      status: "ready"
      // Selkies' page under this person's grant, for an iframe or the phone.
      url: string
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
        `[ -x ${SELKIES} ] || exit ${MISSING}`,
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

// The live view's page for one person: a new grant (written with the
// sandbox's clock, which the gateway checks it against) on the gateway's
// public preview. The gateway lets a grant lapse 10 minutes after its last
// connection and 12 hours after it was made.
export async function openBrowserView(
  sessionId: string,
  userId: string
): Promise<BrowserView> {
  if (!UUID.test(userId)) return { status: "not_ready" }
  const grant = randomBytes(16).toString("hex")
  const prepared = await runInBrowserDir(sessionId, [
    `find "$d/viewers" -type f -mmin +720 -delete 2>/dev/null`,
    `printf '{"userId":"%s","at":%s}' ${q(userId)} "$(date +%s%3N)" > "$d/viewers/${grant}"`,
    ...readControl,
  ])
  if (!prepared) return { status: "no_sandbox" }
  if (prepared.exitCode === MISSING) return { status: "unavailable" }
  if (prepared.exitCode !== 0) return { status: "not_ready" }
  const ready = await startBrowser(sessionId, BROWSER_VIEW_PORT)
  if (ready === null) return { status: "no_sandbox" }
  if (!ready) return { status: "not_ready" }
  const exposed = await exposePort(owner(sessionId), {
    name: VIEW_PREVIEW,
    port: BROWSER_VIEW_PORT,
    access: "public",
  })
  if (!exposed) return { status: "no_sandbox" }
  const controller = parseControl(prepared.stdout)
  return {
    status: "ready",
    url: `${exposed.url}/v/${grant}/`,
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

// Element comments (reference/planned/sandbox-browser-runbook.md §5): turns
// on Chromium's own element picker over CDP (its highlight shows in the live
// view), waits for the click, reads the element in an isolated world (the
// page's scripts never see it), crops a screenshot, then puts a numbered
// marker on the page. `clear` removes the markers; `cancel` ends picking.
const PICK_SCRIPT = `
const mode = process.argv[1]
const index = Number(process.argv[2] || 0)
const WAIT_MS = 50000
const print = (value) => console.log(JSON.stringify(value))

function describe() {
  const el = this
  const implicitRoles = { A: "link", BUTTON: "button", TEXTAREA: "textbox", SELECT: "combobox", IMG: "img", NAV: "navigation", FORM: "form", H1: "heading", H2: "heading", H3: "heading", H4: "heading" }
  const role = el.getAttribute("role") || (el.tagName === "INPUT" ? (el.type === "checkbox" ? "checkbox" : el.type === "submit" ? "button" : "textbox") : implicitRoles[el.tagName]) || null
  const text = (el.innerText || el.textContent || "").trim().replace(/\\s+/g, " ")
  const name = el.getAttribute("aria-label") || el.getAttribute("alt") || el.getAttribute("title") || el.getAttribute("placeholder") || text.slice(0, 80) || null
  const step = (node) => {
    const testId = node.getAttribute("data-testid")
    if (testId) return '[data-testid="' + testId + '"]'
    if (node.id && document.querySelectorAll("#" + CSS.escape(node.id)).length === 1) return "#" + CSS.escape(node.id)
    const tag = node.tagName.toLowerCase()
    const parent = node.parentElement
    if (!parent) return tag
    const same = Array.from(parent.children).filter((child) => child.tagName === node.tagName)
    return same.length === 1 ? tag : tag + ":nth-of-type(" + (same.indexOf(node) + 1) + ")"
  }
  const parts = []
  for (let node = el; node && node !== document.body && parts.length < 6; node = node.parentElement) {
    const part = step(node)
    parts.unshift(part)
    if (part.startsWith("#") || part.startsWith("[")) break
  }
  const r = el.getBoundingClientRect()
  return {
    selector: parts.join(" > "),
    tag: el.tagName.toLowerCase(),
    role,
    name,
    text: text.slice(0, 200),
    html: el.outerHTML.slice(0, 300),
    url: location.href,
    rect: { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height },
  }
}

function mark(n) {
  const r = this.getBoundingClientRect()
  const host = document.createElement("div")
  host.setAttribute("data-lor-comment", String(n))
  host.style.cssText = "position:absolute;pointer-events:none;z-index:2147483647;left:" + (r.left + scrollX) + "px;top:" + (r.top + scrollY) + "px;width:" + r.width + "px;height:" + r.height + "px"
  const root = host.attachShadow({ mode: "closed" })
  root.innerHTML = '<div style="position:absolute;inset:0;outline:2px solid #7c5cff;outline-offset:1px;border-radius:3px"></div><div style="position:absolute;top:-11px;left:-11px;min-width:22px;height:22px;padding:0 6px;box-sizing:border-box;border-radius:11px;background:#7c5cff;color:#fff;font:600 12px/22px system-ui,sans-serif;text-align:center">' + n + "</div>"
  document.documentElement.appendChild(host)
}

async function main() {
  const targets = await (await fetch("http://127.0.0.1:9222/json/list")).json()
  const page = targets.find((t) => t.type === "page" && /^(https?:|about:blank)/.test(t.url))
  if (!page) return print({ status: "no_page" })
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error("couldn't reach the page"))
  })
  let next = 0
  const calls = new Map()
  let onEvent = () => {}
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    const call = msg.id && calls.get(msg.id)
    if (call) {
      calls.delete(msg.id)
      if (msg.error) call.reject(new Error(msg.error.message))
      else call.resolve(msg.result)
    } else if (msg.method) onEvent(msg)
  }
  const send = (method, params) =>
    new Promise((resolve, reject) => {
      next += 1
      calls.set(next, { resolve, reject })
      ws.send(JSON.stringify({ id: next, method, params: params || {} }))
    })
  await send("DOM.enable")
  await send("Overlay.enable")
  const stopPicking = () => send("Overlay.setInspectMode", { mode: "none", highlightConfig: {} })
  if (mode === "cancel" || mode === "clear") {
    await stopPicking()
    if (mode === "clear") {
      await send("Runtime.evaluate", { expression: "document.querySelectorAll('[data-lor-comment]').forEach((n) => n.remove())" })
    }
    return print({ status: "ok" })
  }
  const picked = new Promise((resolve) => {
    onEvent = (msg) => {
      if (msg.method === "Overlay.inspectNodeRequested") resolve(msg.params.backendNodeId)
    }
    setTimeout(() => resolve(null), WAIT_MS)
  })
  const violet = { r: 124, g: 92, b: 255 }
  await send("Overlay.setInspectMode", {
    mode: "searchForNode",
    highlightConfig: { showInfo: true, contentColor: { ...violet, a: 0.2 }, borderColor: { ...violet, a: 0.9 } },
  })
  const backendNodeId = await picked
  await stopPicking()
  if (!backendNodeId) return print({ status: "timeout" })
  const { frameTree } = await send("Page.getFrameTree")
  const world = await send("Page.createIsolatedWorld", { frameId: frameTree.frame.id, worldName: "lor-comments" })
  const { object } = await send("DOM.resolveNode", { backendNodeId, executionContextId: world.executionContextId })
  const call = (fn, args) =>
    send("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: fn.toString(), arguments: args || [], returnByValue: true })
  const element = (await call(describe)).result.value
  const pad = 12
  const rect = element.rect
  const clip = {
    x: Math.max(0, rect.x - pad),
    y: Math.max(0, rect.y - pad),
    width: Math.min(1600, rect.width + pad * 2),
    height: Math.min(1000, rect.height + pad * 2),
    scale: 1,
  }
  const shot = clip.width >= 4 && clip.height >= 4
    ? await send("Page.captureScreenshot", { format: "jpeg", quality: 75, clip }).catch(() => null)
    : null
  await call(mark, [{ value: index }])
  print({ status: "picked", element, image: shot ? shot.data : null })
}

main().then(
  () => process.exit(0),
  (err) => {
    print({ status: "error", error: String((err && err.message) || err) })
    process.exit(0)
  }
)
`

export type PickedElement = {
  selector: string
  tag: string
  role: string | null
  name: string | null
  text: string
  html: string
  url: string
}

export type BrowserPickResult =
  | { status: "picked"; element: PickedElement; image: string | null }
  | { status: "timeout" | "no_page" | "ok" }
  | { status: "no_sandbox" | "unavailable" | "error" }
  | { status: "busy"; controller: BrowserController | null }

const PICK_PROCESS = "browser-pick"

// Picking moves the shared browser into Chromium's inspect mode, so only the
// person in control may do it.
export async function pickBrowserElement(
  sessionId: string,
  userId: string,
  action: { mode: "pick"; index: number } | { mode: "cancel" | "clear" }
): Promise<BrowserPickResult> {
  const control = await runInBrowserDir(sessionId, readControl)
  if (!control) return { status: "no_sandbox" }
  if (control.exitCode === MISSING) return { status: "unavailable" }
  const controller = parseControl(control.stdout)
  if (action.mode === "pick" && controller?.userId !== userId) {
    return { status: "busy", controller }
  }
  const args =
    action.mode === "pick" ? `pick ${Math.max(1, action.index)}` : action.mode
  const result = await runNamed(owner(sessionId), {
    name: PICK_PROCESS,
    command: `node -e ${q(PICK_SCRIPT)} ${args}`,
    timeoutSec: 58,
  })
  if (!result) return { status: "no_sandbox" }
  try {
    const parsed = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "")
    if (parsed.status === "picked") {
      const { rect: _rect, ...element } = parsed.element
      return { status: "picked", element, image: parsed.image ?? null }
    }
    if (["timeout", "no_page", "ok"].includes(parsed.status)) {
      return { status: parsed.status }
    }
    return { status: "error" }
  } catch {
    return { status: "error" }
  }
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
