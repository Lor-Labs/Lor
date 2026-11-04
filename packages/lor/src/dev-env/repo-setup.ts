import { posix } from "node:path"
import { shellQuote } from "@ai-sdk/harness/utils"
import type { Experimental_SandboxSession as SandboxSession } from "ai"
import { z } from "zod"
import { WORKSPACE_MOUNT } from "../sandbox/blaxel"
import { ensureProcess } from "../sandbox/sandbox-ports"
import { attachSessionSandbox } from "../sandbox/session-sandbox"
import { isSafeEnvFilePath } from "./environments"
import { HIDDEN_PORTS, readListeningPorts } from "./previews"
import { REPO_SETUP_FILE, sessionWorkDir } from "./work-dir"

// A repo's run setup, `.lor/environment.json`, committed with the repo: how to
// install it and which dev servers to start ("the app": every service not
// marked `default: false`). Lor writes it the first time
// someone asks it to run the app; after that the Browser tab's Start buttons
// run it without a turn, in any language. Each service is a named process
// that outlives turns; its pid and log are files, so this is provider-neutral.

const MAX_BYTES = 64 * 1024
const LOG_DIR = `${WORKSPACE_MOUNT}/tmp/lor-services`
const LOG_TAIL_BYTES = 4000
const NOT_A_CLONE = 3
const MISSING = 4

const serviceSchema = z.object({
  name: z
    .string()
    .regex(
      /^[a-z0-9][a-z0-9-]{0,39}$/,
      "use a short lowercase name of letters, digits and dashes"
    ),
  command: z.string().trim().min(1).max(2000),
  port: z
    .number()
    .int()
    .min(1)
    .max(65535)
    .refine(
      (port) => !HIDDEN_PORTS.includes(port),
      "the sandbox uses this port"
    ),
  cwd: z
    .string()
    .refine(isSafeEnvFilePath, "use a folder relative to the repository root")
    .optional(),
  // false: not part of "the app" (a monorepo's docs site, a rarely used
  // tool). Start app and Lor skip it unless asked; it keeps its own Start.
  default: z.boolean().optional(),
})

const setupSchema = z
  .object({
    install: z.string().trim().min(1).max(2000).optional(),
    services: z.array(serviceSchema).max(10).default([]),
  })
  .superRefine((setup, ctx) => {
    const names = new Set<string>()
    const ports = new Set<number>()
    setup.services.forEach((service, i) => {
      if (names.has(service.name)) {
        ctx.addIssue({
          code: "custom",
          path: ["services", i, "name"],
          message: "another service has this name",
        })
      }
      if (ports.has(service.port)) {
        ctx.addIssue({
          code: "custom",
          path: ["services", i, "port"],
          message: "another service uses this port",
        })
      }
      names.add(service.name)
      ports.add(service.port)
    })
  })

type RepoSetup = z.infer<typeof setupSchema>
type RepoService = RepoSetup["services"][number]

type ParsedSetup =
  | { status: "missing" }
  | { status: "invalid"; error: string }
  | { status: "ready"; setup: RepoSetup }

function parseRepoSetup(text: string): ParsedSetup {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { status: "invalid", error: "it is not valid JSON" }
  }
  const parsed = setupSchema.safeParse(json)
  if (!parsed.success) {
    const error = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "file"}: ${issue.message}`)
      .join("; ")
    return { status: "invalid", error }
  }
  return { status: "ready", setup: parsed.data }
}

// Null: the repo is not cloned in this sandbox yet.
async function readRepoSetup(
  session: SandboxSession,
  workDir: string
): Promise<ParsedSetup | null> {
  const q = shellQuote
  const result = await session.run({
    command: [
      `[ -d ${q(posix.join(workDir, ".git"))} ] || exit ${NOT_A_CLONE}`,
      `f=${q(posix.join(workDir, REPO_SETUP_FILE))}`,
      `[ -f "$f" ] || exit ${MISSING}`,
      `head -c ${MAX_BYTES} "$f"`,
    ].join("\n"),
  })
  if (result.exitCode === NOT_A_CLONE) return null
  if (result.exitCode === MISSING) return { status: "missing" }
  if (result.exitCode !== 0) {
    throw new Error(`Couldn't read ${REPO_SETUP_FILE}: ${result.stderr}`)
  }
  return parseRepoSetup(result.stdout)
}

const serviceLog = (name: string) => `${LOG_DIR}/${name}.log`

// Whether each service's process is alive (its pid file) and the end of its
// log, as JSON.
const SERVICE_PROCESSES = `
const fs = require("fs")
const [dir, ...names] = process.argv.slice(1)
const out = {}
for (const name of names) {
  const log = dir + "/" + name + ".log"
  let alive = false
  try {
    const pid = Number(fs.readFileSync(log + ".pid", "utf8"))
    if (pid > 0) {
      process.kill(pid, 0)
      alive = true
    }
  } catch {}
  let tail = null
  try {
    const fd = fs.openSync(log, "r")
    const size = fs.fstatSync(fd).size
    const length = Math.min(size, ${LOG_TAIL_BYTES})
    const buf = Buffer.alloc(length)
    fs.readSync(fd, buf, 0, length, size - length)
    fs.closeSync(fd)
    tail = buf.toString("utf8")
  } catch {}
  out[name] = { alive, tail }
}
console.log(JSON.stringify(out))
`

async function readServiceProcesses(
  session: SandboxSession,
  names: string[]
): Promise<Record<string, { alive: boolean; tail: string | null }>> {
  if (names.length === 0) return {}
  const result = await session.run({
    command: `node -e ${shellQuote(SERVICE_PROCESSES)} ${shellQuote(LOG_DIR)} ${names.join(" ")}`,
  })
  if (result.exitCode !== 0) return {}
  return JSON.parse(result.stdout.trim() || "{}")
}

// running: something listens on its port, whoever started it. starting: its
// process is alive (installing, or not listening yet). exited: its process
// ended; the log says why.
export type ServiceState = "stopped" | "starting" | "running" | "exited"

export type RepoSetupStatus =
  | { status: "no_sandbox" }
  | { status: "missing" }
  | { status: "invalid"; error: string }
  | {
      status: "ready"
      install: string | null
      services: {
        name: string
        command: string
        port: number
        cwd: string | null
        default: boolean
        state: ServiceState
        log: string | null
      }[]
    }

export async function repoSetupStatus(
  sessionId: string
): Promise<RepoSetupStatus> {
  const sandbox = await attachSessionSandbox({ sessionId })
  if (!sandbox) return { status: "no_sandbox" }
  try {
    const parsed = await readRepoSetup(
      sandbox.session,
      sessionWorkDir(sessionId)
    )
    if (!parsed) return { status: "no_sandbox" }
    if (parsed.status !== "ready") return parsed
    const { services } = parsed.setup
    const listening = new Set(
      (await readListeningPorts(sandbox.session)).map((p) => p.port)
    )
    const processes = await readServiceProcesses(
      sandbox.session,
      services.map((service) => service.name)
    )
    return {
      status: "ready",
      install: parsed.setup.install ?? null,
      services: services.map((service) => {
        const proc = processes[service.name]
        const state: ServiceState = listening.has(service.port)
          ? "running"
          : proc?.alive
            ? "starting"
            : proc?.tail != null
              ? "exited"
              : "stopped"
        return {
          name: service.name,
          command: service.command,
          port: service.port,
          cwd: service.cwd ?? null,
          default: service.default !== false,
          state,
          log: state === "running" ? null : (proc?.tail ?? null),
        }
      }),
    }
  } finally {
    sandbox.close()
  }
}

// Install runs on every start (installs are quick when nothing changed, and
// the repo may have new dependencies), one at a time across services.
function serviceCommand(
  workDir: string,
  install: string | null,
  service: RepoService
): string {
  const q = shellQuote
  const log = serviceLog(service.name)
  return [
    `mkdir -p ${q(LOG_DIR)}`,
    `echo $$ > ${q(`${log}.pid`)}`,
    `exec > ${q(log)} 2>&1`,
    `cd ${q(workDir)} || exit 1`,
    ...(install
      ? [
          `printf '$ %s\\n' ${q(install)}`,
          // -o: a daemon the install leaves running doesn't keep the lock.
          `flock -o ${q(`${LOG_DIR}/install.lock`)} bash -c ${q(install)} || { echo "Install failed (exit $?)"; exit 1; }`,
        ]
      : []),
    ...(service.cwd ? [`cd ${q(service.cwd)} || exit 1`] : []),
    `printf '$ %s\\n' ${q(service.command)}`,
    `exec bash -c ${q(service.command)}`,
  ].join("\n")
}

export type StartServiceResult =
  | { status: "started" | "running" }
  | { status: "no_sandbox" }
  | { status: "missing" }
  | { status: "invalid"; error: string }
  | { status: "unknown_service" }

export async function startService(
  sessionId: string,
  name: string
): Promise<StartServiceResult> {
  const workDir = sessionWorkDir(sessionId)
  const sandbox = await attachSessionSandbox({ sessionId })
  if (!sandbox) return { status: "no_sandbox" }
  let parsed: ParsedSetup | null
  try {
    parsed = await readRepoSetup(sandbox.session, workDir)
  } finally {
    sandbox.close()
  }
  if (!parsed) return { status: "no_sandbox" }
  if (parsed.status !== "ready") return parsed
  const service = parsed.setup.services.find((s) => s.name === name)
  if (!service) return { status: "unknown_service" }
  const started = await ensureProcess(
    { sessionId },
    {
      name: `service-${service.name}`,
      command: serviceCommand(workDir, parsed.setup.install ?? null, service),
      cwd: workDir,
      env: {
        HOST: "0.0.0.0",
        PORT: String(service.port),
        BROWSER: "none",
        NO_COLOR: "1",
      },
    }
  )
  return started ? { status: started } : { status: "no_sandbox" }
}
