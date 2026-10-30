import { shellQuote } from "@ai-sdk/harness/utils"
import { env } from "@repo/env/server"
import { WORKSPACE_MOUNT } from "../sandbox/blaxel"
import {
  ensureProcess,
  exposePort,
  listProcesses,
  portReady,
  revokePort,
  stopProcess,
} from "../sandbox/sandbox-ports"
import { attachSessionSandbox } from "../sandbox/session-sandbox"
import { piWorkDir } from "../session-core/work-dir"

// A code session's dev server and its preview URL
// (reference/dev-environment-runbook.md §3). Built on the provider seam
// (sandbox-ports.ts), so it carries over to another sandbox provider.

const PREFIX = "preview-"
const START_WAIT_MS = 45_000
// A fresh clone has no node_modules: the dev server installs first.
const INSTALL_WAIT_MS = 180_000
const INSTALL_IF_MISSING =
  "if [ -f package.json ] && [ ! -d node_modules ]; then if [ -f pnpm-lock.yaml ]; then pnpm install; elif [ -f yarn.lock ]; then yarn install; elif [ -f bun.lock ] || [ -f bun.lockb ]; then bun install; else npm install; fi; fi"

export type DevServerSuggestion = { command: string; port: number }
export type PreviewState = { port: number; url: string; running: boolean }

const processName = (port: number) => `${PREFIX}${port}`
const owner = (sessionId: string) => ({ sessionId })
export const sessionWorkDir = (sessionId: string) =>
  piWorkDir(WORKSPACE_MOUNT, sessionId)

// Private on Lor's own preview domain (the cookie is same-site with the web
// app); public on Blaxel's, where a private preview's cookie would be a
// blocked third-party cookie in the iframe.
const ACCESS = env.LOR_PREVIEW_DOMAIN ? "private" : "public"

// Frameworks' host checks and bindings, set for every dev server: Vite
// refuses unknown Host headers unless allowed; HOST/PORT cover the rest.
function devServerEnv(port: number): Record<string, string> {
  const hosts = [".bl.run", env.LOR_PREVIEW_DOMAIN].filter(Boolean).join(",")
  return {
    HOST: "0.0.0.0",
    PORT: String(port),
    BROWSER: "none",
    __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: hosts,
  }
}

// The repo's dev script and port, read from package.json and its lockfile.
export async function suggestDevServer(
  sessionId: string
): Promise<DevServerSuggestion | null> {
  const sandbox = await attachSessionSandbox(owner(sessionId))
  if (!sandbox) return null
  try {
    const dir = sessionWorkDir(sessionId)
    const read = await sandbox.session.run({
      command: `cd ${shellQuote(dir)} 2>/dev/null && cat package.json 2>/dev/null; echo; echo "::locks::"; ls pnpm-lock.yaml yarn.lock bun.lock bun.lockb 2>/dev/null`,
    })
    const [pkgText = "", locks = ""] = read.stdout.split("::locks::")
    let scripts: Record<string, string> = {}
    try {
      scripts =
        (JSON.parse(pkgText.trim()) as { scripts?: Record<string, string> })
          .scripts ?? {}
    } catch {
      return null
    }
    const script = scripts.dev ? "dev" : scripts.start ? "start" : null
    if (!script) return null
    const body = scripts[script] ?? ""
    const runner = locks.includes("pnpm-lock")
      ? "pnpm"
      : locks.includes("yarn.lock")
        ? "yarn"
        : locks.includes("bun.lock")
          ? "bun run"
          : "npm run"
    const portFlag = body.match(/(?:-p|--port)[ =](\d{2,5})/)?.[1]
    const port = portFlag
      ? Number(portFlag)
      : /\bvite\b/.test(body)
        ? 5173
        : 3000
    // Vite binds to localhost unless told otherwise; the preview reaches
    // the sandbox's network address.
    const hostArgs = /\bvite\b/.test(body)
      ? `${runner === "npm run" ? " --" : ""} --host 0.0.0.0`
      : ""
    return { command: `${runner} ${script}${hostArgs}`, port }
  } finally {
    sandbox.close()
  }
}

export async function listPreviews(sessionId: string): Promise<PreviewState[]> {
  const processes = await listProcesses(owner(sessionId), PREFIX)
  const states: PreviewState[] = []
  for (const proc of processes) {
    const port = Number(proc.name.slice(PREFIX.length))
    if (!Number.isInteger(port) || !proc.running) continue
    const exposed = await exposePort(owner(sessionId), {
      name: proc.name,
      port,
      access: ACCESS,
    })
    if (exposed) states.push({ port, url: browserUrl(exposed), running: true })
  }
  return states
}

function browserUrl(exposed: {
  url: string
  token?: { param: string; value: string }
}) {
  return exposed.token
    ? `${exposed.url}/?${exposed.token.param}=${encodeURIComponent(exposed.token.value)}`
    : exposed.url
}

export type StartPreview =
  | { status: "ready"; preview: PreviewState }
  | { status: "no_sandbox" }
  | { status: "not_listening"; port: number }

// Starts the dev server unless it runs, waits for its port, then exposes it.
export async function startPreview(
  sessionId: string,
  input: { command: string; port: number }
): Promise<StartPreview> {
  const name = processName(input.port)
  const started = await ensureProcess(owner(sessionId), {
    name,
    command: `${INSTALL_IF_MISSING}; ${input.command}`,
    cwd: sessionWorkDir(sessionId),
    env: devServerEnv(input.port),
  })
  if (!started) return { status: "no_sandbox" }
  const wait = started === "started" ? INSTALL_WAIT_MS : START_WAIT_MS
  if (!(await portReady(owner(sessionId), input.port, wait))) {
    return { status: "not_listening", port: input.port }
  }
  const exposed = await exposePort(owner(sessionId), {
    name,
    port: input.port,
    access: ACCESS,
  })
  if (!exposed) return { status: "no_sandbox" }
  return {
    status: "ready",
    preview: { port: input.port, url: browserUrl(exposed), running: true },
  }
}

export async function stopPreview(sessionId: string, port: number) {
  const name = processName(port)
  await revokePort(owner(sessionId), name)
  await stopProcess(owner(sessionId), name)
}
