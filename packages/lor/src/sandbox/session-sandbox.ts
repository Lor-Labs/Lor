import { randomUUID } from "node:crypto"
import { posix } from "node:path"
import { shellQuote } from "@ai-sdk/harness/utils"
import { SandboxInstance } from "@blaxel/core"
import { env } from "@repo/env/server"
import type {
  Experimental_SandboxProcess as SandboxProcess,
  Experimental_SandboxSession as SandboxSession,
} from "ai"
import { logger } from "../logger"
import type { HarnessOwner } from "../session-core"
import {
  baseConfig,
  blaxelConfigured,
  closeConnection,
  hasWorkspaceDisk,
  persistentLifecycle,
  probeSandbox,
  SANDBOX_PROCESS_ENV,
  WORKSPACE_MOUNT,
} from "./blaxel"

// Every agent run gets its conversation's sandbox: one per Lor session or
// voice call, created on the first run and reused after, with standby in
// between. Deleted after LOR_SESSION_SANDBOX_TTL idle, or 10 minutes after the
// session is archived (reference/planned/pi-harness-runbook.md §4.10).

// Runaway guard per command; the adapter does not pass the model's timeout.
const RUN_TIMEOUT_SEC = 1800
const LOG_POLL_MS = 500
// Completion polling starts fast so the adapter's many short path checks stay
// quick, then backs off for long commands.
const WAIT_START_MS = 50
const WAIT_MAX_MS = 1000

export const SESSION_WORK_DIR = WORKSPACE_MOUNT

// Egress limits (reference/planned/sandbox-safety-research.md §7): reads to
// any host, writes only for git fetch and npm audit. The `proxy` firewall
// ruleset forces every connection through Blaxel's proxy and can only be set
// when a sandbox is created, so the label marks sandboxes that have it; bump
// the version to replace older ones.
const EGRESS_LABEL = "lor-egress"
const EGRESS_VERSION = "1"
const SESSION_NETWORK = {
  firewall: { rulesets: ["proxy"] },
  allowedDomains: [
    "GET:HEAD:OPTIONS:*",
    "POST:github.com/*git-upload-pack",
    "POST:gitlab.com/*git-upload-pack",
    "POST:bitbucket.org/*git-upload-pack",
    "POST:registry.npmjs.org/-/npm/v1/security/",
  ],
  proxy: { routing: [] },
}
// Debian's git ignores SSL_CERT_FILE, so it would reject the proxy's CA.
const GIT_PROXY_CA =
  'if [ -n "$SSL_CERT_FILE" ]; then export GIT_SSL_CAINFO="$SSL_CERT_FILE"; fi; '

function hasEgressLimits(sandbox: SandboxInstance): boolean {
  return sandbox.metadata.labels?.[EGRESS_LABEL] === EGRESS_VERSION
}

// Blaxel's QUOTA_EXCEEDED means the account's tier memory limit is reached,
// not a sandbox count; its own message names the limit, so it is kept.
export class SandboxCapacityError extends Error {
  constructor(cause: unknown) {
    const detail =
      cause instanceof Error
        ? cause.message
        : typeof cause === "object" && cause !== null
          ? JSON.stringify(cause).slice(0, 500)
          : String(cause)
    super(`Sandbox capacity is full (quota exceeded): ${detail}`, { cause })
    this.name = "SandboxCapacityError"
  }
}

function hasCode(err: unknown, codes: ReadonlyArray<unknown>): boolean {
  if (typeof err !== "object" || err === null) return false
  const status = "status" in err ? err.status : undefined
  const code = "code" in err ? err.code : undefined
  return codes.includes(status) || codes.includes(code)
}

const isNotFound = (err: unknown) => hasCode(err, [404, "404"])

export function sessionSandboxName(owner: HarnessOwner): string {
  return "sessionId" in owner
    ? `ses-${owner.sessionId}`
    : `call-${owner.voiceSessionId}`
}

export type SessionSandbox = {
  session: SandboxSession
  // Created on this run: the conversation's first run, or its sandbox was
  // missing or unhealthy. When earlier turns are saved, the caller tells the
  // model and the session that earlier files are gone.
  fresh: boolean
  // Ends our connection so Blaxel can put the sandbox in standby.
  close(): void
}

async function createSessionSandbox(name: string): Promise<SandboxInstance> {
  const sandbox = await SandboxInstance.createIfNotExists({
    ...baseConfig(name, env.LOR_SESSION_DISK_MB),
    lifecycle: persistentLifecycle(env.LOR_SESSION_SANDBOX_TTL),
    network: SESSION_NETWORK,
    labels: { [EGRESS_LABEL]: EGRESS_VERSION },
  }).catch((err: unknown) => {
    if (hasCode(err, ["QUOTA_EXCEEDED"])) throw new SandboxCapacityError(err)
    throw err
  })
  const health = await probeSandbox(sandbox).catch((err: unknown) => {
    closeConnection(sandbox)
    throw err
  })
  if (
    !health.healthy ||
    !hasWorkspaceDisk(sandbox, env.LOR_SESSION_DISK_MB) ||
    !hasEgressLimits(sandbox)
  ) {
    closeConnection(sandbox)
    throw new Error(
      `New sandbox ${name} is unhealthy (${health.status}, exit ${health.exitCode})`
    )
  }
  logger.info({ sandbox: name }, "Sandbox: session sandbox created")
  return sandbox
}

// Process fencing (harness-sessions.md, writer ownership). A turn's commands
// are named run-*/spawn-*, and only one run works in a conversation at a time
// (one active agent_run per scope), so any still running when a run opens the
// sandbox belong to an attempt that crashed, was stopped or lost its lease.
// Stop them before this run writes to the same disk. Detached background
// processes whose command finished are not named records and keep running.
async function stopLeftoverCommands(
  sandbox: SandboxInstance,
  name: string
): Promise<void> {
  const leftover = await sandbox.process
    .list()
    .then((records) =>
      records.filter(
        (record) =>
          record.status === "running" && /^(run|spawn)-/.test(record.name)
      )
    )
    .catch((err: unknown) => {
      logger.warn({ err, sandbox: name }, "Sandbox: process list failed")
      return []
    })
  if (leftover.length === 0) return
  await Promise.all(
    leftover.map((record) =>
      sandbox.process.kill(record.name).catch((err: unknown) => {
        logger.warn(
          { err, sandbox: name, process: record.name },
          "Sandbox: leftover command kill failed"
        )
      })
    )
  )
  logger.warn(
    { sandbox: name, processes: leftover.map((record) => record.name) },
    "Sandbox: stopped commands left by an earlier attempt"
  )
}

export async function openSessionSandbox(
  owner: HarnessOwner
): Promise<SessionSandbox> {
  const name = sessionSandboxName(owner)
  const existing = await SandboxInstance.get(name).catch((err: unknown) => {
    if (isNotFound(err)) return null
    throw err
  })

  if (existing) {
    // A probe error does not prove the workspace is gone: fail the run rather
    // than delete files. Only a sandbox that answers unhealthy is replaced,
    // or one created without the current egress limits.
    const health =
      hasWorkspaceDisk(existing, env.LOR_SESSION_DISK_MB) &&
      hasEgressLimits(existing)
        ? await probeSandbox(existing).catch((err: unknown) => {
            closeConnection(existing)
            throw err
          })
        : null
    if (health?.healthy) {
      await stopLeftoverCommands(existing, name)
      return {
        session: blaxelSandboxSession(existing),
        fresh: false,
        close: () => closeConnection(existing),
      }
    }
    logger.warn(
      { sandbox: name, health },
      "Sandbox: session sandbox unhealthy; replacing it"
    )
    closeConnection(existing)
    await SandboxInstance.delete(name)
  }

  const created = await createSessionSandbox(name)
  return {
    session: blaxelSandboxSession(created),
    fresh: true,
    close: () => closeConnection(created),
  }
}

// The conversation's files go with it; Pi's saved state and shared files
// live in Postgres and R2. A sandbox that is already gone counts as deleted.
export async function deleteSessionSandbox(owner: HarnessOwner): Promise<void> {
  if (!blaxelConfigured()) return
  const name = sessionSandboxName(owner)
  await SandboxInstance.delete(name).catch((err: unknown) => {
    if (!isNotFound(err)) throw err
  })
  logger.info({ sandbox: name }, "Sandbox: session sandbox deleted")
}

function inShell(command: string): string {
  return `bash -c ${shellQuote(GIT_PROXY_CA + command)}`
}

function bytesStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

// Live output is polled from the process record: Blaxel's push log stream
// drops lines under load (see execToCompletion in blaxel.ts).
function logStream(
  sandbox: SandboxInstance,
  name: string,
  type: "stdout" | "stderr"
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let seen = 0
  return new ReadableStream({
    async pull(controller) {
      for (;;) {
        // Status first: output written before the process ended is then in logs.
        const proc = await sandbox.process.get(name).catch(() => null)
        const text = await sandbox.process.logs(name, type).catch(() => "")
        if (text.length > seen) {
          controller.enqueue(encoder.encode(text.slice(seen)))
          seen = text.length
          return
        }
        if (!proc || proc.status !== "running") {
          controller.close()
          return
        }
        await new Promise((resolve) => setTimeout(resolve, LOG_POLL_MS))
      }
    },
  })
}

export function blaxelSandboxSession(sandbox: SandboxInstance): SandboxSession {
  const readBytes = async (path: string): Promise<Uint8Array | null> => {
    try {
      const blob = await sandbox.fs.readBinary(path)
      return new Uint8Array(await blob.arrayBuffer())
    } catch (err) {
      if (isNotFound(err)) return null
      throw err
    }
  }

  // writeBinary must get bytes: a string is read as a LOCAL file path. Blaxel
  // does not document whether writes create parent folders, so a failed write
  // retries once after mkdir -p.
  const writeBytes = async (path: string, bytes: Uint8Array): Promise<void> => {
    try {
      await sandbox.fs.writeBinary(path, bytes)
    } catch {
      await run({ command: `mkdir -p ${shellQuote(posix.dirname(path))}` })
      await sandbox.fs.writeBinary(path, bytes)
    }
  }

  // Blaxel limits waitForCompletion to 60 seconds and documents a named
  // process plus a wait for longer work; the SDK's wait() always sleeps one
  // full interval, so this polls with backoff instead.
  const waitForProcess = async (name: string) => {
    const deadline = Date.now() + (RUN_TIMEOUT_SEC + 60) * 1000
    let delay = WAIT_START_MS
    for (;;) {
      const proc = await sandbox.process.get(name)
      if (proc.status !== "running") return proc
      if (Date.now() > deadline) {
        throw new Error(`Sandbox process ${name} did not finish in time`)
      }
      await new Promise((resolve) => setTimeout(resolve, delay))
      delay = Math.min(delay * 2, WAIT_MAX_MS)
    }
  }

  const run: SandboxSession["run"] = async ({
    command,
    workingDirectory,
    env,
    abortSignal,
  }) => {
    abortSignal?.throwIfAborted()
    const name = `run-${randomUUID().slice(0, 8)}`
    const onAbort = () => {
      sandbox.process.kill(name).catch(() => {})
    }
    abortSignal?.addEventListener("abort", onAbort, { once: true })
    try {
      await sandbox.process.exec({
        name,
        command: inShell(command),
        // Default to the persistent volume: the harness resolves its working
        // directory with `pwd`, so the conversation's files land on it.
        workingDir: workingDirectory ?? WORKSPACE_MOUNT,
        env: { ...SANDBOX_PROCESS_ENV, ...env },
        keepAlive: true,
        timeout: RUN_TIMEOUT_SEC,
      })
      // An abort during exec fired before the process existed.
      if (abortSignal?.aborted) onAbort()
      const result = await waitForProcess(name)
      abortSignal?.throwIfAborted()
      return {
        exitCode: result.exitCode ?? -1,
        stdout:
          result.stdout ||
          (await sandbox.process.logs(name, "stdout").catch(() => "")),
        stderr:
          result.stderr ||
          (await sandbox.process.logs(name, "stderr").catch(() => "")),
      }
    } finally {
      abortSignal?.removeEventListener("abort", onAbort)
    }
  }

  const spawn: SandboxSession["spawn"] = async ({
    command,
    workingDirectory,
    env,
    abortSignal,
  }) => {
    abortSignal?.throwIfAborted()
    const name = `spawn-${randomUUID().slice(0, 8)}`
    await sandbox.process.exec({
      name,
      command: inShell(command),
      workingDir: workingDirectory ?? WORKSPACE_MOUNT,
      env: { ...SANDBOX_PROCESS_ENV, ...env },
      keepAlive: true,
      timeout: RUN_TIMEOUT_SEC,
    })
    const kill = async () => {
      await sandbox.process.kill(name).catch(() => {})
    }
    abortSignal?.addEventListener("abort", () => void kill(), { once: true })
    let done: Promise<{ exitCode: number }> | null = null
    const handle: SandboxProcess = {
      stdout: logStream(sandbox, name, "stdout"),
      stderr: logStream(sandbox, name, "stderr"),
      wait() {
        done ??= sandbox.process
          .wait(name, {
            maxWait: (RUN_TIMEOUT_SEC + 60) * 1000,
            interval: 1000,
          })
          .then((result) => {
            abortSignal?.throwIfAborted()
            return { exitCode: result.exitCode ?? -1 }
          })
        return done
      },
      kill,
    }
    return handle
  }

  return {
    description: `Lor's sandbox for this conversation: a Linux machine with Python and Node. Files under ${WORKSPACE_MOUNT} persist between turns. No credentials for Lor's services are present.`,
    run,
    spawn,
    readBinaryFile: ({ path }) => readBytes(path),
    readFile: async ({ path }) => {
      const bytes = await readBytes(path)
      return bytes ? bytesStream(bytes) : null
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
