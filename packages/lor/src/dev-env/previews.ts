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

// Listening TCP ports from /proc/net/tcp*, each with whether it binds only to
// loopback and the name of the process that owns it. The image has no ss,
// netstat or lsof.
const LIST_PORTS = `
const fs = require("fs")
const hidden = new Set(process.argv.slice(1).map(Number))
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
  if (cmdline.includes("${RELAY_MARKER}")) continue
  let exe = ""
  if (pid) { try { exe = fs.readlinkSync("/proc/" + pid + "/exe") } catch {} }
  if (${JSON.stringify(HIDDEN_PROCESSES)}.includes(name) || ${JSON.stringify(HIDDEN_PROCESS_PREFIXES)}.some((p) => (name ?? "").startsWith(p)) || ${HIDDEN_EXE}.test(exe)) continue
  out.push({ port: entry.port, loopbackOnly: entry.loopbackOnly, process: name })
}
out.sort((a, b) => a.port - b.port)
console.log(JSON.stringify(out))
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

const server = http.createServer((req, res) => {
  upstreamHost((host) => {
    if (!host) {
      res.writeHead(502)
      return res.end()
    }
    const upstream = http.request({ host, port: target, method: req.method, path: req.url, headers: rewrite(req.headers) }, (reply) => {
      res.writeHead(reply.statusCode || 502, reply.statusMessage, reply.rawHeaders)
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

const proxyPort = (port: number) => 50000 + (port % 10000)

export async function readListeningPorts(
  session: SandboxSession
): Promise<(OpenPort & { loopbackOnly: boolean })[]> {
  const result = await session.run({
    command: `node -e ${shellQuote(LIST_PORTS)} ${HIDDEN_PORTS.join(" ")}`,
  })
  if (result.exitCode !== 0) return []
  return JSON.parse(result.stdout.trim() || "[]")
}

async function scanPorts(
  sessionId: string
): Promise<(OpenPort & { loopbackOnly: boolean })[] | null> {
  const sandbox = await attachSessionSandbox(owner(sessionId))
  if (!sandbox) return null
  try {
    return await readListeningPorts(sandbox.session)
  } finally {
    sandbox.close()
  }
}

// Null: the session has no sandbox.
export async function listOpenPorts(
  sessionId: string
): Promise<OpenPort[] | null> {
  const ports = await scanPorts(sessionId)
  return ports?.map(({ port, process }) => ({ port, process })) ?? null
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
  const found = ports.find((p) => p.port === port)
  if (!found) return { status: "not_listening" }

  const proxy = proxyPort(port)
  const exposed = await exposePort(owner(sessionId), {
    name: `port-${port}-proxy`,
    port: proxy,
    access: ACCESS,
  })
  if (!exposed) return { status: "no_sandbox" }
  const previewHost = new URL(exposed.url).host
  const started = await ensureProcess(owner(sessionId), {
    name: `proxy-${port}`,
    command: `node -e ${shellQuote(PROXY)} ${proxy} ${port} ${shellQuote(previewHost)} ${RELAY_MARKER}`,
  })
  if (!started) return { status: "no_sandbox" }
  if (!(await portReady(owner(sessionId), proxy, 10_000))) {
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
