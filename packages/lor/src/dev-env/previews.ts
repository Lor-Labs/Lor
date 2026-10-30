import { shellQuote } from "@ai-sdk/harness/utils"
import { env } from "@repo/env/server"
import { logger } from "../logger"
import { ensureProcess, exposePort, portReady } from "../sandbox/sandbox-ports"
import { attachSessionSandbox } from "../sandbox/session-sandbox"
import { TERMINAL_PORT } from "./terminal"

// A code session's Browser tab (reference/dev-environment-runbook.md §3):
// whatever listens in the sandbox, whoever started it, shown at
// `localhost:<port>`. A preview URL serves it; previews reach only servers
// bound to all addresses (spike 2026-10-29: 127.0.0.1 and ::1 answered 502),
// so a localhost-only server gets a TCP relay. Built on the provider seam.

export type OpenPort = { port: number; process: string | null }

const owner = (sessionId: string) => ({ sessionId })
const RELAY_MARKER = "lor-relay"
// Blaxel's sandbox API and the harness bridge.
const HIDDEN_PORTS = [8080, 8790, TERMINAL_PORT]

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
  out.push({ port: entry.port, loopbackOnly: entry.loopbackOnly, process: name })
}
out.sort((a, b) => a.port - b.port)
console.log(JSON.stringify(out))
`

// Forwards a port on all addresses to a localhost-only server, trying IPv4
// then IPv6 loopback per connection. Raw TCP: HTTP, WebSockets, hot reload.
const RELAY = `
const net = require("net")
const listen = Number(process.argv[1])
const target = Number(process.argv[2])
net.createServer((client) => {
  client.pause()
  const connect = (hosts) => {
    const upstream = net.connect({ port: target, host: hosts[0] })
    upstream.once("connect", () => {
      client.pipe(upstream)
      upstream.pipe(client)
      client.resume()
    })
    upstream.once("error", () => {
      if (hosts.length > 1) connect(hosts.slice(1))
      else client.destroy()
    })
    client.on("error", () => upstream.destroy())
    client.on("close", () => upstream.destroy())
  }
  connect(["127.0.0.1", "::1"])
}).listen(listen, "0.0.0.0")
`

const relayPort = (port: number) => 40000 + (port % 10000)

async function scanPorts(
  sessionId: string
): Promise<(OpenPort & { loopbackOnly: boolean })[] | null> {
  const sandbox = await attachSessionSandbox(owner(sessionId))
  if (!sandbox) return null
  try {
    const result = await sandbox.session.run({
      command: `node -e ${shellQuote(LIST_PORTS)} ${HIDDEN_PORTS.join(" ")}`,
    })
    if (result.exitCode !== 0) return []
    return JSON.parse(result.stdout.trim() || "[]")
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

  let target = port
  if (found.loopbackOnly) {
    target = relayPort(port)
    const relay = await ensureProcess(owner(sessionId), {
      name: `relay-${port}`,
      command: `node -e ${shellQuote(RELAY)} ${target} ${port} ${RELAY_MARKER}`,
    })
    if (!relay) return { status: "no_sandbox" }
    if (!(await portReady(owner(sessionId), target, 10_000))) {
      return { status: "not_listening" }
    }
  }
  const exposed = await exposePort(owner(sessionId), {
    name: found.loopbackOnly ? `port-${port}-relay` : `port-${port}`,
    port: target,
    access: ACCESS,
  })
  if (!exposed) return { status: "no_sandbox" }
  return {
    status: "ready",
    url: exposed.url.replace(/\/$/, ""),
    query: exposed.token
      ? `${exposed.token.param}=${encodeURIComponent(exposed.token.value)}`
      : "",
  }
}
