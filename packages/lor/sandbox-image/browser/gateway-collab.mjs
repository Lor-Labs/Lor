// Working together in the session browser (reference/planned/sandbox-browser-runbook.md
// §7): who is watching, everyone's pointer, Lor's pointer, the page on screen
// and shared annotations. The gateway holds one CDP connection to Chromium
// and installs a small agent in every page, in an isolated world the page's
// own scripts never see. The agent reports the trusted input the page gets
// (Lor's `lor-browser` clicks arrive there, with no X pointer to watch) and
// draws annotations on the page itself, so the stream and Lor's screenshots
// show them. Viewers talk to it over the events socket, in display
// coordinates from 0 to 1, so nobody needs control to point or annotate.
// Annotations are kept in the browser's folder (annotations.json, with each
// screenshot beside it), so they outlive this process; the API copies them to
// the database and puts them back into a new sandbox (§8).
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import WebSocket from "ws"

const WORLD = "lor-collab"
const BINDING = "__lorSay"
const CDP_TIMEOUT_MS = 4000
const RECONNECT_MS = 2000
const MAX_ANNOTATIONS = 60
const MAX_NOTE = 2000
// Lor's pointer for people: page input within this long of an injected
// scroll is the gateway's own, not Lor's.
const OWN_INPUT_MS = 250
const LOR_REST_MS = 60_000
export const COLORS = [
  "#e5484d",
  "#f76b15",
  "#ffb224",
  "#30a46c",
  "#12a594",
  "#0091ff",
  "#3e63dd",
  "#d6409f",
]

export const colorFor = (userId) => {
  let hash = 0
  for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return COLORS[hash % COLORS.length]
}

// Runs in each page's isolated world. Everything it is given and returns is
// in display fractions (0 to 1), converted here with the window's place on
// the screen.
function pageAgent(binding) {
  if (globalThis.__lor || window.top !== window) return
  const say = (msg) => {
    try {
      globalThis[binding](JSON.stringify(msg))
    } catch {}
  }
  // The viewport's corner on the screen, from the last real mouse event when
  // there is one (exact), else from the window's frame.
  let corner = null
  const zoom = () => window.devicePixelRatio || 1
  const origin = () => {
    if (corner) return corner
    const border = Math.max(0, (outerWidth - innerWidth * zoom()) / 2)
    return {
      x: screenX + border,
      y: screenY + Math.max(0, outerHeight - innerHeight * zoom() - border),
    }
  }
  const toClient = (nx, ny) => {
    const o = origin()
    return {
      x: (nx * screen.width - o.x) / zoom(),
      y: (ny * screen.height - o.y) / zoom(),
    }
  }
  const toDisplay = (x, y) => {
    const o = origin()
    return {
      x: (o.x + x * zoom()) / screen.width,
      y: (o.y + y * zoom()) / screen.height,
    }
  }
  const rectToDisplay = (r) => {
    const a = toDisplay(r.left, r.top)
    const b = toDisplay(r.right, r.bottom)
    return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }
  }

  // Trusted input the page receives: Lor's commands while nobody has control.
  let lastMove = 0
  const pointer = (kind) => (event) => {
    if (!event.isTrusted) return
    corner = {
      x: event.screenX - event.clientX * zoom(),
      y: event.screenY - event.clientY * zoom(),
    }
    if (kind === "move") {
      // After a load or a layout change Chromium sends the resting X
      // pointer's position again, with no movement: not Lor's.
      if (event.movementX === 0 && event.movementY === 0) return
      const now = Date.now()
      if (now - lastMove < 40) return
      lastMove = now
    }
    say({
      k: "input",
      kind,
      x: event.screenX / screen.width,
      y: event.screenY / screen.height,
    })
  }
  const listen = (name, fn) =>
    addEventListener(name, fn, { capture: true, passive: true })
  listen("mousemove", pointer("move"))
  listen("mousedown", pointer("down"))
  // Typing has no pointer: point at the field.
  const field = (kind) => (event) => {
    const el = event.target
    if (!event.isTrusted || !el || !el.getBoundingClientRect) return
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) return
    const at = toDisplay(
      Math.min(r.left + r.width / 2, r.left + 120),
      r.top + r.height / 2
    )
    say({ k: "input", kind, x: at.x, y: at.y })
  }
  listen("focusin", field("focus"))
  listen("input", field("type"))

  // The page on screen, for the panel: reported when it shows, and when its
  // address or title changes (history.pushState has no event here).
  let told = ""
  const tellPage = () => {
    const visible = document.visibilityState === "visible"
    const next = `${visible}\n${location.href}\n${document.title}`
    if (next === told) return
    told = next
    say({ k: "page", visible, url: location.href, title: document.title })
  }
  listen("visibilitychange", tellPage)
  listen("pageshow", tellPage)
  setInterval(tellPage, 700)
  tellPage()

  const describe = (el) => {
    const implicitRoles = {
      A: "link",
      BUTTON: "button",
      TEXTAREA: "textbox",
      SELECT: "combobox",
      IMG: "img",
      NAV: "navigation",
      FORM: "form",
      H1: "heading",
      H2: "heading",
      H3: "heading",
      H4: "heading",
    }
    const role =
      el.getAttribute("role") ||
      (el.tagName === "INPUT"
        ? el.type === "checkbox"
          ? "checkbox"
          : el.type === "submit"
            ? "button"
            : "textbox"
        : implicitRoles[el.tagName]) ||
      null
    const text = (el.innerText || el.textContent || "")
      .trim()
      .replace(/\s+/g, " ")
    const name =
      el.getAttribute("aria-label") ||
      el.getAttribute("alt") ||
      el.getAttribute("title") ||
      el.getAttribute("placeholder") ||
      text.slice(0, 80) ||
      null
    const step = (node) => {
      const testId = node.getAttribute("data-testid")
      if (testId) return `[data-testid="${testId}"]`
      if (
        node.id &&
        document.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1
      ) {
        return `#${CSS.escape(node.id)}`
      }
      const tag = node.tagName.toLowerCase()
      const parent = node.parentElement
      if (!parent) return tag
      const same = Array.from(parent.children).filter(
        (child) => child.tagName === node.tagName
      )
      return same.length === 1
        ? tag
        : `${tag}:nth-of-type(${same.indexOf(node) + 1})`
    }
    const parts = []
    for (
      let node = el;
      node && node !== document.body && parts.length < 6;
      node = node.parentElement
    ) {
      const part = step(node)
      parts.unshift(part)
      if (part.startsWith("#") || part.startsWith("[")) break
    }
    return {
      selector: parts.join(" > "),
      tag: el.tagName.toLowerCase(),
      role,
      name,
      text: text.slice(0, 200),
      html: el.outerHTML.slice(0, 300),
      url: location.href,
    }
  }

  // The element a person points at: the deepest one, through open shadow
  // roots. Annotation layers take no pointer events, so they never match.
  const elementAt = (x, y) => {
    let el = document.elementFromPoint(x, y)
    while (el?.shadowRoot) {
      const inner = el.shadowRoot.elementFromPoint(x, y)
      if (!inner || inner === el) break
      el = inner
    }
    return el && el !== document.documentElement ? el : null
  }

  // A text range between two points, for a note on highlighted text.
  const rangeBetween = (a, b) => {
    const caret = (p) => {
      if (document.caretPositionFromPoint) {
        const pos = document.caretPositionFromPoint(p.x, p.y)
        return pos ? { node: pos.offsetNode, offset: pos.offset } : null
      }
      const r = document.caretRangeFromPoint?.(p.x, p.y)
      return r ? { node: r.startContainer, offset: r.startOffset } : null
    }
    const start = caret(a)
    const end = caret(b)
    if (!start || !end) return null
    const range = document.createRange()
    try {
      range.setStart(start.node, start.offset)
      range.setEnd(end.node, end.offset)
      if (range.collapsed) {
        range.setStart(end.node, end.offset)
        range.setEnd(start.node, start.offset)
      }
    } catch {
      return null
    }
    return range.collapsed || !range.toString().trim() ? null : range
  }

  const notes = new Map()
  const layer = document.createElement("div")
  layer.setAttribute("data-lor-annotations", "")
  layer.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:2147483647"
  const root = layer.attachShadow({ mode: "closed" })
  root.innerHTML = `<style>
    :host{all:initial}
    *{box-sizing:border-box;margin:0;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased}
    .hide{display:none!important}
    .ring,.pin,.bubble,.mark{position:fixed;left:0;top:0}
    .ring{border:1.5px solid var(--c);border-radius:4px;opacity:.75}
    .open .ring{border-width:2px;opacity:1;background:color-mix(in srgb,var(--c) 10%,transparent)}
    .mark{background:color-mix(in srgb,var(--c) 28%,transparent);border-radius:2px}
    .pin{width:24px;height:24px;border:2px solid #fff;border-radius:12px 12px 12px 3px;background:var(--c);color:#fff;box-shadow:0 1px 4px rgba(0,0,0,.3);font-size:11px;font-weight:600;line-height:20px;text-align:center}
    .bubble{max-width:260px;padding:4px 8px;border:1px solid rgba(28,25,23,.1);border-radius:8px;background:#fff;color:#1c1917;box-shadow:0 2px 8px rgba(0,0,0,.14);font-size:12px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .bubble b{margin-right:4px;font-weight:600;color:var(--c)}
    .bubble i{font-style:normal;color:#a8a29e}
  </style>`
  const mount = () => {
    if (!layer.isConnected) document.documentElement.appendChild(layer)
  }

  const clamp = (value, min, max) => Math.max(min, Math.min(value, max))
  const move = (node, x, y) => {
    node.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`
  }

  // One annotation: an outline (or the highlighted text), a numbered pin at
  // its corner and a one-line bubble with the note as it is typed.
  const draw = (note) => {
    const group = document.createElement("div")
    group.style.setProperty("--c", note.color)
    group.innerHTML =
      "<div class='ring'></div><div class='pin'></div><div class='bubble'><b></b><span></span></div>"
    const ring = group.querySelector(".ring")
    const pin = group.querySelector(".pin")
    const bubble = group.querySelector(".bubble")
    pin.textContent = String(note.number)
    bubble.querySelector("b").textContent = note.author.split(" ")[0]
    root.appendChild(group)
    const state = {
      ...note,
      group,
      ring,
      pin,
      bubble,
      marks: [],
      rect: null,
      at: Date.now(),
    }
    notes.set(note.id, state)
    setText(state)
    return state
  }

  const setText = (state) => {
    const span = state.bubble.querySelector("span")
    span.textContent = state.text || ""
    if (!state.text && state.open) {
      const writing = document.createElement("i")
      writing.textContent = "is writing…"
      span.appendChild(writing)
    }
    state.group.classList.toggle("open", Boolean(state.open))
  }

  // Finds the element again after a re-render, and the range after a reload.
  const target = (state) => {
    if (state.el?.isConnected) return state.el
    try {
      state.el = document.querySelector(state.selector)
    } catch {
      state.el = null
    }
    return state.el
  }

  const place = () => {
    requestAnimationFrame(place)
    if (notes.size === 0) return
    mount()
    const vw = document.documentElement.clientWidth
    const vh = document.documentElement.clientHeight
    for (const state of notes.values()) {
      const el = target(state)
      let rects = []
      if (state.range && !state.range.collapsed) {
        rects = Array.from(state.range.getClientRects())
      }
      const r =
        rects[0] ?? (el?.isConnected ? el.getBoundingClientRect() : state.rect)
      if (!r) continue
      state.rect = r
      const shown =
        (rects.length > 0 || el?.isConnected) &&
        (r.width > 0 || r.height > 0) &&
        r.bottom > 0 &&
        r.right > 0 &&
        r.top < vh &&
        r.left < vw
      state.group.classList.toggle("hide", !shown)
      if (!shown) continue
      // Highlighted text draws its own lines instead of the outline.
      state.ring.classList.toggle("hide", rects.length > 0)
      while (state.marks.length < rects.length) {
        const mark = document.createElement("div")
        mark.className = "mark"
        state.group.insertBefore(mark, state.ring)
        state.marks.push(mark)
      }
      state.marks.forEach((mark, i) => {
        const line = rects[i]
        mark.classList.toggle("hide", !line)
        if (!line) return
        mark.style.width = `${line.width}px`
        mark.style.height = `${line.height}px`
        move(mark, line.left, line.top)
      })
      state.ring.style.width = `${r.width + 4}px`
      state.ring.style.height = `${r.height + 4}px`
      move(state.ring, r.left - 2, r.top - 2)
      const px = clamp(r.left - 2, 4, vw - 28)
      const py = clamp(r.top - 26, 4, vh - 28)
      move(state.pin, px, py)
      const show = Boolean(state.text) || state.open
      state.bubble.classList.toggle("hide", !show)
      const bw = state.bubble.offsetWidth
      move(state.bubble, px + 28 + bw > vw - 4 ? px - 4 - bw : px + 28, py - 1)
    }
  }
  place()

  // A selection being dragged, one per person, shown to everyone.
  const drags = new Map()
  const drawDrag = (id, color, rects) => {
    let box = drags.get(id)
    if (!box) {
      box = document.createElement("div")
      box.style.setProperty("--c", color)
      root.appendChild(box)
      drags.set(id, box)
    }
    mount()
    box.replaceChildren(
      ...rects.map((line) => {
        const mark = document.createElement("div")
        mark.className = "mark"
        mark.style.width = `${line.width}px`
        mark.style.height = `${line.height}px`
        move(mark, line.left, line.top)
        return mark
      })
    )
  }

  const pinAt = (x, y) => {
    for (const state of notes.values()) {
      if (state.group.classList.contains("hide")) continue
      const r = state.pin.getBoundingClientRect()
      if (
        x >= r.left - 4 &&
        x <= r.right + 4 &&
        y >= r.top - 4 &&
        y <= r.bottom + 4
      ) {
        return state
      }
    }
    return null
  }

  const anchor = (r) => rectToDisplay(r)

  globalThis.__lor = {
    client: toClient,
    // What a click here would annotate: an existing pin, or an element.
    hover(nx, ny) {
      const p = toClient(nx, ny)
      const pin = pinAt(p.x, p.y)
      if (pin)
        return { pin: pin.id, rect: anchor(pin.pin.getBoundingClientRect()) }
      const el = elementAt(p.x, p.y)
      return el ? { rect: anchor(el.getBoundingClientRect()) } : null
    },
    // A drag in progress: the text between the two points, highlighted.
    select(id, color, ax, ay, bx, by) {
      const range = rangeBetween(toClient(ax, ay), toClient(bx, by))
      drawDrag(id, color, range ? Array.from(range.getClientRects()) : [])
      return Boolean(range)
    },
    endSelect(id) {
      drags.get(id)?.remove()
      drags.delete(id)
    },
    // A click (or the end of a drag over text): draws the annotation and
    // returns what it is on, with the clip for its screenshot.
    pick(note, ax, ay, bx, by) {
      const a = toClient(ax, ay)
      const pin = pinAt(a.x, a.y)
      if (pin)
        return { pin: pin.id, anchor: anchor(pin.pin.getBoundingClientRect()) }
      const range = bx === null ? null : rangeBetween(a, toClient(bx, by))
      const el = range
        ? range.commonAncestorContainer.nodeType === 1
          ? range.commonAncestorContainer
          : range.commonAncestorContainer.parentElement
        : elementAt(a.x, a.y)
      if (!el) return null
      const element = describe(el)
      const quote = range ? range.toString().trim().slice(0, 500) : null
      const state = draw({ ...note, selector: element.selector, open: true })
      state.el = el
      state.range = range
      const box = range
        ? range.getBoundingClientRect()
        : el.getBoundingClientRect()
      const pad = 12
      return {
        element: { ...element, quote },
        anchor: anchor(box),
        // Page.captureScreenshot's clip is in document coordinates.
        clip: {
          x: Math.max(0, box.left + scrollX - pad),
          y: Math.max(0, box.top + scrollY - pad),
          width: Math.min(1600, box.width + pad * 2),
          height: Math.min(1000, box.height + pad * 2),
        },
      }
    },
    where(id) {
      const state = notes.get(id)
      return state?.rect ? anchor(state.pin.getBoundingClientRect()) : null
    },
    note(id, text, open) {
      const state = notes.get(id)
      if (!state) return false
      state.text = text
      state.open = open
      setText(state)
      return true
    },
    remove(id) {
      notes.get(id)?.group.remove()
      notes.delete(id)
    },
    // The annotations made on this address: they come back after a reload,
    // and ones sent or cleared meanwhile go. A pin just drawn stays: its
    // pick may not have reached the gateway's list yet.
    sync(list) {
      const keep = new Set(list.map((note) => note.id))
      for (const [id, state] of notes) {
        if (keep.has(id) || Date.now() - state.at < 3000) continue
        state.group.remove()
        notes.delete(id)
      }
      for (const note of list) {
        if (!notes.has(note.id)) draw(note)
      }
    },
    // A new gateway connection found this agent already here.
    announce() {
      told = ""
      tellPage()
    },
    // Pins stay out of an annotation's own screenshot.
    hidden(on) {
      layer.style.visibility = on ? "hidden" : ""
    },
  }
}

export function createCollab({ cdpPort, dir, controller, broadcast, send }) {
  const FILE = `${dir}/annotations.json`
  const SHOTS = `${dir}/annotations`
  // Page sessions by CDP session id: its isolated world, and what it shows.
  const pages = new Map()
  const annotations = new Map()
  let cdp = null
  let next = 0
  const calls = new Map()
  let page = { url: "", title: "" }
  let ownInputAt = 0
  let lor = null

  const call = (method, params = {}, sessionId) =>
    new Promise((resolve) => {
      if (!cdp || cdp.readyState !== WebSocket.OPEN) return resolve(null)
      const id = ++next
      const timer = setTimeout(() => {
        calls.delete(id)
        resolve(null)
      }, CDP_TIMEOUT_MS)
      calls.set(id, (msg) => {
        clearTimeout(timer)
        resolve(msg.error ? null : (msg.result ?? {}))
      })
      cdp.send(JSON.stringify({ id, method, params, sessionId }))
    })

  // The tab people see: the one that last said it is visible.
  const current = () => {
    let best = null
    for (const entry of pages.values()) {
      if (!entry.visible || !entry.context) continue
      if (!best || entry.seenAt > best.seenAt) best = entry
    }
    return best
  }

  const inPage = async (entry, expression) => {
    if (!entry?.context) return null
    const result = await call(
      "Runtime.evaluate",
      { expression, contextId: entry.context, returnByValue: true },
      entry.sessionId
    )
    return result?.exceptionDetails ? null : (result?.result?.value ?? null)
  }
  const run = (method, ...args) =>
    inPage(
      current(),
      `globalThis.__lor ? globalThis.__lor.${method}(${args.map((arg) => JSON.stringify(arg)).join(",")}) : null`
    )

  const AGENT = `(${pageAgent})(${JSON.stringify(BINDING)})`

  // A page's main frame has its target's id.
  const attach = async (sessionId, frameId) => {
    const entry = {
      sessionId,
      frameId,
      context: 0,
      visible: false,
      seenAt: 0,
      url: "",
      title: "",
    }
    pages.set(sessionId, entry)
    await call("Page.enable", {}, sessionId)
    await call("Runtime.enable", {}, sessionId)
    await call(
      "Runtime.addBinding",
      { name: BINDING, executionContextName: WORLD },
      sessionId
    )
    await call(
      "Page.addScriptToEvaluateOnNewDocument",
      { source: AGENT, worldName: WORLD },
      sessionId
    )
    // The document already open has no world yet.
    const world = await call(
      "Page.createIsolatedWorld",
      { frameId, worldName: WORLD },
      sessionId
    )
    // Its context event arrives before this answer and sets entry.context,
    // so the agent goes into the world by its own id (it installs once).
    if (world?.executionContextId) {
      entry.context ||= world.executionContextId
      await inPage({ sessionId, context: world.executionContextId }, AGENT)
    }
    await inPage(entry, "globalThis.__lor && globalThis.__lor.announce()")
  }

  const withoutImage = ({ image: _image, clip: _clip, ...rest }) => rest

  // Once this process has written the file it owns it; until then a file
  // that appears is the API's stored copy for a new sandbox.
  // Writes run one at a time and each takes the list as it is then, so an
  // older write never lands last.
  let owned = false
  let saving = null
  let writing = Promise.resolve()
  // A failed write rejects its own promise; the queue goes on.
  const write = () => {
    const step = writing.then(async () => {
      const items = [...annotations.values()].map(withoutImage)
      await writeFile(`${FILE}.tmp`, JSON.stringify({ items }))
      await rename(`${FILE}.tmp`, FILE)
    })
    writing = step.catch(() => {})
    return step
  }
  const save = () => {
    owned = true
    clearTimeout(saving)
    saving = setTimeout(() => write().catch(() => {}), 300)
  }
  const saveNow = () => {
    owned = true
    clearTimeout(saving)
    return write()
  }
  const shot = (id) => `${SHOTS}/${id}.jpg`

  // `now`: the file is written before the list goes out, so a viewer who
  // sees notes gone knows the API can store that (Send to Lor's clear). A
  // failed write throws and nothing goes out: the sender is told the notes
  // are still there.
  const publish = async (now = false) => {
    if (now) await saveNow()
    else save()
    broadcast({
      type: "comments",
      items: [...annotations.values()].map(withoutImage),
    })
  }

  const drawable = (a) => ({
    id: a.id,
    number: a.number,
    color: a.color,
    author: a.by.name,
    text: a.note,
    selector: a.element.selector,
    open: a.open,
  })

  const onPageMessage = (sessionId, payload) => {
    const entry = pages.get(sessionId)
    if (!entry) return
    let msg
    try {
      msg = JSON.parse(payload)
    } catch {
      return
    }
    if (msg.k === "page") {
      entry.visible = msg.visible === true
      entry.url = String(msg.url ?? "")
      entry.title = String(msg.title ?? "")
      entry.seenAt = Date.now()
      const shown = current()
      if (shown && (shown.url !== page.url || shown.title !== page.title)) {
        page = { url: shown.url, title: shown.title }
        broadcast({ type: "page", ...page })
      }
      // A reload, another address or a return to the tab: the page shows
      // the annotations made on this address, and no others.
      if (entry.visible) {
        const here = [...annotations.values()].filter(
          (a) => a.element.url === entry.url
        )
        void inPage(
          entry,
          `globalThis.__lor && globalThis.__lor.sync(${JSON.stringify(here.map(drawable))})`
        )
      }
    } else if (msg.k === "input") {
      // A person's input reaches the page too; theirs is shown from their
      // own view. Only Lor's commands arrive with nobody in control.
      if (controller() || Date.now() - ownInputAt < OWN_INPUT_MS) return
      const x = Number(msg.x)
      const y = Number(msg.y)
      if (!Number.isFinite(x) || !Number.isFinite(y)) return
      lor = { x, y, kind: String(msg.kind), at: Date.now() }
      broadcast({ type: "lor", x, y, kind: lor.kind })
    }
  }

  const onEvent = (msg) => {
    const { method, params, sessionId } = msg
    if (method === "Target.attachedToTarget") {
      if (params.targetInfo.type === "page") {
        void attach(params.sessionId, params.targetInfo.targetId)
      }
    } else if (method === "Target.detachedFromTarget") {
      pages.delete(params.sessionId)
    } else if (method === "Runtime.bindingCalled") {
      if (params.name === BINDING) onPageMessage(sessionId, params.payload)
    } else if (method === "Runtime.executionContextCreated") {
      const entry = pages.get(sessionId)
      const context = params.context
      if (
        entry &&
        context.name === WORLD &&
        context.auxData?.frameId === entry.frameId
      ) {
        entry.context = context.id
      }
    } else if (method === "Runtime.executionContextsCleared") {
      const entry = pages.get(sessionId)
      if (entry) entry.context = 0
    }
  }

  const connect = async () => {
    try {
      const version = await (
        await fetch(`http://127.0.0.1:${cdpPort}/json/version`, {
          signal: AbortSignal.timeout(CDP_TIMEOUT_MS),
        })
      ).json()
      const ws = new WebSocket(version.webSocketDebuggerUrl, {
        handshakeTimeout: CDP_TIMEOUT_MS,
      })
      ws.on("error", () => {})
      ws.on("close", () => {
        if (cdp === ws) cdp = null
        pages.clear()
        setTimeout(connect, RECONNECT_MS)
      })
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw)
        const done = msg.id && calls.get(msg.id)
        if (done) {
          calls.delete(msg.id)
          done(msg)
        } else if (msg.method) onEvent(msg)
      })
      ws.on("open", async () => {
        cdp = ws
        await call("Target.setAutoAttach", {
          autoAttach: true,
          waitForDebuggerOnStart: false,
          flatten: true,
          filter: [{ type: "page" }],
        })
        // Tabs open before this connection.
        const targets = await call("Target.getTargets")
        for (const info of targets?.targetInfos ?? []) {
          if (info.type !== "page" || info.attached) continue
          await call("Target.attachToTarget", {
            targetId: info.targetId,
            flatten: true,
          })
        }
      })
    } catch {
      setTimeout(connect, RECONNECT_MS)
    }
  }
  void connect()

  const loadStored = async () => {
    if (owned || annotations.size > 0) return
    let items = []
    try {
      items = JSON.parse(await readFile(FILE, "utf8")).items
    } catch {
      return
    }
    if (owned || annotations.size > 0 || !Array.isArray(items)) return
    for (const item of items.slice(0, MAX_ANNOTATIONS)) {
      if (!item?.id || !item.element?.selector || !item.by?.userId) continue
      annotations.set(item.id, {
        ...item,
        note: String(item.note ?? ""),
        open: false,
        image: null,
      })
    }
    if (annotations.size === 0) return
    broadcast({
      type: "comments",
      items: [...annotations.values()].map(withoutImage),
    })
    const entry = current()
    if (!entry) return
    const here = [...annotations.values()].filter(
      (a) => a.element.url === entry.url
    )
    void inPage(
      entry,
      `globalThis.__lor && globalThis.__lor.sync(${JSON.stringify(here.map(drawable))})`
    )
  }
  void loadStored()

  const forget = (id) => {
    annotations.delete(id)
    void unlink(shot(id)).catch(() => {})
  }

  const number = () =>
    Math.max(0, ...[...annotations.values()].map((a) => a.number)) + 1
  const fraction = (value) =>
    typeof value === "number" && value >= -0.05 && value <= 1.05

  const capture = async (entry, clip) => {
    if (!clip || clip.width < 4 || clip.height < 4) return null
    await inPage(entry, "globalThis.__lor.hidden(true)")
    const shot = await call(
      "Page.captureScreenshot",
      { format: "jpeg", quality: 75, clip: { ...clip, scale: 1 } },
      entry.sessionId
    )
    await inPage(entry, "globalThis.__lor.hidden(false)")
    return shot?.data ?? null
  }

  // Messages from one viewer's page. `reply` answers that viewer only.
  // Watching is all a viewer without `annotate` does: their page's messages
  // are dropped here, whatever it sends.
  const onMessage = async (viewer, msg) => {
    const reply = (data) => send(viewer, data)
    if (!viewer.annotate) {
      if (msg.t === "pick") {
        reply({ type: "picked", seq: msg.seq, error: "not_allowed" })
      } else if (msg.t === "export") {
        reply({ type: "export", seq: msg.seq, items: [] })
      }
      return
    }
    switch (msg.t) {
      case "ptr": {
        if (msg.gone || !fraction(msg.x) || !fraction(msg.y)) {
          broadcast({ type: "cursor", id: viewer.userId, gone: true }, viewer)
          return
        }
        broadcast(
          {
            type: "cursor",
            id: viewer.userId,
            name: viewer.name,
            color: viewer.color,
            x: msg.x,
            y: msg.y,
            down: msg.down === true,
            drives: controller() === viewer.userId,
          },
          viewer
        )
        return
      }
      case "hover": {
        if (!fraction(msg.x) || !fraction(msg.y)) return
        reply({
          type: "hover",
          seq: msg.seq,
          at: await run("hover", msg.x, msg.y),
        })
        return
      }
      // Scrolling while annotating. Refused while someone else has control:
      // the page is theirs to move.
      case "wheel": {
        const entry = current()
        const driver = controller()
        if (!entry || (driver && driver !== viewer.userId)) return
        if (!fraction(msg.x) || !fraction(msg.y)) return
        const at = await run("client", msg.x, msg.y)
        if (!at) return
        ownInputAt = Date.now()
        await call(
          "Input.dispatchMouseEvent",
          {
            type: "mouseWheel",
            x: at.x,
            y: at.y,
            deltaX: Math.max(-2000, Math.min(2000, Number(msg.dx) || 0)),
            deltaY: Math.max(-2000, Math.min(2000, Number(msg.dy) || 0)),
          },
          entry.sessionId
        )
        return
      }
      case "select": {
        if (![msg.ax, msg.ay, msg.bx, msg.by].every(fraction)) return
        await run(
          "select",
          viewer.userId,
          viewer.color,
          msg.ax,
          msg.ay,
          msg.bx,
          msg.by
        )
        return
      }
      case "pick": {
        const entry = current()
        await run("endSelect", viewer.userId)
        if (!entry || !fraction(msg.ax) || !fraction(msg.ay)) {
          return reply({ type: "picked", seq: msg.seq, error: "no_page" })
        }
        if (annotations.size >= MAX_ANNOTATIONS) {
          return reply({ type: "picked", seq: msg.seq, error: "full" })
        }
        const dragged = fraction(msg.bx) && fraction(msg.by)
        const id = crypto.randomUUID()
        const note = {
          id,
          number: number(),
          color: viewer.color,
          author: viewer.name,
          text: "",
        }
        const picked = await inPage(
          entry,
          `globalThis.__lor ? globalThis.__lor.pick(${JSON.stringify(note)}, ${msg.ax}, ${msg.ay}, ${dragged ? msg.bx : null}, ${dragged ? msg.by : null}) : null`
        )
        if (!picked) {
          return reply({ type: "picked", seq: msg.seq, error: "nothing" })
        }
        // An existing pin: its note opens instead.
        if (picked.pin) {
          return reply({
            type: "picked",
            seq: msg.seq,
            id: picked.pin,
            number: annotations.get(picked.pin)?.number,
            existing: true,
            anchor: picked.anchor,
          })
        }
        annotations.set(id, {
          id,
          number: note.number,
          color: viewer.color,
          by: { userId: viewer.userId, name: viewer.name },
          note: "",
          open: true,
          element: picked.element,
          image: null,
        })
        reply({
          type: "picked",
          seq: msg.seq,
          id,
          number: note.number,
          anchor: picked.anchor,
        })
        void publish()
        const image = await capture(entry, picked.clip)
        const saved = annotations.get(id)
        if (saved && image) {
          saved.image = image
          await mkdir(SHOTS, { recursive: true }).catch(() => {})
          await writeFile(shot(id), Buffer.from(image, "base64")).catch(
            () => {}
          )
        }
        return
      }
      case "note": {
        const item = annotations.get(msg.id)
        if (!item || item.by.userId !== viewer.userId) return
        item.note = String(msg.text ?? "").slice(0, MAX_NOTE)
        item.open = msg.open === true
        await run("note", item.id, item.note, item.open)
        void publish()
        return
      }
      case "where": {
        reply({ type: "where", id: msg.id, anchor: await run("where", msg.id) })
        return
      }
      case "remove": {
        const item = annotations.get(msg.id)
        if (!item || item.by.userId !== viewer.userId) return
        forget(item.id)
        await run("remove", item.id)
        void publish()
        return
      }
      // Send to Lor: everything with its screenshot, for the sender's panel.
      // A screenshot from before this process started is read from its file.
      case "export": {
        if (!viewer.send) {
          return reply({ type: "export", seq: msg.seq, items: [] })
        }
        const items = []
        for (const { clip: _clip, ...item } of annotations.values()) {
          const image =
            item.image ??
            (await readFile(shot(item.id), "base64").catch(() => null))
          items.push({ ...item, image })
        }
        reply({ type: "export", seq: msg.seq, items })
        return
      }
      // After a send (every annotation that went, for whoever may send) or a
      // discard (one's own).
      case "clear": {
        const ids =
          Array.isArray(msg.ids) && viewer.send ? new Set(msg.ids) : null
        if (Array.isArray(msg.ids) && !ids) return
        for (const item of [...annotations.values()]) {
          const mine = item.by.userId === viewer.userId
          if (ids ? !ids.has(item.id) : !mine) continue
          forget(item.id)
          await run("remove", item.id)
        }
        await publish(true)
        return
      }
    }
  }

  return {
    onMessage: (viewer, msg) => onMessage(viewer, msg).catch(() => {}),
    // What a viewer who just connected needs to catch up.
    welcome: (viewer) => {
      if (page.url) send(viewer, { type: "page", ...page })
      send(viewer, {
        type: "comments",
        items: [...annotations.values()].map(withoutImage),
      })
      // Where Lor's pointer rests (bridge.js keeps it about a minute).
      if (lor && Date.now() - lor.at < LOR_REST_MS) {
        send(viewer, { type: "lor", x: lor.x, y: lor.y, kind: "move" })
      }
    },
    left: (viewer) => {
      if (!viewer.annotate) return
      broadcast({ type: "cursor", id: viewer.userId, gone: true }, viewer)
      void run("endSelect", viewer.userId)
    },
    // annotations.json appeared in the folder.
    stored: () => void loadStored(),
  }
}
