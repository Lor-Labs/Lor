import { shellQuote } from "@ai-sdk/harness/utils"
import { env } from "@repo/env/server"
import type { Experimental_SandboxSession as SandboxSession } from "ai"
import { logger } from "../logger"
import { ensureProcess, exposePort, portReady } from "../sandbox/sandbox-ports"
import { attachSessionSandbox } from "../sandbox/session-sandbox"
import { BROWSER_PORTS } from "./browser"
import { TERMINAL_PORT } from "./terminal"

// A code session's Browser tab (reference/dev-environment-runbook.md §3):
// whatever listens in the sandbox, whoever started it, shown at
// `localhost:<port>`. A preview URL serves it through a small proxy in the
// sandbox: previews reach only servers bound to all addresses (spike
// 2026-10-29: 127.0.0.1 and ::1 answered 502), and dev servers' cross-site
// guards reject the preview origin (LOR-133). Built on the provider seam.

export type OpenPort = { port: number; process: string | null }

const owner = (sessionId: string) => ({ sessionId })
const RELAY_MARKER = "lor-relay"
// On a preview proxy's command line with its app's port, so a later open
// finds and reuses it.
const PROXY_FOR = "lor-proxy-for"
// Blaxel's sandbox API, the harness bridge, the terminal and the session
// browser.
export const HIDDEN_PORTS = [8080, 8790, TERMINAL_PORT, ...BROWSER_PORTS]
// The provider's own services: Blaxel's sandbox API (also on 49152, which
// kept the port list from ever being empty), and on a Boat VM its system
// daemons and desktop streamer (sunshine); and agent-browser's daemon behind
// lor-browser. Boat's own services (agent server, moonlight-web's
// "web-server") are known by where they run from, not a name a dev server
// could share.
const HIDDEN_PROCESSES = [
  "sandbox-api",
  "sshd",
  "systemd-resolve",
  "cupsd",
  "epmd",
  "sunshine",
]
const HIDDEN_PROCESS_PREFIXES = ["agent-browser"]
const HIDDEN_EXE = /^\/(opt|var\/lib)\/ascii-/

// Private on Lor's own preview domain (the cookie is same-site with the web
// app); public on Blaxel's, where a private preview's cookie would be a
// blocked third-party cookie in the iframe.
const ACCESS = env.LOR_PREVIEW_DOMAIN ? "private" : "public"
if (ACCESS === "public" && env.BL_API_KEY) {
  logger.warn(
    "LOR_PREVIEW_DOMAIN is unset: Browser tab previews are public, so anyone with a preview URL can open it"
  )
}

// Defines `listeners(hidden)` for a `node -e` script: listening TCP ports from
// /proc/net/tcp*, each with whether it binds only to loopback, the pid and
// name of the process that owns it, whether it is Lor's or the provider's own
// (hidden) and, for a preview proxy, its app's port. The image has no ss,
// netstat or lsof.
// `orphan`: no process owns it. Blaxel adds its own IPv6 listener beside a
// server bound to 0.0.0.0 and keeps it after the server stops (measured
// 2026-11-11), so the port reads as listening with nothing behind it, and a
// later server binding `::` gets EADDRINUSE. Never count those as running.
export const LISTENERS_JS = `
const fs = require("fs")
function listeners(hidden) {
  const ports = new Map()
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let text = ""
    try { text = fs.readFileSync(file, "utf8") } catch { continue }
    for (const line of text.trim().split("\\n").slice(1)) {
      const cols = line.trim().split(/\\s+/)
      if (cols[3] !== "0A") continue
      const [addr, hex] = cols[1].split(":")
      const port = parseInt(hex, 16)
      if (hidden.has(port)) continue
      const loopback = /0100007F$/i.test(addr) || /^0{24}01000000$/i.test(addr)
      const entry = ports.get(port) ?? { port, loopbackOnly: true, inodes: [] }
      if (!loopback) entry.loopbackOnly = false
      entry.inodes.push(cols[9])
      ports.set(port, entry)
    }
  }
  const owners = new Map()
  for (const pid of fs.readdirSync("/proc").filter((d) => /^\\d+$/.test(d))) {
    let fds = []
    try { fds = fs.readdirSync("/proc/" + pid + "/fd") } catch { continue }
    for (const fd of fds) {
      let link = ""
      try { link = fs.readlinkSync("/proc/" + pid + "/fd/" + fd) } catch { continue }
      const m = link.match(/^socket:\\[(\\d+)\\]$/)
      if (m) owners.set(m[1], pid)
    }
  }
  const out = []
  for (const entry of ports.values()) {
    const pid = entry.inodes.map((i) => owners.get(i)).find(Boolean)
    let name = null
    let cmdline = ""
    if (pid) {
      try { name = fs.readFileSync("/proc/" + pid + "/comm", "utf8").trim() } catch {}
      try { cmdline = fs.readFileSync("/proc/" + pid + "/cmdline", "utf8") } catch {}
    }
    let exe = ""
    if (pid) { try { exe = fs.readlinkSync("/proc/" + pid + "/exe") } catch {} }
    const internal = cmdline.includes("${RELAY_MARKER}") || ${JSON.stringify(HIDDEN_PROCESSES)}.includes(name) || ${JSON.stringify(HIDDEN_PROCESS_PREFIXES)}.some((p) => (name ?? "").startsWith(p)) || ${HIDDEN_EXE}.test(exe)
    const proxyFor = cmdline.match(/${PROXY_FOR}=(\\d+)/)
    out.push({ port: entry.port, loopbackOnly: entry.loopbackOnly, process: name, pid: pid ? Number(pid) : null, orphan: !pid, hidden: internal, ...(proxyFor ? { proxyFor: Number(proxyFor[1]) } : {}) })
  }
  out.sort((a, b) => a.port - b.port)
  return out
}
`

const LIST_PORTS = `${LISTENERS_JS}
console.log(JSON.stringify(listeners(new Set(process.argv.slice(1).map(Number)))))
`

// Serves a port on all addresses, connecting to the server over IPv4 then IPv6
// loopback. Same-origin requests from the preview host get
// `Origin: http://localhost:<port>`: Next 16 refuses its HMR socket and other
// /_next dev resources from an origin missing from `allowedDevOrigins` (its
// bare "Unauthorized" on the socket reaches the browser as a 502), so the page
// never hydrates in "Open in your browser". Auth origin checks against a
// localhost base URL pass the same way. Other origins pass through untouched.
const PROXY = `
const http = require("http")
const net = require("net")
const listen = Number(process.argv[1])
const target = Number(process.argv[2])
const previewHost = (process.argv[3] || "").toLowerCase()
const local = "http://localhost:" + target

// The loopback address the server answers on, found again after a refusal
// (a restart can bind the other family).
let found = null
const upstreamHost = (done) => {
  if (found) return done(found)
  const attempt = (list) => {
    const probe = net.connect({ host: list[0], port: target })
    probe.once("connect", () => {
      probe.destroy()
      found = list[0]
      done(found)
    })
    probe.once("error", () => (list.length > 1 ? attempt(list.slice(1)) : done(null)))
  }
  attempt(["127.0.0.1", "::1"])
}
const forget = (err) => {
  if (err && err.code === "ECONNREFUSED") found = null
}

const ownOrigin = (origin, headers) => {
  let host = ""
  try { host = new URL(origin).host.toLowerCase() } catch { return false }
  const seen = [previewHost, headers.host, headers["x-forwarded-host"]]
    .map((value) => String(value || "").split(",")[0].trim().toLowerCase())
  return seen.includes(host)
}
const rewrite = (headers) => {
  const out = { ...headers }
  if (out.origin && ownOrigin(out.origin, headers)) out.origin = local
  return out
}

// Hop-by-hop headers stay on their own connection (LOR-157): the dev server's
// keep-alive and chunked framing, passed to an HTTP/1.0 or Connection: close
// client, leaves a page that never finishes loading. Node frames each side.
const HOP = ["connection", "keep-alive", "proxy-connection", "transfer-encoding", "te", "trailer", "upgrade", "proxy-authenticate", "proxy-authorization"]
const hopHeaders = (connection) =>
  new Set([...HOP, ...String(connection || "").toLowerCase().split(",").map((name) => name.trim())])
const requestHeaders = (headers) => {
  const out = rewrite(headers)
  for (const name of hopHeaders(headers.connection)) delete out[name]
  return out
}
const replyHeaders = (reply) => {
  const drop = hopHeaders(reply.headers.connection)
  const out = []
  for (let i = 0; i < reply.rawHeaders.length; i += 2) {
    if (!drop.has(reply.rawHeaders[i].toLowerCase())) out.push(reply.rawHeaders[i], reply.rawHeaders[i + 1])
  }
  return out
}
// Not the global agent: NODE_USE_ENV_PROXY sends that through the sandbox's
// egress proxy unless NO_PROXY lists loopback.
const agent = new http.Agent({ keepAlive: true })

const server = http.createServer((req, res) => {
  // openPort's readiness check: this proxy, for this target, is listening.
  if (req.headers["x-lor-proxy-check"] !== undefined) {
    res.writeHead(204, { "x-lor-proxy": String(target) })
    return res.end()
  }
  upstreamHost((host) => {
    if (!host) {
      res.writeHead(502)
      return res.end()
    }
    const upstream = http.request({ host, port: target, method: req.method, path: req.url, headers: requestHeaders(req.headers), agent }, (reply) => {
      res.writeHead(reply.statusCode || 502, reply.statusMessage, replyHeaders(reply))
      reply.pipe(res)
      // A cut-off reply must not look complete to the browser.
      reply.on("error", () => res.destroy())
      reply.on("close", () => {
        if (!reply.complete) res.destroy()
      })
    })
    upstream.on("error", (err) => {
      forget(err)
      if (res.headersSent) return res.destroy()
      res.writeHead(502)
      res.end()
    })
    res.on("close", () => upstream.destroy())
    req.pipe(upstream)
  })
})
server.requestTimeout = 0

// WebSockets (hot reload): the handshake goes upstream with the rewritten
// Origin, then raw bytes both ways.
server.on("upgrade", (req, socket, head) => {
  const lines = [req.method + " " + req.url + " HTTP/" + req.httpVersion]
  for (const [name, value] of Object.entries(rewrite(req.headers))) {
    for (const one of Array.isArray(value) ? value : [value]) lines.push(name + ": " + one)
  }
  socket.on("error", () => socket.destroy())
  upstreamHost((host) => {
    if (!host || socket.destroyed) return socket.destroy()
    const upstream = net.connect({ host, port: target })
    upstream.once("connect", () => {
      upstream.write(lines.join("\\r\\n") + "\\r\\n\\r\\n")
      if (head.length) upstream.write(head)
      socket.pipe(upstream)
      upstream.pipe(socket)
    })
    upstream.on("error", (err) => {
      forget(err)
      socket.destroy()
    })
    socket.on("close", () => upstream.destroy())
    upstream.on("close", () => socket.destroy())
  })
})
server.listen(listen, "0.0.0.0")
`

// A free port in 10000-29999, from 20000 + port % 10000 on: below Linux's
// ephemeral range (32768+) and Blaxel's own services (49152+), never another
// listener's (an app on 23000 beside one on 3000).
function freeProxyPort(port: number, taken: Set<number>): number | null {
  for (let i = 0; i < 20000; i++) {
    const candidate = 10000 + ((10000 + (port % 10000) + i) % 20000)
    if (!taken.has(candidate)) return candidate
  }
  return null
}

// Only this port's proxy answers, not whatever else holds the proxy port.
const proxyCheck = (proxy: number, port: number) =>
  `curl -s -o /dev/null -D - --max-time 1 -H "x-lor-proxy-check: 1" http://127.0.0.1:${proxy}/ | tr -d "\\r" | grep -qix "x-lor-proxy: ${port}"`

type Listener = OpenPort & {
  loopbackOnly: boolean
  hidden: boolean
  orphan: boolean
  proxyFor?: number
}

async function readListeners(session: SandboxSession): Promise<Listener[]> {
  const result = await session.run({
    command: `node -e ${shellQuote(LIST_PORTS)} ${HIDDEN_PORTS.join(" ")}`,
  })
  if (result.exitCode !== 0) return []
  return JSON.parse(result.stdout.trim() || "[]")
}

async function scanPorts(sessionId: string): Promise<Listener[] | null> {
  const sandbox = await attachSessionSandbox(owner(sessionId))
  if (!sandbox) return null
  try {
    return await readListeners(sandbox.session)
  } finally {
    sandbox.close()
  }
}

// Null: the session has no sandbox.
export async function listOpenPorts(
  sessionId: string
): Promise<OpenPort[] | null> {
  const ports = await scanPorts(sessionId)
  return (
    ports
      ?.filter((p) => !p.hidden && !p.orphan)
      .map(({ port, process }) => ({ port, process })) ?? null
  )
}

// `query`: a private preview's token, appended after the page's own path.
export type OpenPortResult =
  | { status: "ready"; url: string; query: string }
  | { status: "no_sandbox" }
  | { status: "not_listening" }

export async function openPort(
  sessionId: string,
  port: number
): Promise<OpenPortResult> {
  const ports = await scanPorts(sessionId)
  if (!ports) return { status: "no_sandbox" }
  if (!ports.some((p) => p.port === port && !p.hidden && !p.orphan)) {
    return { status: "not_listening" }
  }

  // The proxy port names its preview and process, so each preview keeps
  // pointing at its own proxy.
  const proxy =
    ports.find((p) => p.proxyFor === port)?.port ??
    freeProxyPort(port, new Set([...HIDDEN_PORTS, ...ports.map((p) => p.port)]))
  if (proxy === null) return { status: "not_listening" }
  const exposed = await exposePort(owner(sessionId), {
    name: `port-${port}-via-${proxy}`,
    port: proxy,
    access: ACCESS,
  })
  if (!exposed) return { status: "no_sandbox" }
  const previewHost = new URL(exposed.url).host
  const started = await ensureProcess(owner(sessionId), {
    name: `proxy-${port}-${proxy}`,
    command: `node -e ${shellQuote(PROXY)} ${proxy} ${port} ${shellQuote(previewHost)} ${RELAY_MARKER} ${PROXY_FOR}=${port}`,
  })
  if (!started) return { status: "no_sandbox" }
  // The proxy answers itself: a plain HTTP check would wait on the app.
  if (
    !(await portReady(owner(sessionId), proxy, 10_000, proxyCheck(proxy, port)))
  ) {
    return { status: "not_listening" }
  }
  return {
    status: "ready",
    url: exposed.url.replace(/\/$/, ""),
    query: exposed.token
      ? `${exposed.token.param}=${encodeURIComponent(exposed.token.value)}`
      : "",
  }
}
