// The session browser's live-view gateway (reference/planned/sandbox-browser-runbook.md
// §4), the only browser port meant for a preview. Each viewer gets a grant
// the API wrote into the browser folder; its id is the path prefix
// (/v/<grant>/) Selkies' web client loads under, so the view works in a
// cross-site iframe without cookies. The gateway proxies that prefix to
// Selkies with the controller token for the person in control and the viewer
// token for everyone else, so watching is enforced by Selkies, not by the
// client. When control changes, Selkies connections whose role changed are
// closed and the page's bridge script reloads it in its new role. Control
// goes back to Lor after the controller has had no connection for a while.
import { execFile } from "node:child_process"
import { readFile, stat, unlink, utimes } from "node:fs/promises"
import { createServer, request } from "node:http"
import { promisify } from "node:util"
import WebSocket, { WebSocketServer } from "ws"

const DIR = process.env.LOR_BROWSER_DIR ?? "/workspace/.cache/lor-browser"
const VIEW_PORT = Number(process.env.LOR_BROWSER_VIEW_PORT ?? 6080)
const CDP_PORT = Number(process.env.LOR_BROWSER_CDP_PORT ?? 9222)
const SOCKET = process.env.LOR_BROWSER_SELKIES_SOCKET ?? `${DIR}/selkies.sock`
const TOKENS = {
  control: process.env.LOR_BROWSER_CONTROL_TOKEN ?? "",
  watch: process.env.LOR_BROWSER_WATCH_TOKEN ?? "",
}
// A grant lapses after this long without a connection, and at most this
// long after the API made it.
const GRANT_IDLE_MS = 10 * 60_000
const GRANT_MAX_MS = 12 * 60 * 60_000
const RELEASE_AFTER_MS = 2 * 60_000
const MAX_CONNECTIONS = 40
const MAX_BUFFERED = 8 * 1024 * 1024
const ROLE_CHANGED = 4001
// Selkies sizes the display from these; only the person in control may.
const CONTROLLER_ONLY = ["r,", "s,"]
// Each CDP step in the window fit; a hung Chromium must not stall the ticks.
const CDP_TIMEOUT_MS = 2000

const GRANT = /^[a-f0-9]{32,64}$/
const VIEW_PATH = /^\/v\/([^/]+)(\/.*)?$/

const run = promisify(execFile)
const streams = new Set()
const listeners = new Set()
let controllerId = ""
let controllerName = ""
let controllerSeenAt = Date.now()

async function readText(file) {
  try {
    return (await readFile(`${DIR}/${file}`, "utf8")).trim()
  } catch {
    return ""
  }
}

async function readGrant(id) {
  if (!GRANT.test(id)) return null
  const file = `${DIR}/viewers/${id}`
  try {
    const [text, info] = await Promise.all([readFile(file, "utf8"), stat(file)])
    const grant = JSON.parse(text)
    if (typeof grant?.userId !== "string" || typeof grant?.at !== "number") {
      return null
    }
    const now = Date.now()
    const inUse = [...streams, ...listeners].some((c) => c.grant === id)
    if (now - grant.at > GRANT_MAX_MS) return null
    if (!inUse && now - info.mtimeMs > GRANT_IDLE_MS) return null
    return { id, userId: grant.userId }
  } catch {
    return null
  }
}

const roleFor = (userId) =>
  controllerId && userId === controllerId ? "control" : "watch"

const controlMessage = (userId) =>
  JSON.stringify({
    role: roleFor(userId),
    controller: controllerId
      ? { userId: controllerId, name: controllerName || "Someone" }
      : null,
  })

async function syncControl() {
  const [next, name] = await Promise.all([
    readText("controller-id"),
    readText("controller"),
  ])
  if (next !== controllerId || name !== controllerName) {
    const changed = next !== controllerId
    controllerId = next
    controllerName = name
    if (changed) controllerSeenAt = Date.now()
    for (const c of streams) {
      if (roleFor(c.userId) !== c.role) c.ws.close(ROLE_CHANGED, "role changed")
    }
    for (const l of listeners) l.ws.send(controlMessage(l.userId))
  }
  const now = new Date()
  for (const id of new Set([...streams, ...listeners].map((c) => c.grant))) {
    await utimes(`${DIR}/viewers/${id}`, now, now).catch(() => {})
  }
  if (!controllerId) return
  const connected = [...streams].some(
    (c) => c.role === "control" && c.userId === controllerId
  )
  if (connected) {
    controllerSeenAt = Date.now()
  } else if (Date.now() - controllerSeenAt > RELEASE_AFTER_MS) {
    // The controller left without handing back: Lor may drive again.
    await unlink(`${DIR}/controller-id`).catch(() => {})
    await unlink(`${DIR}/controller`).catch(() => {})
  }
}

// Keeps Chromium's windows the display's size: Selkies resizes the display
// to the controller's view, and the window manager doesn't follow.
let fitted = ""
async function fitWindows() {
  const { stdout } = await run("xrandr", [], { timeout: 2000 })
  const size = stdout.match(/current (\d+) x (\d+)/)
  if (!size) return
  const version = await (
    await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, {
      signal: AbortSignal.timeout(CDP_TIMEOUT_MS),
    })
  ).json()
  const key = `${size[1]}x${size[2]} ${version.webSocketDebuggerUrl}`
  if (key === fitted) return
  const cdp = new WebSocket(version.webSocketDebuggerUrl, {
    handshakeTimeout: CDP_TIMEOUT_MS,
  })
  cdp.on("error", () => {})
  let next = 0
  // Null on a timeout or a closed connection, like a failed command.
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      if (cdp.readyState !== WebSocket.OPEN) return resolve(null)
      const id = ++next
      const done = (result) => {
        clearTimeout(timer)
        cdp.off("message", onMessage)
        cdp.off("close", onClose)
        resolve(result)
      }
      const onMessage = (raw) => {
        const msg = JSON.parse(raw)
        if (msg.id === id) done(msg.result ?? null)
      }
      const onClose = () => done(null)
      const timer = setTimeout(() => done(null), CDP_TIMEOUT_MS)
      cdp.on("message", onMessage)
      cdp.on("close", onClose)
      cdp.send(JSON.stringify({ id, method, params }))
    })
  try {
    await new Promise((resolve, reject) => {
      cdp.once("open", resolve)
      cdp.once("error", reject)
    })
    const targets = await send("Target.getTargets")
    const windows = new Set()
    for (const t of targets?.targetInfos ?? []) {
      if (t.type !== "page") continue
      const win = await send("Browser.getWindowForTarget", {
        targetId: t.targetId,
      })
      if (win) windows.add(win.windowId)
    }
    for (const windowId of windows) {
      await send("Browser.setWindowBounds", {
        windowId,
        bounds: { windowState: "normal" },
      })
      await send("Browser.setWindowBounds", {
        windowId,
        bounds: { left: 0, top: 0, width: +size[1], height: +size[2] },
      })
    }
    if (windows.size > 0) fitted = key
  } finally {
    cdp.terminate()
  }
}

// Injected into Selkies' page: tells the Lor panel who has control and when
// the person in it uses the view (Lor's idle hand-back), and reloads the page
// when this viewer's role changes.
const BRIDGE = `(() => {
  const base = location.pathname.slice(0, location.pathname.lastIndexOf("/") + 1)
  const post = (msg) => parent !== window && parent.postMessage({ source: "lor-browser", ...msg }, "*")
  let role = null
  const listen = () => {
    const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + base + "__lor/events")
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (role && msg.role !== role) return location.reload()
      role = msg.role
      post({ type: "control", role: msg.role, controller: msg.controller })
    }
    ws.onclose = (event) => {
      if (event.code === 4004) return post({ type: "expired" })
      post({ type: "disconnected" })
      setTimeout(listen, 2000)
    }
  }
  listen()
  let last = 0
  const onInput = () => {
    const now = Date.now()
    if (now - last < 1000) return
    last = now
    post({ type: "input" })
  }
  for (const name of ["pointerdown", "keydown", "wheel"]) {
    addEventListener(name, onInput, { capture: true, passive: true })
  }
})()`

function proxyHttp(req, res, grant, path) {
  const role = roleFor(grant.userId)
  const isPage = path === "/" || path === "/index.html"
  const headers = { ...req.headers, authorization: `Bearer ${TOKENS[role]}` }
  delete headers.cookie
  if (isPage) headers["accept-encoding"] = "identity"
  const upstream = request(
    { socketPath: SOCKET, path, method: req.method, headers },
    (up) => {
      if (!isPage || up.statusCode !== 200) {
        res.writeHead(up.statusCode ?? 502, up.headers)
        up.pipe(res)
        return
      }
      const chunks = []
      up.on("data", (chunk) => chunks.push(chunk))
      up.on("end", () => {
        const html = Buffer.concat(chunks)
          .toString("utf8")
          .replace("<head>", '<head><script src="__lor/bridge.js"></script>')
        // Selkies' frame-ancestors `*` covers only http(s) pages, so the
        // desktop app (tauri://localhost) couldn't frame it; the grant in
        // the path is the credential.
        const {
          "content-length": _length,
          "content-security-policy": _csp,
          ...rest
        } = up.headers
        res.writeHead(200, { ...rest, "cache-control": "no-store" })
        res.end(html)
      })
    }
  )
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502)
    res.end()
  })
  req.pipe(upstream)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://gateway")
  if (url.pathname === "/health") return res.writeHead(200).end()
  const match = url.pathname.match(VIEW_PATH)
  const grant = match ? await readGrant(match[1]) : null
  if (!grant) return res.writeHead(404).end()
  if (!match[2]) {
    return res
      .writeHead(302, { location: `${url.pathname}/${url.search}` })
      .end()
  }
  if (match[2] === "/__lor/bridge.js") {
    return res
      .writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-store",
      })
      .end(BRIDGE)
  }
  url.searchParams.delete("token")
  proxyHttp(req, res, grant, `${match[2]}${url.search}`)
})

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 16 * 1024 * 1024,
  handleProtocols: (_offered, req) => req.upstreamProtocol || false,
})

function relay(client, upstream, grant, role) {
  const stream = { ws: client, grant: grant.id, userId: grant.userId, role }
  streams.add(stream)
  upstream.on("message", (data, isBinary) => {
    if (client.readyState !== client.OPEN) return
    client.send(data, { binary: isBinary })
    // A slow viewer must not grow memory without bound.
    if (client.bufferedAmount > MAX_BUFFERED) {
      upstream.pause()
      const resume = setInterval(() => {
        if (client.readyState !== client.OPEN) return clearInterval(resume)
        if (client.bufferedAmount < MAX_BUFFERED / 4) {
          clearInterval(resume)
          upstream.resume()
        }
      }, 50)
    }
  })
  client.on("message", (data, isBinary) => {
    if (upstream.readyState !== upstream.OPEN) return
    if (role === "watch" && !isBinary) {
      const text = data.toString()
      if (CONTROLLER_ONLY.some((prefix) => text.startsWith(prefix))) return
    }
    upstream.send(data, { binary: isBinary })
  })
  const close = (code) => {
    streams.delete(stream)
    if (upstream.readyState === upstream.OPEN) upstream.close()
    if (client.readyState === client.OPEN) {
      client.close(typeof code === "number" && code >= 4000 ? code : 1000)
    }
  }
  upstream.on("close", close)
  upstream.on("error", close)
  client.on("close", close)
  client.on("error", close)
}

server.on("upgrade", async (req, socket, head) => {
  // A client gone mid-upgrade must not throw from the raw socket.
  socket.on("error", () => socket.destroy())
  const url = new URL(req.url ?? "/", "http://gateway")
  const match = url.pathname.match(VIEW_PATH)
  const grant =
    match && streams.size + listeners.size < MAX_CONNECTIONS
      ? await readGrant(match[1])
      : null
  if (!grant || !match[2]) {
    socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n")
    return
  }
  await syncControl()
  if (match[2] === "/__lor/events") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      const listener = { ws, grant: grant.id, userId: grant.userId }
      listeners.add(listener)
      ws.send(controlMessage(grant.userId))
      ws.on("close", () => listeners.delete(listener))
      ws.on("error", () => listeners.delete(listener))
    })
    return
  }
  const role = roleFor(grant.userId)
  url.searchParams.set("token", TOKENS[role])
  const protocols = (req.headers["sec-websocket-protocol"] ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith("selkies.token."))
  if (socket.destroyed) return
  const upstream = new WebSocket(
    `ws+unix://${SOCKET}:${match[2]}${url.search}`,
    protocols
  )
  // The viewer left before Selkies answered: drop the upstream too.
  socket.once("close", () => upstream.terminate())
  upstream.once("open", () => {
    req.upstreamProtocol = upstream.protocol
    wss.handleUpgrade(req, socket, head, (client) =>
      relay(client, upstream, grant, role)
    )
  })
  upstream.once("unexpected-response", (_req, res) => {
    socket.end(`HTTP/1.1 ${res.statusCode ?? 502} Upstream\r\n\r\n`)
  })
  upstream.once("error", () => socket.destroy())
})

// Grants that lapsed or were deleted are refused by readGrant; this tells
// their pages and ends their streams.
setInterval(async () => {
  for (const l of listeners) {
    if (!(await readGrant(l.grant))) l.ws.close(4004, "expired")
  }
  for (const c of streams) {
    if (!(await readGrant(c.grant))) c.ws.close(4004, "expired")
  }
}, 60_000)
setInterval(() => void syncControl().catch(() => {}), 1000)
// A fit still running skips the tick instead of stacking another.
let fitting = false
setInterval(() => {
  if (fitting) return
  fitting = true
  fitWindows()
    .catch(() => {})
    .finally(() => {
      fitting = false
    })
}, 1000)
server.listen(VIEW_PORT, "0.0.0.0", () => {
  console.log(`gateway on ${VIEW_PORT}`)
})
