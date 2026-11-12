import { posix } from "node:path"
import { shellQuote } from "@ai-sdk/harness/utils"
import type { Experimental_SandboxSession as SandboxSession } from "ai"
import { z } from "zod"
import { WORKSPACE_MOUNT } from "../sandbox/blaxel"
import { ensureProcess, restartProcess } from "../sandbox/sandbox-ports"
import { attachSessionSandbox } from "../sandbox/session-sandbox"
import { isSafeEnvFilePath } from "./environments"
import { HIDDEN_PORTS, LISTENERS_JS } from "./previews"
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
const SERVICE_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/

const serviceSchema = z.object({
  name: z
    .string()
    .regex(
      SERVICE_NAME,
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
      `the sandbox itself uses ports ${HIDDEN_PORTS.join(", ")}; run the service on another port`
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

// `stat(pid)` for a `node -e` script: a process's state, process group and
// start (seconds since the epoch). A zombie still answers `kill -0`: the
// sandbox's init never reaps orphans. `service(pidFile)`: the process a
// service's pid file names, only if it started when the file was written. A
// sandbox restored from a checkpoint keeps the file, and its pid can belong to
// another process by then.
const PROC_STAT_JS = `
const bootTime = (() => {
  try { return Number(/^btime (\\d+)/m.exec(fs.readFileSync("/proc/stat", "utf8"))[1]) } catch { return 0 }
})()
const stat = (pid) => {
  try {
    const text = fs.readFileSync("/proc/" + pid + "/stat", "utf8")
    const rest = text.slice(text.lastIndexOf(")") + 2).split(" ")
    return { alive: rest[0] !== "Z" && rest[0] !== "X", group: Number(rest[2]), start: bootTime + Number(rest[19]) / 100 }
  } catch {
    return null
  }
}
const service = (pidFile) => {
  try {
    const pid = Number(fs.readFileSync(pidFile, "utf8"))
    if (!(pid > 1)) return null
    const proc = stat(pid)
    const written = fs.statSync(pidFile).mtimeMs / 1000
    if (!proc || !bootTime || proc.start < written - 60 || proc.start > written + 5) return null
    return { pid, ...proc }
  } catch {
    return null
  }
}
`

// One read for the whole Browser tab poll: the setup file, what listens, the
// ports only the sandbox itself still holds (`held`, see `orphan` in
// previews.ts), and for each started service whether its process is alive,
// how long it has run, how long its log has been quiet, the end of its log
// and the ports its process group listens on (a dev server on another port
// than the file says).
const SETUP_STATUS = `${LISTENERS_JS}${PROC_STAT_JS}
const [workDir, file, logDir, ...hidden] = process.argv.slice(1)
const out = { clone: fs.existsSync(workDir + "/.git"), file: null, listening: [], held: [], services: {} }
if (out.clone) {
  try {
    const fd = fs.openSync(workDir + "/" + file, "r")
    const buf = Buffer.alloc(${MAX_BYTES})
    out.file = buf.toString("utf8", 0, fs.readSync(fd, buf, 0, buf.length, 0))
    fs.closeSync(fd)
  } catch {}
  const all = listeners(new Set(hidden.map(Number)))
  const open = all.filter((l) => !l.hidden && !l.orphan)
  out.listening = open.map((l) => l.port)
  out.held = all.filter((l) => l.orphan).map((l) => l.port)
  const groupPorts = new Map()
  for (const l of open) {
    const group = l.pid ? stat(l.pid)?.group : null
    if (group > 1) groupPorts.set(group, [...(groupPorts.get(group) ?? []), l.port])
  }
  let names = []
  try { names = fs.readdirSync(logDir).filter((f) => f.endsWith(".log.pid")).map((f) => f.slice(0, -8)) } catch {}
  const now = Date.now()
  for (const name of names) {
    const log = logDir + "/" + name + ".log"
    const proc = service(log + ".pid")
    let upMs = null
    try { upMs = Math.max(0, Math.round(now - fs.statSync(log + ".pid").mtimeMs)) } catch {}
    let tail = null
    let quietMs = null
    try {
      const fd = fs.openSync(log, "r")
      const info = fs.fstatSync(fd)
      const length = Math.min(info.size, ${LOG_TAIL_BYTES})
      const buf = Buffer.alloc(length)
      fs.readSync(fd, buf, 0, length, info.size - length)
      fs.closeSync(fd)
      tail = buf.toString("utf8")
      quietMs = Math.max(0, Math.round(now - info.mtimeMs))
    } catch {}
    let phase = null
    try { phase = fs.readFileSync(log + ".phase", "utf8").trim() } catch {}
    const alive = Boolean(proc && proc.alive)
    out.services[name] = { alive, phase, upMs, quietMs, tail, ports: alive ? groupPorts.get(proc.group) ?? [] : [] }
  }
}
console.log(JSON.stringify(out))
`

type ServiceProcess = {
  alive: boolean
  phase: string | null
  upMs: number | null
  quietMs: number | null
  tail: string | null
  ports: number[]
}

type SandboxSetup = {
  clone: boolean
  file: string | null
  listening: number[]
  held: number[]
  services: Record<string, ServiceProcess>
}

// running: something listens on its port, whoever started it. starting: its
// process is alive (installing, or not listening yet; a dev server in watch
// mode stays here after it crashed, so `quietMs` and the log tell). exited:
// its process ended; the log says why. stopped: never started, or Stop ended
// it (its `.phase` file says "stopped").
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
        // The end of the log of the process the Start button started.
        log: string | null
        // While starting: whether `install` or its own command runs, the time
        // since the start, and since the log's last output.
        installing: boolean
        upMs: number | null
        quietMs: number | null
        // Ports its process listens on that are not the file's `port`.
        otherPorts: number[]
        // Nothing runs on its port, but the sandbox still holds it from an
        // earlier server bound to 0.0.0.0: binding `::` fails there.
        portHeld: boolean
      }[]
    }

export async function repoSetupStatus(
  sessionId: string
): Promise<RepoSetupStatus> {
  const sandbox = await attachSessionSandbox({ sessionId })
  if (!sandbox) return { status: "no_sandbox" }
  let read: SandboxSetup
  try {
    const result = await sandbox.session.run({
      command: `node -e ${shellQuote(SETUP_STATUS)} ${shellQuote(sessionWorkDir(sessionId))} ${shellQuote(REPO_SETUP_FILE)} ${shellQuote(LOG_DIR)} ${HIDDEN_PORTS.join(" ")}`,
    })
    if (result.exitCode !== 0) {
      throw new Error(`Couldn't read ${REPO_SETUP_FILE}: ${result.stderr}`)
    }
    read = JSON.parse(result.stdout.trim())
  } finally {
    sandbox.close()
  }
  if (!read.clone) return { status: "no_sandbox" }
  if (read.file === null) return { status: "missing" }
  const parsed = parseRepoSetup(read.file)
  if (parsed.status !== "ready") return parsed
  const listening = new Set(read.listening)
  return {
    status: "ready",
    install: parsed.setup.install ?? null,
    services: parsed.setup.services.map((service) => {
      const proc = read.services[service.name]
      const state: ServiceState = listening.has(service.port)
        ? "running"
        : proc?.alive
          ? "starting"
          : // A deliberate stop leaves its log behind: not a crash.
            proc?.tail != null && proc.phase !== "stopped"
            ? "exited"
            : "stopped"
      const starting = state === "starting"
      return {
        name: service.name,
        command: service.command,
        port: service.port,
        cwd: service.cwd ?? null,
        default: service.default !== false,
        state,
        // A server someone else started on the port has no log here.
        log: proc?.alive || state === "exited" ? (proc?.tail ?? null) : null,
        installing: starting && proc?.phase === "install",
        upMs: starting ? (proc?.upMs ?? null) : null,
        quietMs: starting ? (proc?.quietMs ?? null) : null,
        otherPorts: starting
          ? (proc?.ports ?? []).filter((port) => port !== service.port)
          : [],
        portHeld: state !== "running" && read.held.includes(service.port),
      }
    }),
  }
}

// Install runs on every start (installs are quick when nothing changed, and
// the repo may have new dependencies), one at a time across services. The
// `.phase` file says which step runs: a quiet log means waiting while it
// installs, and a stuck server once its command runs.
function serviceCommand(
  workDir: string,
  install: string | null,
  service: RepoService
): string {
  const q = shellQuote
  const log = serviceLog(service.name)
  const lock = q(`${LOG_DIR}/install.lock`)
  return [
    `mkdir -p ${q(LOG_DIR)}`,
    `echo $$ > ${q(`${log}.pid`)}`,
    `exec > ${q(log)} 2>&1`,
    `cd ${q(workDir)} || exit 1`,
    ...(install
      ? [
          `echo install > ${q(`${log}.phase`)}`,
          `printf '$ %s\\n' ${q(install)}`,
          `flock -n ${lock} true || echo "Waiting for another service's install to finish"`,
          // -o: a daemon the install leaves running doesn't keep the lock.
          `flock -o ${lock} bash -c ${q(install)} || { echo "Install failed (exit $?)"; exit 1; }`,
        ]
      : []),
    ...(service.cwd ? [`cd ${q(service.cwd)} || exit 1`] : []),
    `echo run > ${q(`${log}.phase`)}`,
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

// `restart`: stops what runs first, so a service stuck before it listens (a
// crashed dev server in watch mode) or one on stale code starts clean.
export async function startService(
  sessionId: string,
  name: string,
  { restart = false }: { restart?: boolean } = {}
): Promise<StartServiceResult> {
  const workDir = sessionWorkDir(sessionId)
  const sandbox = await attachSessionSandbox({ sessionId })
  if (!sandbox) return { status: "no_sandbox" }
  let parsed: ParsedSetup | null
  try {
    parsed = await readRepoSetup(sandbox.session, workDir)
    const service =
      parsed?.status === "ready"
        ? parsed.setup.services.find((s) => s.name === name)
        : undefined
    if (restart && service) {
      await stopServiceProcess(sandbox.session, name, service.port)
    }
  } finally {
    sandbox.close()
  }
  if (!parsed) return { status: "no_sandbox" }
  if (parsed.status !== "ready") return parsed
  const service = parsed.setup.services.find((s) => s.name === name)
  if (!service) return { status: "unknown_service" }
  const started = await (restart ? restartProcess : ensureProcess)(
    { sessionId },
    {
      name: `service-${service.name}`,
      command: serviceCommand(workDir, parsed.setup.install ?? null, service),
      cwd: workDir,
      // No HOST: the browser and the preview proxy reach loopback, and a
      // server bound to 0.0.0.0 leaves the port held on Blaxel (previews.ts).
      env: {
        PORT: String(service.port),
        BROWSER: "none",
        NO_COLOR: "1",
      },
    }
  )
  return started ? { status: started } : { status: "no_sandbox" }
}

// Ends the service's whole process group (the dev server and its children),
// then whatever else still listens on its port: a server Lor or the terminal
// started. That one gets a signal to its own process only, since its group
// may hold the shell that started it.
const STOP_SERVICE = `${LISTENERS_JS}${PROC_STAT_JS}
const [logDir, name, port, ...hidden] = process.argv.slice(1)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const own = stat(process.pid)?.group
const main = async () => {
  let stopped = false
  const pidFile = logDir + "/" + name + ".log.pid"
  const proc = service(pidFile)
  const pid = proc ? proc.pid : 0
  if (proc && proc.alive) {
    const target = proc.group > 1 && proc.group !== own ? -proc.group : pid
    const signal = (sig) => { try { process.kill(target, sig); return true } catch { return false } }
    stopped = signal("SIGTERM")
    for (let i = 0; i < 30 && stat(pid)?.alive; i++) await sleep(100)
    signal("SIGKILL")
  }
  // Start writes its own phase over this, so only a crash after it reads as exited.
  if (fs.existsSync(pidFile)) { try { fs.writeFileSync(logDir + "/" + name + ".log.phase", "stopped") } catch {} }
  if (Number(port) > 0) {
    for (let i = 0; i < 2; i++) {
      const left = listeners(new Set(hidden.map(Number))).filter((l) => l.port === Number(port) && !l.hidden && l.pid > 1 && l.pid !== process.pid)
      if (left.length === 0) break
      for (const l of left) { try { process.kill(l.pid, i === 0 ? "SIGTERM" : "SIGKILL"); stopped = true } catch {} }
      await sleep(400)
    }
  }
  console.log(JSON.stringify({ stopped }))
}
main()
`

async function stopServiceProcess(
  session: SandboxSession,
  name: string,
  port: number | null
): Promise<boolean> {
  const result = await session.run({
    command: `node -e ${shellQuote(STOP_SERVICE)} ${shellQuote(LOG_DIR)} ${shellQuote(name)} ${port ?? 0} ${HIDDEN_PORTS.join(" ")}`,
  })
  if (result.exitCode !== 0) return false
  try {
    return JSON.parse(result.stdout.trim()).stopped === true
  } catch {
    return false
  }
}

export type StopServiceResult =
  | { status: "stopped" | "not_running" }
  | { status: "no_sandbox" | "unknown_service" }

// Works from the name alone, so a service still stops after the file changed.
export async function stopService(
  sessionId: string,
  name: string
): Promise<StopServiceResult> {
  if (!SERVICE_NAME.test(name)) return { status: "unknown_service" }
  const sandbox = await attachSessionSandbox({ sessionId })
  if (!sandbox) return { status: "no_sandbox" }
  try {
    const parsed = await readRepoSetup(
      sandbox.session,
      sessionWorkDir(sessionId)
    ).catch(() => null)
    const service =
      parsed?.status === "ready"
        ? parsed.setup.services.find((s) => s.name === name)
        : undefined
    const stopped = await stopServiceProcess(
      sandbox.session,
      name,
      service?.port ?? null
    )
    return { status: stopped ? "stopped" : "not_running" }
  } finally {
    sandbox.close()
  }
}
