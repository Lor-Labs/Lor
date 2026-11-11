import { randomUUID } from "node:crypto"
import { posix } from "node:path"
import { shellQuote } from "@ai-sdk/harness/utils"
import {
  BoatApi,
  type CommandStartedResponse,
  type CommandStatusResponse,
  Configuration,
  ResponseError,
  type Sandbox,
  waitUntilReady,
} from "@boatdev/sdk"
import { env } from "@repo/env/server"
import type {
  Experimental_SandboxProcess as SandboxProcess,
  Experimental_SandboxSession as SandboxSession,
} from "ai"
import { logger } from "../logger"
import { guardSandbox } from "./beta-compute"
import {
  SANDBOX_PROCESS_ENV,
  WORKSPACE_MOUNT,
  whileSandboxStarts,
} from "./blaxel"
import type { SandboxUsageBucket } from "./blaxel-usage"

// Boat (boat.dev), the fallback sandbox provider: a new session sandbox goes
// there when Blaxel refuses for capacity (session-sandbox.ts). Boat VMs start
// from a saved snapshot of the workbench (LOR_BOAT_TEMPLATE, built by
// packages/lor/sandbox-image/boat/build-template.sh) and are found by name,
// like Blaxel's. Boat has no standby: a stopped VM keeps its disk but its
// processes end, so a sandbox stays running until BOAT_KEEP_ALIVE_SEC after
// Lor last used it, and callers already restart processes on each open.

export const BOAT_KEEP_ALIVE_SEC = 30 * 60
// Pushing the stop deadline back is one API call; once a minute is enough.
const EXTEND_EVERY_MS = 60_000
const RUN_TIMEOUT_SEC = 1800
const WAIT_START_MS = 50
const WAIT_MAX_MS = 1000
const LOG_POLL_MS = 500
// States Boat keeps but that never run again.
const DEAD_STATES = new Set(["error", "cancelled"])
// Stopped: the disk is kept and resume brings it back.
const STOPPED_STATES = new Set(["archiving", "archived"])
// Commands carry this marker so a later run can find and stop them
// (session-sandbox.ts, process fencing).
const MARKER = "lor-cmd"

let client: BoatApi | null = null
function boat(): BoatApi {
  client ??= new BoatApi(
    new Configuration({ accessToken: env.BOAT_API_KEY ?? "" })
  )
  return client
}

export function boatConfigured(): boolean {
  return Boolean(env.BOAT_API_KEY)
}

// The SDK's error says only "Response returned an error code". A command's
// failure carries Boat's status and error code instead: they decide a retry,
// and without them the logs can't tell a starting VM from a stopped one.
export class BoatRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    cause: unknown
  ) {
    super(`Boat request failed (${status}${code ? ` ${code}` : ""})`, { cause })
    this.name = "BoatRequestError"
  }
}

async function boatRequestError(err: unknown): Promise<unknown> {
  if (!(err instanceof ResponseError)) return err
  // Boat's error envelope: `code` at the top and again in `error`.
  const body: unknown = await err.response
    .clone()
    .json()
    .catch(() => null)
  const field = (value: unknown, key: string): unknown =>
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)[key]
      : undefined
  const code = [
    field(body, "code"),
    field(field(body, "error"), "code"),
    field(body, "error"),
  ].find((value) => typeof value === "string")
  return new BoatRequestError(
    err.response.status,
    typeof code === "string" ? code.slice(0, 80) : null,
    err
  )
}

export function boatStatus(err: unknown): number | undefined {
  if (err instanceof BoatRequestError) return err.status
  return err instanceof ResponseError ? err.response.status : undefined
}

export type BoatSandbox = { id: string; name: string; memoryGb: number }

const ids = new Map<string, string>()
const extendedAt = new Map<string, number>()

function toBoatSandbox(sandbox: Sandbox): BoatSandbox {
  return {
    id: sandbox.id,
    name: sandbox.name,
    memoryGb: sandbox.memoryGB ?? 8,
  }
}

async function lookup(name: string): Promise<Sandbox | null> {
  const known = ids.get(name)
  if (known) {
    try {
      const { sandbox } = await boat().get({ sandboxId: known })
      if (!DEAD_STATES.has(sandbox.state)) return sandbox
    } catch (err) {
      if (boatStatus(err) !== 404) throw err
    }
    ids.delete(name)
  }
  const { sandboxes } = await boat().sandboxes({ namePrefix: name, limit: 20 })
  const match = sandboxes.find(
    (sandbox) => sandbox.name === name && !DEAD_STATES.has(sandbox.state)
  )
  if (match) ids.set(name, match.id)
  return match ?? null
}

// Whether the session has a Boat sandbox, without waking it. Lookup errors
// propagate.
export async function boatSandboxExists(name: string): Promise<boolean> {
  if (!boatConfigured()) return false
  return Boolean(await lookup(name))
}

// The session's Boat sandbox, running and with its stop deadline pushed
// back; resumed when Boat stopped it. Null when there is none.
export async function findBoatSandbox(
  name: string
): Promise<BoatSandbox | null> {
  if (!boatConfigured()) return null
  const sandbox = await lookup(name)
  if (!sandbox) return null
  if (STOPPED_STATES.has(sandbox.state)) {
    await resume(sandbox.id)
  } else {
    await keepAwake(sandbox.id)
  }
  return toBoatSandbox(sandbox)
}

// A sandbox Boat is still stopping can't resume yet (409 sandbox_stopping):
// someone came back as its keep-alive ran out. Retries until it has stopped.
const RESUME_WAIT_MS = 3 * 60_000

async function resume(sandboxId: string): Promise<void> {
  const deadline = Date.now() + RESUME_WAIT_MS
  for (;;) {
    try {
      await boat().resume({ sandboxId })
      break
    } catch (err) {
      if (boatStatus(err) !== 409 || Date.now() > deadline) throw err
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }
  await waitUntilReady(boat(), sandboxId)
  extendedAt.set(sandboxId, Date.now())
}

// Every use pushes the stop deadline back, so a long run is not stopped
// halfway; at most once a minute per sandbox.
async function keepAwake(sandboxId: string): Promise<void> {
  if ((extendedAt.get(sandboxId) ?? 0) > Date.now() - EXTEND_EVERY_MS) return
  extendedAt.set(sandboxId, Date.now())
  await boat()
    .update({
      sandboxId,
      updateSandboxRequest: { ttlSeconds: BOAT_KEEP_ALIVE_SEC },
    })
    .catch((err: unknown) => {
      extendedAt.delete(sandboxId)
      logger.warn({ err, boatId: sandboxId }, "Boat keep-alive failed")
    })
}

// Boat's sizes: small 2 vCPU / 4 GB, default 4 / 8, large 8 / 16.
function boatType(memoryMb: number): "small" | "default" | "large" {
  if (memoryMb <= 4096) return "small"
  if (memoryMb <= 8192) return "default"
  return "large"
}

export async function createBoatSandbox(
  name: string,
  memoryMb: number
): Promise<BoatSandbox> {
  const { sandbox } = await boat().create({
    idempotencyKey: name,
    createSandboxRequest: {
      name,
      type: boatType(memoryMb),
      from: env.LOR_BOAT_TEMPLATE,
      ttlSeconds: BOAT_KEEP_ALIVE_SEC,
      labels: { lor: "session" },
    },
  })
  ids.set(name, sandbox.id)
  extendedAt.set(sandbox.id, Date.now())
  const ready = await waitUntilReady(boat(), sandbox.id)
  logger.info(
    { sandbox: name, boatId: sandbox.id, type: ready.type },
    "Sandbox: session sandbox created on Boat"
  )
  return toBoatSandbox(ready)
}

export async function deleteBoatSandbox(name: string): Promise<boolean> {
  if (!boatConfigured()) return false
  const sandbox = await lookup(name)
  if (!sandbox) return false
  await boat()
    .deleteSandbox({ sandboxId: sandbox.id, xAsciiConfirmDelete: sandbox.id })
    .catch((err: unknown) => {
      if (boatStatus(err) !== 404) throw err
    })
  ids.delete(name)
  extendedAt.delete(sandbox.id)
  logger.info({ sandbox: name }, "Sandbox: Boat session sandbox deleted")
  return true
}

// Out of credits or expired: stop the VM (its processes end; the disk stays).
export async function stopBoatSandbox(name: string): Promise<void> {
  const sandbox = await lookup(name)
  if (!sandbox || STOPPED_STATES.has(sandbox.state)) return
  await boat().stop({ sandboxId: sandbox.id })
}

// Blaxel deletes idle sandboxes itself (ttl-idle); Boat keeps a stopped
// sandbox's disk, so ones stopped longer than LOR_SESSION_SANDBOX_TTL go.
export async function deleteIdleBoatSandboxes(): Promise<number> {
  if (!boatConfigured()) return 0
  const ttl = env.LOR_SESSION_SANDBOX_TTL
  const unit = { h: 3_600_000, d: 86_400_000, w: 604_800_000 }[
    ttl.slice(-1) as "h" | "d" | "w"
  ]
  const stoppedBefore = new Date(Date.now() - Number(ttl.slice(0, -1)) * unit)
  let deleted = 0
  let cursor: string | null | undefined
  do {
    const page = await boat().sandboxes({ stoppedBefore, limit: 100, cursor })
    for (const sandbox of page.sandboxes) {
      if (sandbox.labels?.lor !== "session") continue
      if (!STOPPED_STATES.has(sandbox.state)) continue
      await deleteBoatSandbox(sandbox.name).catch((err: unknown) =>
        logger.error(
          { err, sandbox: sandbox.name },
          "Boat sandbox delete failed"
        )
      )
      deleted += 1
    }
    cursor = page.pageInfo?.nextCursor
  } while (cursor)
  return deleted
}

// Hourly compute per Boat sandbox in the same shape as Blaxel's Billing API
// buckets (GB-seconds), so chargeSandboxUsage prices both alike.
export async function boatSandboxUsage(
  start: Date,
  end: Date
): Promise<SandboxUsageBucket[]> {
  if (!boatConfigured()) return []
  const buckets: SandboxUsageBucket[] = []
  let cursor: string | null | undefined
  do {
    const page = await boat().sandboxes({ limit: 100, cursor })
    for (const sandbox of page.sandboxes) {
      if (sandbox.labels?.lor !== "session") continue
      if (sandbox.stoppedAt && sandbox.stoppedAt < start) continue
      for (
        let hour = start.getTime();
        hour < end.getTime();
        hour += 3_600_000
      ) {
        const usage = await boat().usage({
          sandboxId: sandbox.id,
          since: new Date(hour).toISOString(),
          until: new Date(hour + 3_600_000).toISOString(),
        })
        if (!usage.seconds) continue
        buckets.push({
          sandboxName: sandbox.name,
          hourStart: new Date(hour),
          usageGbs: usage.seconds * (sandbox.memoryGB ?? 8),
          costUsd: usage.dollars,
        })
      }
    }
    cursor = page.pageInfo?.nextCursor
  } while (cursor)
  return buckets
}

// Ports: Boat serves each hosted port at a stable https://<sandbox>-<port>
// URL; a private one carries its token as `_token` (WebSockets included).
export async function hostBoatPort(
  sandbox: BoatSandbox,
  port: number,
  access: "public" | "private"
): Promise<{ url: string; token?: { param: string; value: string } }> {
  const hosted = await boat().hostPort({
    sandboxId: sandbox.id,
    hostPortRequest: { port, _public: access === "public" },
  })
  if (!hosted.url) throw new Error(`Boat gave port ${port} no URL`)
  const url = new URL(hosted.url)
  const token = url.searchParams.get("_token")
  url.search = ""
  const base = url.toString().replace(/\/$/, "")
  return token
    ? { url: base, token: { param: "_token", value: token } }
    : { url: base }
}

// Commands. Boat runs a command line with no env or name: the script sets
// the env and carries a marker naming it. Env values the caller passes
// (a harness turn's credential among them) go through a file the script
// reads and deletes, so they never sit in Boat's command history.
async function writeEnvFile(
  sandbox: BoatSandbox,
  vars: Record<string, string>
): Promise<string | null> {
  const entries = Object.entries(vars)
  if (entries.length === 0) return null
  const path = `/tmp/lor-env-${randomUUID().slice(0, 12)}`
  const content = entries
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
    .join("\n")
  await boat().writeFile({
    sandboxId: sandbox.id,
    fileWriteRequest: {
      path,
      content: Buffer.from(content).toString("base64"),
      encoding: "base64",
    },
  })
  return path
}

async function startCommand(
  sandbox: BoatSandbox,
  input: {
    label: string
    command: string
    cwd?: string
    env?: Record<string, string>
    abortSignal?: AbortSignal
  }
): Promise<number> {
  const envFile = await writeEnvFile(sandbox, input.env ?? {})
  const defaults = Object.entries(SANDBOX_PROCESS_ENV)
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
    .join("; ")
  const script = [
    `: ${MARKER} ${input.label}`,
    defaults,
    envFile ? `chmod 600 ${envFile}; . ${envFile}; rm -f ${envFile}` : ":",
    'mkdir -p "$TMPDIR" 2>/dev/null',
    `cd ${shellQuote(input.cwd ?? WORKSPACE_MOUNT)} || exit 1`,
    input.command,
  ].join("\n")
  void keepAwake(sandbox.id)
  // Root, as on Blaxel (HOME=/root holds the harness bootstrap), whether or
  // not Boat runs commands as root. Boat holds a command for up to 60 seconds
  // while the VM starts (a create or resume), then answers 409 boat_starting:
  // retryable, the command never ran. Nothing else is replayed (a 502 may
  // have started it).
  const started = (await whileSandboxStarts(
    () =>
      boat()
        .command({
          sandboxId: sandbox.id,
          commandRequest: {
            command: `$([ "$(id -u)" = 0 ] || echo sudo -n -H) bash -c ${shellQuote(script)}`,
            detached: true,
          },
        })
        .catch(async (err: unknown) => {
          throw await boatRequestError(err)
        }),
    {
      retry: (err) =>
        err instanceof BoatRequestError && err.code === "boat_starting",
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    }
  )) as CommandStartedResponse
  return started.processId
}

function commandStatus(
  sandbox: BoatSandbox,
  processId: number,
  offsets: { stdout: number; stderr: number }
): Promise<CommandStatusResponse> {
  return boat().commandStatus({
    sandboxId: sandbox.id,
    processId,
    stdoutOffset: offsets.stdout,
    stderrOffset: offsets.stderr,
  })
}

function stopCommand(sandbox: BoatSandbox, processId: number) {
  return boat()
    .stopCommand({ sandboxId: sandbox.id, processId })
    .catch(() => {})
}

// Runs a command to the end and returns all its output.
export async function boatExec(
  sandbox: BoatSandbox,
  input: {
    command: string
    cwd?: string
    env?: Record<string, string>
    label?: string
    timeoutSec?: number
    abortSignal?: AbortSignal
  }
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  input.abortSignal?.throwIfAborted()
  const processId = await startCommand(sandbox, {
    label: input.label ?? `run-${randomUUID().slice(0, 8)}`,
    command: input.command,
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...(input.env ? { env: input.env } : {}),
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
  })
  const onAbort = () => void stopCommand(sandbox, processId)
  input.abortSignal?.addEventListener("abort", onAbort, { once: true })
  try {
    const offsets = { stdout: 0, stderr: 0 }
    let stdout = ""
    let stderr = ""
    let delay = WAIT_START_MS
    const deadline = Date.now() + (input.timeoutSec ?? RUN_TIMEOUT_SEC) * 1000
    for (;;) {
      const status = await commandStatus(sandbox, processId, offsets)
      stdout += status.stdout
      stderr += status.stderr
      offsets.stdout = status.stdoutNextOffset ?? offsets.stdout
      offsets.stderr = status.stderrNextOffset ?? offsets.stderr
      if (status.more) continue
      if (!status.running) {
        input.abortSignal?.throwIfAborted()
        return { exitCode: status.exitCode ?? -1, stdout, stderr }
      }
      if (Date.now() > deadline) {
        await stopCommand(sandbox, processId)
        throw new Error(`Sandbox command ${processId} did not finish in time`)
      }
      await new Promise((resolve) => setTimeout(resolve, delay))
      delay = Math.min(delay * 2, WAIT_MAX_MS)
    }
  } finally {
    input.abortSignal?.removeEventListener("abort", onAbort)
  }
}

// Stops the marked commands from an earlier attempt (run-, spawn-, and
// bridge- unless kept). Returns whether a kept bridge still runs.
export async function stopBoatLeftovers(
  sandbox: BoatSandbox,
  keepBridges: boolean
): Promise<boolean> {
  const labels = keepBridges ? "run|spawn" : "run|spawn|bridge"
  // The bracket keeps pgrep from matching its own command line.
  const result = await boatExec(sandbox, {
    label: "fence",
    command: [
      `for pid in $(pgrep -f '${MARKER.slice(0, -1)}[${MARKER.slice(-1)}] (${labels})-'); do`,
      '  pkill -TERM -P "$pid" 2>/dev/null; kill -TERM "$pid" 2>/dev/null',
      "done",
      `pgrep -f '${MARKER.slice(0, -1)}[${MARKER.slice(-1)}] bridge-' >/dev/null && echo bridge || true`,
    ].join("\n"),
    timeoutSec: 30,
  }).catch((err: unknown) => {
    logger.warn({ err, sandbox: sandbox.name }, "Sandbox: Boat fencing failed")
    return null
  })
  return keepBridges && (result?.stdout.includes("bridge") ?? false)
}

const HARNESS_BRIDGE_SCRIPT = /\.harness-bootstrap\/([a-z-]+)\/bridge\.mjs/

export function boatSandboxSession(
  sandbox: BoatSandbox,
  options: { bridgeEnv?: (bridge: string) => Record<string, string> } = {}
): SandboxSession & { defaultWorkingDirectory: string } {
  const access = () => guardSandbox(sandbox.name)

  // Boat's file API reaches only /home/user and /tmp, so files go through a
  // copy in /tmp that a root command moves (checked 2026-11-05).
  const staging = () => `/tmp/lor-io/${randomUUID()}`

  const readBytes = async (path: string): Promise<Uint8Array | null> => {
    await access()
    // One root command prints it as base64: the output is paged, so size
    // only costs more polls.
    const read = await boatExec(sandbox, {
      label: "io-read",
      command: `[ -f ${shellQuote(path)} ] || exit 3; base64 -w0 ${shellQuote(path)}`,
      timeoutSec: 120,
    })
    if (read.exitCode === 3) return null
    if (read.exitCode !== 0) {
      throw new Error(`Reading ${path} failed: ${read.stderr.trim()}`)
    }
    return new Uint8Array(Buffer.from(read.stdout, "base64"))
  }

  // `cat >` keeps an existing file's mode (a script stays executable).
  const writeBytes = async (path: string, bytes: Uint8Array): Promise<void> => {
    await access()
    const copy = staging()
    await boat().writeFile({
      sandboxId: sandbox.id,
      fileWriteRequest: {
        path: copy,
        content: Buffer.from(bytes).toString("base64"),
        encoding: "base64",
      },
    })
    const target = shellQuote(path)
    const moved = await boatExec(sandbox, {
      label: "io-write",
      command: `mkdir -p ${shellQuote(posix.dirname(path))} && cat ${copy} > ${target}; code=$?; rm -f ${copy}; exit $code`,
      timeoutSec: 60,
    })
    if (moved.exitCode !== 0) {
      throw new Error(`Writing ${path} failed: ${moved.stderr.trim()}`)
    }
  }

  const run: SandboxSession["run"] = async ({
    command,
    workingDirectory,
    env: vars,
    abortSignal,
  }) => {
    await access()
    return boatExec(sandbox, {
      command,
      cwd: workingDirectory ?? WORKSPACE_MOUNT,
      ...(vars ? { env: vars } : {}),
      ...(abortSignal ? { abortSignal } : {}),
    })
  }

  const spawn: SandboxSession["spawn"] = async ({
    command,
    workingDirectory,
    env: vars,
    abortSignal,
  }) => {
    abortSignal?.throwIfAborted()
    await access()
    const bridge = HARNESS_BRIDGE_SCRIPT.exec(command)?.[1] ?? null
    const label = `${bridge ? "bridge" : "spawn"}-${randomUUID().slice(0, 8)}`
    const processId = await startCommand(sandbox, {
      label,
      command,
      cwd: workingDirectory ?? WORKSPACE_MOUNT,
      env: {
        ...(bridge ? (options.bridgeEnv?.(bridge) ?? {}) : {}),
        ...vars,
      },
    })
    const kill = () => stopCommand(sandbox, processId).then(() => {})
    abortSignal?.addEventListener("abort", () => void kill(), { once: true })
    if (abortSignal?.aborted) void kill()

    // One poller feeds both streams. Once a bridge printed bridge-ready they
    // end, so nothing polls while the bridge waits.
    const encoder = new TextEncoder()
    let stdoutController: ReadableStreamDefaultController<Uint8Array> | null =
      null
    let stderrController: ReadableStreamDefaultController<Uint8Array> | null =
      null
    let finished: Promise<number> | null = null
    const offsets = { stdout: 0, stderr: 0 }
    let seenStdout = ""
    const poll = async () => {
      for (;;) {
        const status = await commandStatus(sandbox, processId, offsets).catch(
          () => null
        )
        if (status) {
          offsets.stdout = status.stdoutNextOffset ?? offsets.stdout
          offsets.stderr = status.stderrNextOffset ?? offsets.stderr
          if (status.stdout) {
            seenStdout += status.stdout
            stdoutController?.enqueue(encoder.encode(status.stdout))
          }
          if (status.stderr) {
            stderrController?.enqueue(encoder.encode(status.stderr))
          }
        }
        const ready = bridge !== null && seenStdout.includes('"bridge-ready"')
        if (ready || (status && !status.running && !status.more)) {
          stdoutController?.close()
          stderrController?.close()
          return
        }
        if (!status?.more) {
          await new Promise((resolve) => setTimeout(resolve, LOG_POLL_MS))
        }
      }
    }
    const streams = {
      stdout: new ReadableStream<Uint8Array>({
        start(controller) {
          stdoutController = controller
        },
      }),
      stderr: new ReadableStream<Uint8Array>({
        start(controller) {
          stderrController = controller
        },
      }),
    }
    void poll().catch((err: unknown) => {
      stdoutController?.error(err)
      stderrController?.error(err)
    })
    const handle: SandboxProcess = {
      ...streams,
      wait() {
        finished ??= (async () => {
          let delay = WAIT_START_MS
          for (;;) {
            const status = await boat().commandStatus({
              sandboxId: sandbox.id,
              processId,
              tailBytes: 0,
            })
            if (!status.running) return status.exitCode ?? -1
            await new Promise((resolve) => setTimeout(resolve, delay))
            delay = Math.min(delay * 2, WAIT_MAX_MS)
          }
        })()
        return finished.then((exitCode) => {
          abortSignal?.throwIfAborted()
          return { exitCode }
        })
      },
      kill,
    }
    return handle
  }

  return {
    description: `Lor's sandbox for this conversation: a Linux machine with Python and Node. Files under ${WORKSPACE_MOUNT} persist between turns. No credentials for Lor's services are present.`,
    defaultWorkingDirectory: WORKSPACE_MOUNT,
    run,
    spawn,
    readBinaryFile: ({ path }) => readBytes(path),
    readFile: async ({ path }) => {
      const bytes = await readBytes(path)
      if (!bytes) return null
      return new ReadableStream({
        start(controller) {
          controller.enqueue(bytes)
          controller.close()
        },
      })
    },
    readTextFile: async ({ path, encoding, startLine, endLine }) => {
      const bytes = await readBytes(path)
      if (!bytes) return null
      const text = new TextDecoder(encoding ?? "utf-8").decode(bytes)
      if (startLine === undefined && endLine === undefined) return text
      const lines = text.split("\n")
      return lines
        .slice((startLine ?? 1) - 1, endLine ?? lines.length)
        .join("\n")
    },
    writeBinaryFile: ({ path, content }) => writeBytes(path, content),
    writeTextFile: ({ path, content, encoding }) =>
      writeBytes(
        path,
        encoding && encoding !== "utf-8" && encoding !== "utf8"
          ? new Uint8Array(Buffer.from(content, encoding as BufferEncoding))
          : new TextEncoder().encode(content)
      ),
    writeFile: async ({ path, content }) =>
      writeBytes(
        path,
        new Uint8Array(await new Response(content).arrayBuffer())
      ),
  }
}

// Named long-lived processes (sandbox-ports.ts): Boat has no names, so each
// runs in its own process group with a pid file under /tmp/lor-procs.
const PROCS = "/tmp/lor-procs"

export async function ensureBoatProcess(
  sandbox: BoatSandbox,
  input: {
    name: string
    command: string
    cwd?: string
    env?: Record<string, string>
  }
): Promise<"running" | "started"> {
  const pid = `${PROCS}/${input.name}.pid`
  const result = await boatExec(sandbox, {
    label: `proc-${input.name}`,
    ...(input.env ? { env: input.env } : {}),
    ...(input.cwd ? { cwd: input.cwd } : {}),
    command: [
      `mkdir -p ${PROCS}`,
      `if [ -f ${pid} ] && kill -0 "$(cat ${pid})" 2>/dev/null; then echo running; exit 0; fi`,
      `setsid nohup bash -c ${shellQuote(input.command)} >${PROCS}/${input.name}.log 2>&1 </dev/null &`,
      `echo $! > ${pid}`,
      "echo started",
    ].join("\n"),
    timeoutSec: 60,
  })
  return result.stdout.includes("running") ? "running" : "started"
}

export async function stopBoatProcess(
  sandbox: BoatSandbox,
  name: string
): Promise<void> {
  const pid = `${PROCS}/${name}.pid`
  await boatExec(sandbox, {
    label: "proc-stop",
    command: `[ -f ${pid} ] && kill -TERM -- "-$(cat ${pid})" 2>/dev/null; rm -f ${pid}; true`,
    timeoutSec: 30,
  })
}

export async function listBoatProcesses(
  sandbox: BoatSandbox,
  prefix: string
): Promise<{ name: string; running: boolean }[]> {
  const result = await boatExec(sandbox, {
    label: "proc-list",
    command: `for f in ${PROCS}/${prefix}*.pid; do [ -f "$f" ] || continue; n=$(basename "$f" .pid); if kill -0 "$(cat "$f")" 2>/dev/null; then echo "$n 1"; else echo "$n 0"; fi; done`,
    timeoutSec: 30,
  })
  return result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name = "", running] = line.split(" ")
      return { name, running: running === "1" }
    })
}
