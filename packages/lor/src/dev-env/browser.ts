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
// The image's gateway version (sandbox-image/browser/version). From 3 it
// enforces what each viewer may do, which preview links rely on; from 4 it
// also enforces a grant's link expiry (`until`) and `control: false`.
const GATEWAY_VERSION_FILE = "/opt/lor-browser/version"
const PREVIEW_GATEWAY_VERSION = 4
const ANNOTATIONS_FILE = "annotations.json"
// Exit code: the browser's folder has no annotations file yet.
const NO_ANNOTATIONS = 4
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const owner = (sessionId: string) => ({ sessionId })
const q = shellQuote

export type BrowserController = { userId: string; name: string }

// `outdated`: the sandbox's gateway can't hold a preview link's viewers to
// their role (its image predates preview links).
export type BrowserView =
  | {
      status: "ready"
      // Selkies' page under this person's grant, for an iframe or the phone.
      url: string
      role: "control" | "watch"
      controller: BrowserController | null
    }
  | { status: "no_sandbox" | "unavailable" | "not_ready" | "outdated" }

// Who a grant is for, and what the gateway lets them do beyond watching
// (reference/planned/sandbox-browser-runbook.md §8). `annotate`: show their
// pointer and leave notes. `send`: read everyone's notes with screenshots and
// clear them, for Send to Lor in the app. `anonymous`: a public preview link's
// signed-out visitor, who only watches.
export type BrowserViewer =
  | { userId: string; name: string; annotate: boolean; send: boolean }
  | { anonymous: true }

// An annotation as the gateway keeps it in the browser's folder.
export type BrowserAnnotation = {
  id: string
  number: number
  color: string
  by: { userId: string; name: string }
  note: string
  element: {
    selector: string
    tag: string
    role: string | null
    name: string | null
    text: string
    html: string
    url: string
    quote: string | null
  }
}

// Prints the controller's id, then their name; empty when Lor may drive.
const readControl = [
  `printf '%s\\n' "$(cat "$d/controller-id" 2>/dev/null)"`,
  `cat "$d/controller" 2>/dev/null || true`,
]

// Hands control back only when this person has it.
const releaseControl = (userId: string) =>
  `if [ "$(cat "$d/controller-id" 2>/dev/null)" = ${q(userId)} ]; then rm -f "$d/controller-id" "$d/controller"; fi`

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

// The live view's page for one viewer: a new grant (written with the
// sandbox's clock, which the gateway checks it against) on the gateway's
// public preview. The gateway lets a grant lapse 10 minutes after its last
// connection and 12 hours after it was made.
// `preview`: a preview link's view. Refuses a sandbox whose gateway ignores
// what a grant allows, and marks the grant so turning the link off ends it.
// `stored`: the annotations to put back when the browser's folder has none
// (a new sandbox); the gateway loads them. A failed read refuses the view
// (the page asks again): opening without them would let the gateway's next
// list erase the stored ones.
// `control: false`: this viewer may not drive; control they still hold (they
// lost write access) goes back. `expiresAt`: the preview link's expiry, past
// which the gateway refuses the grant.
export async function openBrowserView(
  sessionId: string,
  viewer: BrowserViewer,
  options: {
    preview?: boolean
    stored?: () => Promise<BrowserAnnotation[]>
    control?: boolean
    expiresAt?: Date
  } = {}
): Promise<BrowserView> {
  const anonymous = "anonymous" in viewer
  if (!anonymous && !UUID.test(viewer.userId)) return { status: "not_ready" }
  const grant = randomBytes(16).toString("hex")
  // The name labels this person's pointer and annotations for the others.
  const record = anonymous
    ? { userId: `anon-${randomBytes(8).toString("hex")}`, anonymous: true }
    : {
        userId: viewer.userId,
        name: viewer.name.replace(/\s+/g, " ").trim().slice(0, 80) || "Someone",
        can: [
          ...(viewer.annotate ? ["annotate"] : []),
          ...(viewer.send ? ["send"] : []),
        ],
        ...(options.control === false ? { control: false } : {}),
      }
  const json = JSON.stringify(
    options.preview ? { ...record, via: "preview" } : record
  ).slice(0, -1)
  // Written on the sandbox's clock, like `at`.
  const untilMs = options.expiresAt
    ? Math.max(0, options.expiresAt.getTime() - Date.now())
    : null
  const until = untilMs === null ? "" : `,"until":%s`
  const untilArg =
    untilMs === null ? "" : ` "$(( $(date +%s%3N) + ${untilMs} ))"`
  const prepared = await runInBrowserDir(sessionId, [
    `find "$d/viewers" -type f -mmin +720 -delete 2>/dev/null`,
    `printf '%s,"at":%s${until}}' ${q(json)} "$(date +%s%3N)"${untilArg} > "$d/viewers/${grant}"`,
    ...(!anonymous && options.control === false
      ? [releaseControl(viewer.userId)]
      : []),
    `[ "$(cat ${GATEWAY_VERSION_FILE} 2>/dev/null || echo 0)" -ge ${PREVIEW_GATEWAY_VERSION} ] && echo 1 || echo 0`,
    `[ -e "$d/${ANNOTATIONS_FILE}" ] && echo 1 || echo 0`,
    ...readControl,
  ])
  if (!prepared) return { status: "no_sandbox" }
  if (prepared.exitCode === MISSING) return { status: "unavailable" }
  if (prepared.exitCode !== 0) return { status: "not_ready" }
  const [roles = "0", hasAnnotations = "0", ...control] =
    prepared.stdout.split("\n")
  if (options.preview && roles.trim() !== "1") return { status: "outdated" }
  if (hasAnnotations.trim() !== "1" && options.stored) {
    const stored = await options.stored().catch(() => null)
    if (!stored) return { status: "not_ready" }
    await restoreBrowserAnnotations(sessionId, stored)
  }
  const ready = await startBrowser(sessionId, BROWSER_VIEW_PORT)
  if (ready === null) return { status: "no_sandbox" }
  if (!ready) return { status: "not_ready" }
  const exposed = await exposePort(owner(sessionId), {
    name: VIEW_PREVIEW,
    port: BROWSER_VIEW_PORT,
    access: "public",
  })
  if (!exposed) return { status: "no_sandbox" }
  const controller = parseControl(control.join("\n"))
  return {
    status: "ready",
    url: `${exposed.url}/v/${grant}/`,
    role:
      !anonymous && controller?.userId === viewer.userId ? "control" : "watch",
    controller,
  }
}

// Turning a preview link off, or making it private: the grants its visitors
// got go, and the gateway closes their connections within a minute (its
// grant check). Their pages ask again and get what the link allows now.
export async function endPreviewViews(sessionId: string): Promise<void> {
  await runInBrowserDir(sessionId, [
    `grep -l '"via":"preview"' "$d/viewers/"* 2>/dev/null | xargs -r rm -f`,
  ])
}

// Someone who lost access (removed from the workspace, or no longer able to
// write in the channel): their grants go and control they hold goes back.
// Their pages ask again and get what they may do now.
export async function endUserBrowserViews(
  sessionId: string,
  userId: string
): Promise<void> {
  if (!UUID.test(userId)) return
  await runInBrowserDir(sessionId, [
    `grep -lF ${q(`"userId":"${userId}"`)} "$d/viewers/"* 2>/dev/null | xargs -r rm -f`,
    releaseControl(userId),
  ])
}

async function restoreBrowserAnnotations(
  sessionId: string,
  items: BrowserAnnotation[]
): Promise<void> {
  if (items.length === 0) return
  const sandbox = await attachSessionSandbox(owner(sessionId))
  if (!sandbox) return
  try {
    await sandbox.session.writeTextFile({
      path: `${BROWSER_DIR}/${ANNOTATIONS_FILE}`,
      content: JSON.stringify({ items }),
    })
  } finally {
    sandbox.close()
  }
}

// The gateway's annotations, for the copy that outlives the sandbox. Null
// when there is nothing to copy: no sandbox, or no file yet (the gateway has
// had none to write), which says nothing about the stored ones.
export async function readBrowserAnnotations(
  sessionId: string
): Promise<BrowserAnnotation[] | null> {
  const read = await runInBrowserDir(sessionId, [
    `[ -e "$d/${ANNOTATIONS_FILE}" ] || exit ${NO_ANNOTATIONS}`,
    `cat "$d/${ANNOTATIONS_FILE}"`,
  ])
  // No sandbox (stopped or deleted: the stored copy stands), an image without
  // the browser, or no file yet.
  if (!read || read.exitCode === MISSING || read.exitCode === NO_ANNOTATIONS) {
    return null
  }
  // A failed read or a broken (even empty) file throws, so the caller can try
  // again.
  if (read.exitCode !== 0) {
    throw new Error(`Couldn't read ${ANNOTATIONS_FILE} (exit ${read.exitCode})`)
  }
  const parsed = JSON.parse(read.stdout) as { items?: unknown }
  if (!Array.isArray(parsed.items)) {
    throw new Error(`${ANNOTATIONS_FILE} has no list of annotations`)
  }
  return parsed.items.filter(isBrowserAnnotation)
}

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.slice(0, max) : ""

function isBrowserAnnotation(value: unknown): value is BrowserAnnotation {
  const item = value as Partial<BrowserAnnotation> | null
  return Boolean(
    item &&
      typeof item.id === "string" &&
      UUID.test(item.id) &&
      typeof item.number === "number" &&
      typeof item.note === "string" &&
      typeof item.by?.userId === "string" &&
      typeof item.element?.selector === "string" &&
      typeof item.element.url === "string"
  )
}

// The stored shape, with every field bounded: the file comes from a sandbox
// that runs the repo's own code.
export function cleanBrowserAnnotation(
  item: BrowserAnnotation
): BrowserAnnotation {
  const { element } = item
  return {
    id: item.id,
    number: Math.max(1, Math.min(Math.round(item.number), 9999)),
    color: /^#[0-9a-f]{6}$/i.test(item.color) ? item.color : "#7c5cff",
    by: { userId: item.by.userId, name: text(item.by.name, 80) || "Someone" },
    note: text(item.note, 2000),
    element: {
      selector: text(element.selector, 500),
      tag: text(element.tag, 40),
      role: text(element.role, 40) || null,
      name: text(element.name, 200) || null,
      text: text(element.text, 200),
      html: text(element.html, 300),
      url: text(element.url, 2000),
      quote: text(element.quote, 500) || null,
    },
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
      : [releaseControl(person.userId), ...readControl]
  )
  if (!result) return { status: "no_sandbox" }
  if (result.exitCode === MISSING) return { status: "unavailable" }
  const controller = parseControl(result.stdout)
  if (!take && controller) return { status: "not_controller", controller }
  return { status: "ok", controller }
}

// Page annotations (reference/planned/sandbox-browser-runbook.md §5): turns on
// Chromium's own element picker over CDP (its highlight shows in the live
// view), waits for the click, reads the element and crops a screenshot, then
// draws a numbered pin, an outline and a note box on the page itself, so
// everyone watching and Lor's screenshots see them. The overlay is a closed
// shadow root made from an isolated world (the page's scripts never see
// inside) and follows its element. Each annotation's state lives in
// attributes on its host, so later runs read and change it: `data-state`
// (open | saved | removed), `data-note` (the text being typed), `data-saved`
// and `data-lor-by` (the author's user id).
const ANNOTATE_SCRIPT = `
const args = process.argv.slice(1)
const mode = args[0]
const WAIT_MS = 50000
const print = (value) => console.log(JSON.stringify(value))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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

// One annotation on the picked element: pin at its top-left corner, outline,
// the note box beside it while open, a one-line bubble once saved.
function annotate(id, number, by, author, selector) {
  let target = this
  const host = document.createElement("div")
  host.setAttribute("data-lor-annotation", id)
  host.setAttribute("data-lor-by", by)
  host.setAttribute("data-state", "open")
  host.setAttribute("data-note", "")
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647"
  const root = host.attachShadow({ mode: "closed" })
  const css = [
    ":host{all:initial}",
    "*{box-sizing:border-box;margin:0;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased}",
    ":host([data-hidden]) .layer,:host([data-state='removed']) .layer{display:none}",
    ".ring,.pin,.bubble,.card{position:fixed;left:0;top:0}",
    ".ring{border:1.5px solid rgba(124,92,255,.55);border-radius:4px}",
    ":host([data-state='open']) .ring{border:2px solid #7c5cff;background:rgba(124,92,255,.08)}",
    ".pin{width:24px;height:24px;border:2px solid #fff;border-radius:12px 12px 12px 3px;background:#7c5cff;color:#fff;box-shadow:0 1px 4px rgba(0,0,0,.3);font-size:11px;font-weight:600;line-height:20px;text-align:center}",
    ".bubble{max-width:240px;padding:4px 8px;border:1px solid rgba(28,25,23,.1);border-radius:8px;background:#fff;color:#1c1917;box-shadow:0 2px 8px rgba(0,0,0,.14);font-size:12px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".bubble b{margin-right:4px;font-weight:600}",
    ":host([data-armed]) .pin,:host([data-armed]) .bubble{pointer-events:auto;cursor:pointer}",
    ".card{display:none;width:300px;padding:10px 12px;border:1px solid rgba(28,25,23,.1);border-radius:12px;background:#fff;color:#1c1917;box-shadow:0 12px 32px -4px rgba(0,0,0,.2),0 2px 6px rgba(0,0,0,.08);pointer-events:auto}",
    ":host([data-state='open']) .card{display:block}",
    ".head{display:flex;align-items:center;gap:7px;font-size:12px;line-height:16px}",
    ".avatar{flex:none;width:20px;height:20px;border-radius:10px;background:#7c5cff;color:#fff;font-size:10px;font-weight:600;line-height:20px;text-align:center}",
    ".who{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".num{color:#a8a29e}",
    "textarea{display:block;width:100%;max-height:152px;margin-top:8px;padding:0;border:0;outline:0;resize:none;overflow-y:auto;background:transparent;color:#1c1917;font-size:13px;line-height:19px}",
    "textarea::placeholder{color:#a8a29e}",
    ".foot{display:flex;align-items:center;gap:4px;margin-top:10px}",
    ".hint{flex:1;font-size:11px;color:#a8a29e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    "button{all:unset;cursor:pointer;padding:4px 9px;border-radius:6px;font-size:12px;font-weight:500;line-height:16px}",
    ".remove{color:#78716c}.remove:hover{background:#f5f5f4;color:#1c1917}",
    ".save{background:#7c5cff;color:#fff}.save:hover{background:#6a4bf0}",
  ].join("")
  root.innerHTML =
    "<style>" + css + "</style><div class='layer'><div class='ring'></div><div class='pin'></div><div class='bubble'><b></b><span></span></div>" +
    "<div class='card'><div class='head'><span class='avatar'></span><span class='who'></span><span class='num'></span></div>" +
    "<textarea rows='1' placeholder='Add a note for Lor…'></textarea>" +
    "<div class='foot'><span class='hint'>Enter to save · Esc to cancel</span><button type='button' class='remove'></button><button type='button' class='save'>Save</button></div></div></div>"
  const $ = (query) => root.querySelector(query)
  const ring = $(".ring")
  const pin = $(".pin")
  const bubble = $(".bubble")
  const card = $(".card")
  const note = $("textarea")
  const name = String(author || "").trim() || "Someone"
  pin.textContent = String(number)
  $(".avatar").textContent = name.charAt(0).toUpperCase()
  $(".who").textContent = name
  $(".num").textContent = "#" + number
  $(".bubble b").textContent = name.split(" ")[0]

  const grow = () => {
    note.style.height = "auto"
    note.style.height = Math.min(note.scrollHeight, 152) + "px"
  }
  const save = () => {
    const text = note.value.trim()
    host.setAttribute("data-note", text)
    host.setAttribute("data-saved", text)
    host.setAttribute("data-state", "saved")
  }
  // Esc: an edited note goes back to its saved text; a new one goes.
  const cancel = () => {
    if (!host.hasAttribute("data-saved")) return host.setAttribute("data-state", "removed")
    host.setAttribute("data-note", host.getAttribute("data-saved"))
    host.setAttribute("data-state", "saved")
  }
  note.addEventListener("input", () => {
    host.setAttribute("data-note", note.value)
    grow()
  })
  note.addEventListener("keydown", (event) => {
    if (event.isComposing) return
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      save()
    } else if (event.key === "Escape") {
      event.preventDefault()
      cancel()
    }
  })
  $(".save").addEventListener("click", save)
  $(".remove").addEventListener("click", () => host.setAttribute("data-state", "removed"))
  // Typing and clicks in the note stay away from the page's own shortcuts and
  // outside-click handlers.
  for (const type of ["keydown", "keyup", "keypress", "beforeinput", "input", "paste", "copy", "cut", "pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "contextmenu", "focusin", "focusout"]) {
    root.addEventListener(type, (event) => event.stopPropagation())
  }

  const clamp = (value, min, max) => Math.max(min, Math.min(value, max))
  const move = (node, x, y) => {
    node.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)"
  }
  let rect = null
  // Every frame, so the pin follows scrolling and layout changes; a
  // re-rendered element is found again by its selector.
  const place = () => {
    if (!host.isConnected) return
    requestAnimationFrame(place)
    if (!target.isConnected) {
      try {
        target = document.querySelector(selector) || target
      } catch {}
    }
    if (target.isConnected) rect = target.getBoundingClientRect()
    if (!rect) return
    const r = rect
    const vw = document.documentElement.clientWidth
    const vh = document.documentElement.clientHeight
    const state = host.getAttribute("data-state")
    const shown = target.isConnected && (r.width > 0 || r.height > 0) && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw
    ring.style.display = shown ? "" : "none"
    pin.style.display = shown ? "" : "none"
    bubble.style.display = shown && state === "saved" && host.getAttribute("data-saved") ? "" : "none"
    ring.style.width = r.width + 4 + "px"
    ring.style.height = r.height + 4 + "px"
    move(ring, r.left - 2, r.top - 2)
    const px = clamp(r.left - 2, 4, vw - 28)
    const py = clamp(r.top - 26, 4, vh - 28)
    move(pin, px, py)
    const bw = bubble.offsetWidth
    move(bubble, px + 28 + bw > vw - 4 ? px - 4 - bw : px + 28, py - 1)
    if (state !== "open") return
    const w = card.offsetWidth
    const h = card.offsetHeight
    const gap = 10
    const m = 8
    let x = r.left
    let y = r.top + gap
    if (r.right + gap + w <= vw - m) {
      x = r.right + gap
      y = r.top
    } else if (r.left - gap - w >= m) {
      x = r.left - gap - w
      y = r.top
    } else if (r.bottom + gap + h <= vh - m) {
      y = r.bottom + gap
    } else if (r.top - gap - h >= m) {
      y = r.top - gap - h
    }
    move(card, clamp(x, m, vw - w - m), clamp(y, m, vh - h - m))
  }
  let last = ""
  const render = () => {
    const state = host.getAttribute("data-state")
    $(".bubble span").textContent = host.getAttribute("data-saved") || ""
    $(".remove").textContent = host.hasAttribute("data-saved") ? "Remove" : "Cancel"
    if (state === "open" && last !== "open") {
      note.value = host.getAttribute("data-note") || ""
      grow()
      note.focus({ preventScroll: true })
      note.setSelectionRange(note.value.length, note.value.length)
    }
    last = state
  }
  new MutationObserver(render).observe(host, { attributes: true, attributeFilter: ["data-state", "data-saved"] })
  document.documentElement.appendChild(host)
  place()
  render()
}

// A click on an annotation's own pin or bubble while picking.
function annotationOf() {
  const host = this.getRootNode().host
  if (!host || !host.hasAttribute("data-lor-annotation")) return null
  return { id: host.getAttribute("data-lor-annotation"), by: host.getAttribute("data-lor-by") }
}

function toggleAll(name, on) {
  document.querySelectorAll("[data-lor-annotation]").forEach((host) => host.toggleAttribute(name, on))
}

function readOne(id) {
  const host = Array.from(document.querySelectorAll("[data-lor-annotation]")).find((h) => h.getAttribute("data-lor-annotation") === id)
  if (!host) return null
  return { state: host.getAttribute("data-state"), note: host.getAttribute("data-saved") || "" }
}

function setState(id, state) {
  const host = Array.from(document.querySelectorAll("[data-lor-annotation]")).find((h) => h.getAttribute("data-lor-annotation") === id)
  if (host && state === "gone") host.remove()
  else if (host) host.setAttribute("data-state", state)
}

// Done or Send: a note still open is kept as written (a new empty one goes).
// Returns each of the author's notes; null for a removed one.
function finish(by) {
  const hosts = Array.from(document.querySelectorAll("[data-lor-annotation]")).filter((h) => h.getAttribute("data-lor-by") === by)
  return hosts.map((host) => {
    if (host.getAttribute("data-state") === "open") {
      const text = (host.getAttribute("data-note") || "").trim()
      if (text || host.hasAttribute("data-saved")) {
        host.setAttribute("data-saved", text)
        host.setAttribute("data-state", "saved")
      } else {
        host.setAttribute("data-state", "removed")
      }
    }
    const id = host.getAttribute("data-lor-annotation")
    if (host.getAttribute("data-state") === "removed") {
      host.remove()
      return { id, note: null }
    }
    return { id, note: host.getAttribute("data-saved") || "" }
  })
}

function clearAll(by) {
  document.querySelectorAll("[data-lor-annotation]").forEach((host) => {
    if (host.getAttribute("data-lor-by") === by) host.remove()
  })
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
  let context = 0
  // Made again after a pick: the page may have navigated meanwhile.
  const newWorld = async () => {
    const { frameTree } = await send("Page.getFrameTree")
    const world = await send("Page.createIsolatedWorld", { frameId: frameTree.frame.id, worldName: "lor-annotations" })
    context = world.executionContextId
  }
  const run = async (fn, ...values) => {
    const { result, exceptionDetails } = await send("Runtime.evaluate", {
      expression: "(" + fn.toString() + ")(" + values.map((value) => JSON.stringify(value)).join(",") + ")",
      contextId: context,
      returnByValue: true,
    })
    if (exceptionDetails) throw new Error(exceptionDetails.text)
    return result.value
  }
  await send("Page.enable")
  await send("DOM.enable")
  await send("Overlay.enable")
  await newWorld()
  const stopPicking = async () => {
    await send("Overlay.setInspectMode", { mode: "none", highlightConfig: {} })
    await run(toggleAll, "data-armed", false)
  }
  // Only the person in control turns picking off; someone else's stop or
  // clear leaves the controller's picker alone.
  const controls = args[2] === "1"
  if (mode === "clear") {
    if (controls) await stopPicking()
    await run(clearAll, args[1])
    return print({ status: "ok" })
  }
  if (mode === "stop") {
    if (controls) await stopPicking()
    return print({ status: "stopped", notes: await run(finish, args[1]) })
  }
  if (mode === "wait") {
    const id = args[1]
    const deadline = Date.now() + WAIT_MS
    while (Date.now() < deadline) {
      const found = await run(readOne, id).catch(() => null)
      if (!found || found.state === "removed") {
        await run(setState, id, "gone").catch(() => {})
        return print({ status: "removed" })
      }
      if (found.state === "saved") return print({ status: "saved", note: found.note })
      await sleep(250)
    }
    return print({ status: "timeout" })
  }

  const [, id, number, by, author] = args
  // Pins take clicks while picking, so a click on one opens its note.
  await run(toggleAll, "data-armed", true)
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
  await newWorld()
  await stopPicking()
  if (!backendNodeId) return print({ status: "timeout" })
  const { object } = await send("DOM.resolveNode", { backendNodeId, executionContextId: context })
  const call = (fn, values) =>
    send("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: fn.toString(), arguments: (values || []).map((value) => ({ value })), returnByValue: true })
  const existing = (await call(annotationOf)).result.value
  if (existing) {
    // Someone else's pin: nothing picked, so the panel asks again.
    if (existing.by !== by) return print({ status: "timeout" })
    await run(setState, existing.id, "open")
    return print({ status: "reopened", id: existing.id })
  }
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
  // Other pins stay out of the crop.
  await run(toggleAll, "data-hidden", true)
  const shot = clip.width >= 4 && clip.height >= 4
    ? await send("Page.captureScreenshot", { format: "jpeg", quality: 75, clip }).catch(() => null)
    : null
  await run(toggleAll, "data-hidden", false)
  await call(annotate, [id, Number(number), by, author, element.selector])
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

export type AnnotatedElement = {
  selector: string
  tag: string
  role: string | null
  name: string | null
  text: string
  html: string
  url: string
}

export type BrowserAnnotateAction =
  | { mode: "pick"; id: string; number: number }
  | { mode: "wait"; id: string }
  | { mode: "stop" | "clear" }

export type BrowserAnnotateResult =
  | { status: "picked"; element: AnnotatedElement; image: string | null }
  | { status: "reopened"; id: string }
  | { status: "saved"; note: string }
  | { status: "stopped"; notes: { id: string; note: string | null }[] }
  | { status: "timeout" | "no_page" | "removed" | "ok" }
  | { status: "no_sandbox" | "unavailable" | "error" }
  | { status: "busy"; controller: BrowserController | null }

const ANNOTATE_PROCESS = "browser-annotate"

// Picking moves the shared browser into Chromium's inspect mode, so only the
// person in control may pick; their name signs the note. Stop and clear act
// on this person's annotations only. Each run replaces the one before it.
export async function annotateBrowser(
  sessionId: string,
  userId: string,
  action: BrowserAnnotateAction
): Promise<BrowserAnnotateResult> {
  const control = await runInBrowserDir(sessionId, readControl)
  if (!control) return { status: "no_sandbox" }
  if (control.exitCode === MISSING) return { status: "unavailable" }
  const controller = parseControl(control.stdout)
  const controls = controller?.userId === userId
  if (action.mode === "pick" && !controls) {
    return { status: "busy", controller }
  }
  const args =
    action.mode === "pick"
      ? [
          "pick",
          action.id,
          String(action.number),
          userId,
          controller?.name ?? "",
        ]
      : action.mode === "wait"
        ? ["wait", action.id]
        : [action.mode, userId, controls ? "1" : "0"]
  const result = await runNamed(owner(sessionId), {
    // A non-controller's stop or clear runs under its own name, so it never
    // replaces the controller's pick or wait.
    name: controls
      ? ANNOTATE_PROCESS
      : `${ANNOTATE_PROCESS}-${userId.replace(/[^\w-]/g, "")}`,
    command: `node -e ${q(ANNOTATE_SCRIPT)} ${args.map((arg) => q(arg)).join(" ")}`,
    timeoutSec: 58,
  })
  if (!result) return { status: "no_sandbox" }
  try {
    const parsed = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "")
    switch (parsed.status) {
      case "picked": {
        const { rect: _rect, ...element } = parsed.element
        return { status: "picked", element, image: parsed.image ?? null }
      }
      case "reopened":
        return { status: "reopened", id: String(parsed.id) }
      case "saved":
        return { status: "saved", note: String(parsed.note ?? "") }
      case "stopped":
        return {
          status: "stopped",
          notes: (Array.isArray(parsed.notes) ? parsed.notes : []).map(
            (entry: { id: unknown; note: unknown }) => ({
              id: String(entry.id),
              note: typeof entry.note === "string" ? entry.note : null,
            })
          ),
        }
      case "timeout":
      case "no_page":
      case "removed":
      case "ok":
        return { status: parsed.status }
      default:
        return { status: "error" }
    }
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
