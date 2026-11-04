// The session browser's live-view gateway (reference/planned/sandbox-browser-runbook.md
// §4), the only browser port meant for a preview. Each viewer connects with a
// one-time token the API wrote into the browser folder. The person in
// control is relayed to the x11vnc that takes input, everyone else to the
// -viewonly one, so watching is enforced by x11vnc, not by the client. When
// control changes, connections whose role changed are closed and their
// clients reconnect with a new token. Control goes back to Lor after the
// controller has had no connection for a while.
import { createReadStream } from "node:fs"
import { readFile, stat, unlink } from "node:fs/promises"
import { createServer } from "node:http"
import net from "node:net"
import path from "node:path"
import { WebSocketServer } from "ws"

const DIR = process.env.LOR_BROWSER_DIR ?? "/workspace/.cache/lor-browser"
const VIEW_PORT = Number(process.env.LOR_BROWSER_VIEW_PORT ?? 6080)
const CONTROL_VNC_PORT = Number(process.env.LOR_BROWSER_VNC_PORT ?? 5900)
const WATCH_VNC_PORT = Number(process.env.LOR_BROWSER_WATCH_PORT ?? 5901)
const TOKEN_TTL_MS = 2 * 60_000
const RELEASE_AFTER_MS = 2 * 60_000
const MAX_CONNECTIONS = 20
const MAX_BUFFERED = 4 * 1024 * 1024
// Close code the client reads as "reconnect with a new token".
const ROLE_CHANGED = 4001

const TOKEN = /^[a-f0-9]{32,64}$/

const connections = new Set()
let controllerId = ""
let controllerSeenAt = Date.now()

async function readText(file) {
  try {
    return (await readFile(`${DIR}/${file}`, "utf8")).trim()
  } catch {
    return ""
  }
}

// One-time: the token's file goes on first use.
async function takeViewer(token) {
  if (!TOKEN.test(token)) return null
  const file = `${DIR}/viewers/${token}`
  let viewer
  try {
    viewer = JSON.parse(await readFile(file, "utf8"))
  } catch {
    return null
  }
  await unlink(file).catch(() => {})
  if (typeof viewer?.userId !== "string" || typeof viewer?.at !== "number") {
    return null
  }
  if (Date.now() - viewer.at > TOKEN_TTL_MS) return null
  return viewer
}

const roleFor = (userId) =>
  controllerId && userId === controllerId ? "control" : "watch"

function relay(ws, userId, role) {
  const vnc = net.connect({
    host: "127.0.0.1",
    port: role === "control" ? CONTROL_VNC_PORT : WATCH_VNC_PORT,
  })
  const connection = { ws, userId, role }
  connections.add(connection)
  vnc.on("data", (chunk) => {
    if (ws.readyState !== ws.OPEN) return
    ws.send(chunk)
    // A slow viewer must not grow memory without bound.
    if (ws.bufferedAmount > MAX_BUFFERED) {
      vnc.pause()
      const resume = setInterval(() => {
        if (ws.readyState !== ws.OPEN) return clearInterval(resume)
        if (ws.bufferedAmount < MAX_BUFFERED / 4) {
          clearInterval(resume)
          vnc.resume()
        }
      }, 50)
    }
  })
  ws.on("message", (data) => vnc.write(data))
  const close = () => {
    connections.delete(connection)
    vnc.destroy()
    if (ws.readyState === ws.OPEN) ws.close()
  }
  vnc.on("error", close)
  vnc.on("close", close)
  ws.on("close", close)
  ws.on("error", close)
}

async function syncControl() {
  const next = await readText("controller-id")
  if (next !== controllerId) {
    controllerId = next
    controllerSeenAt = Date.now()
    for (const connection of connections) {
      if (roleFor(connection.userId) !== connection.role) {
        connection.ws.close(ROLE_CHANGED, "role changed")
      }
    }
  }
  if (!controllerId) return
  const connected = [...connections].some(
    (c) => c.role === "control" && c.userId === controllerId
  )
  if (connected) {
    controllerSeenAt = Date.now()
  } else if (Date.now() - controllerSeenAt > RELEASE_AFTER_MS) {
    // The controller left without handing back: Lor may drive again, and
    // every viewer reconnects to learn it.
    await unlink(`${DIR}/controller-id`).catch(() => {})
    await unlink(`${DIR}/controller`).catch(() => {})
    controllerId = ""
    for (const connection of connections) {
      connection.ws.close(ROLE_CHANGED, "control released")
    }
  }
}

// noVNC's own page (vnc.html) for the phone, which opens the view in an
// in-app browser. Read-only files from the image's noVNC package.
const NOVNC = "/usr/share/novnc"
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
}

async function serveNoVnc(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.writeHead(405).end()
  }
  let file
  try {
    const { pathname } = new URL(req.url ?? "/", "http://gateway")
    file = path.normalize(path.join(NOVNC, decodeURIComponent(pathname)))
  } catch {
    return res.writeHead(400).end()
  }
  if (!file.startsWith(`${NOVNC}/`)) return res.writeHead(404).end()
  const info = await stat(file).catch(() => null)
  if (!info?.isFile()) return res.writeHead(404).end()
  res.writeHead(200, {
    "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
    "content-length": info.size,
  })
  if (req.method === "HEAD") return res.end()
  createReadStream(file).pipe(res)
}

const server = createServer((req, res) => {
  if (req.url === "/health") return res.writeHead(200).end()
  void serveNoVnc(req, res)
})
const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 1024 * 1024,
  handleProtocols: (protocols) => (protocols.has("binary") ? "binary" : false),
})

server.on("upgrade", async (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://gateway")
  const viewer =
    url.pathname === "/vnc" && connections.size < MAX_CONNECTIONS
      ? await takeViewer(url.searchParams.get("token") ?? "")
      : null
  if (!viewer) {
    socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n")
    return
  }
  await syncControl()
  wss.handleUpgrade(req, socket, head, (ws) => {
    relay(ws, viewer.userId, roleFor(viewer.userId))
  })
})

setInterval(() => void syncControl(), 1000)
server.listen(VIEW_PORT, "0.0.0.0", () => {
  console.log(`gateway on ${VIEW_PORT}`)
})
