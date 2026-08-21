import { randomUUID } from "node:crypto"
import { SandboxInstance } from "@blaxel/core"
import { env } from "@repo/env/server"
import { logger } from "../logger"
import {
  createPiEventCollector,
  type PiCodeHandlers,
  type PiInvestigationUsage,
} from "./pi-events"

// The one sandbox provider. Sandboxes are Firecracker microVMs booted from
// our custom image (packages/merlin/sandbox-image, pushed via `bl push`);
// the SDK authenticates via BL_API_KEY/BL_WORKSPACE from process.env.
export function blaxelConfigured(): boolean {
  return Boolean(env.BL_API_KEY && env.BL_WORKSPACE)
}

export type BlaxelSandbox = SandboxInstance

const WORKSPACE_MOUNT = "/workspace"
const SANDBOX_PROCESS_ENV = {
  BUN_INSTALL_CACHE_DIR: `${WORKSPACE_MOUNT}/.cache/bun`,
  COREPACK_HOME: `${WORKSPACE_MOUNT}/.cache/corepack`,
  npm_config_cache: `${WORKSPACE_MOUNT}/.cache/npm`,
  npm_config_prefix: `${WORKSPACE_MOUNT}/.local`,
  npm_config_store_dir: `${WORKSPACE_MOUNT}/.cache/pnpm`,
  PIP_CACHE_DIR: `${WORKSPACE_MOUNT}/.cache/pip`,
  PYTHONUSERBASE: `${WORKSPACE_MOUNT}/.local`,
  TMPDIR: `${WORKSPACE_MOUNT}/tmp`,
  XDG_CACHE_HOME: `${WORKSPACE_MOUNT}/.cache`,
  XDG_DATA_HOME: `${WORKSPACE_MOUNT}/.local/share`,
  YARN_CACHE_FOLDER: `${WORKSPACE_MOUNT}/.cache/yarn`,
}

function baseConfig(name: string) {
  return {
    name,
    image: env.MERLIN_WORKBENCH_IMAGE,
    memory: env.MERLIN_WORKBENCH_MEMORY_MB,
    volumes: [
      {
        name: "workspace",
        mountPath: WORKSPACE_MOUNT,
        type: "ephemeral" as const,
        sizeMb: env.MERLIN_WORKBENCH_DISK_MB,
      },
    ],
  }
}

function persistentLifecycle(idleTtl: string) {
  return {
    expirationPolicies: [
      {
        action: "delete" as const,
        type: "ttl-idle" as const,
        value: idleTtl,
      },
    ],
  }
}

function persistentConfig(name: string, idleTtl: string) {
  return {
    ...baseConfig(name),
    lifecycle: persistentLifecycle(idleTtl),
  }
}

function hasWorkspaceDisk(sandbox: SandboxInstance): boolean {
  return Boolean(
    sandbox.spec.volumes?.some(
      (volume) =>
        volume.mountPath === WORKSPACE_MOUNT &&
        volume.type === "ephemeral" &&
        (volume.sizeMb ?? 0) >= env.MERLIN_WORKBENCH_DISK_MB
    )
  )
}

function hasIdleTtl(sandbox: SandboxInstance, idleTtl: string): boolean {
  const policies = sandbox.spec.lifecycle?.expirationPolicies
  return Boolean(
    policies?.length === 1 &&
      policies[0]?.action === "delete" &&
      policies[0].type === "ttl-idle" &&
      policies[0].value === idleTtl
  )
}

const SANDBOX_HEALTH_TIMEOUT_SEC = 10

type SandboxHealth = {
  healthy: boolean
  status: string
  exitCode: number
}

async function probeSandbox(sandbox: SandboxInstance): Promise<SandboxHealth> {
  const result = await sandbox.process.exec({
    name: `health-${randomUUID().slice(0, 8)}`,
    command: "true",
    waitForCompletion: true,
    timeout: SANDBOX_HEALTH_TIMEOUT_SEC,
  })
  return {
    healthy: result.status === "completed" && result.exitCode === 0,
    status: result.status ?? "unknown",
    exitCode: result.exitCode ?? -1,
  }
}

async function healthyPersistentSandbox(
  name: string,
  idleTtl: string
): Promise<SandboxInstance> {
  let sandbox = await SandboxInstance.createIfNotExists(
    persistentConfig(name, idleTtl)
  )

  let replacementReason = "missing or undersized workspace volume"
  let health: SandboxHealth | null = null
  if (hasWorkspaceDisk(sandbox)) {
    try {
      health = await probeSandbox(sandbox)
    } catch (err) {
      closeConnection(sandbox)
      logger.error({ err, sandbox: name }, "Sandbox: health probe failed")
      throw err
    }
    if (health.healthy) {
      if (hasIdleTtl(sandbox, idleTtl)) return sandbox

      const original = sandbox
      try {
        sandbox = await SandboxInstance.updateLifecycle(
          name,
          persistentLifecycle(idleTtl)
        )
      } catch (err) {
        closeConnection(original)
        logger.error({ err, sandbox: name }, "Sandbox: lifecycle update failed")
        throw err
      }
      closeConnection(original)
      logger.info(
        { sandbox: name, idleTtl },
        "Sandbox: persistent lifecycle updated"
      )
      return sandbox
    }
    replacementReason = `health probe ${health.status}, exit ${health.exitCode}`
  }

  logger.warn(
    { sandbox: name, reason: replacementReason },
    "Sandbox: persistent sandbox needs replacement"
  )
  closeConnection(sandbox)
  await SandboxInstance.delete(name)

  sandbox = await SandboxInstance.createIfNotExists(
    persistentConfig(name, idleTtl)
  )
  if (!hasWorkspaceDisk(sandbox)) {
    closeConnection(sandbox)
    throw new Error(`replacement sandbox ${name} has no workspace volume`)
  }

  try {
    health = await probeSandbox(sandbox)
  } catch (err) {
    closeConnection(sandbox)
    logger.error(
      { err, sandbox: name },
      "Sandbox: replacement health probe failed"
    )
    throw err
  }
  if (!health.healthy) {
    closeConnection(sandbox)
    throw new Error(
      `replacement sandbox ${name} is unhealthy (${health.status}, exit ${health.exitCode})`
    )
  }
  logger.info({ sandbox: name }, "Sandbox: persistent sandbox replaced")
  return sandbox
}

// Close our HTTP/2 session so the sandbox's "active connection" ends now —
// otherwise it idles in active (billed) mode for up to 15 minutes.
function closeConnection(sandbox: SandboxInstance): void {
  try {
    sandbox.h2Session?.close()
  } catch {}
}

// Ephemeral sandbox: created for one session, deleted in finally. The
// ttl-max-age policy is the backstop if the worker dies mid-session.
export async function withEphemeralSandbox<T>(
  prefix: string,
  fn: (sandbox: SandboxInstance) => Promise<T>
): Promise<T> {
  const name = `${prefix}-${randomUUID()}`
  const sandbox = await SandboxInstance.create({
    ...baseConfig(name),
    lifecycle: {
      expirationPolicies: [
        {
          action: "delete" as const,
          type: "ttl-max-age" as const,
          value: "2h",
        },
      ],
    },
  })
  logger.info({ sandbox: name }, "Sandbox: created")
  try {
    return await fn(sandbox)
  } finally {
    closeConnection(sandbox)
    await SandboxInstance.delete(name).then(
      () => logger.info({ sandbox: name }, "Sandbox: deleted"),
      (err) => logger.error({ err, sandbox: name }, "Sandbox: delete failed")
    )
  }
}

// A named sandbox persists across sessions: it drops to standby (free)
// between them and resumes with its filesystem intact. If the idle TTL
// deletes it, tasks reseed durable artifacts and code sessions re-clone;
// unpublished code changes exist only until the code sandbox TTL expires.
export async function withPersistentSandbox<T>(
  name: string,
  idleTtl: string,
  fn: (sandbox: SandboxInstance) => Promise<T>
): Promise<T> {
  const sandbox = await healthyPersistentSandbox(name, idleTtl)
  logger.info({ sandbox: name }, "Sandbox: persistent sandbox ready")
  try {
    return await fn(sandbox)
  } finally {
    closeConnection(sandbox)
  }
}

// A task's sandbox: Pi session, scripts, and scratch survive between runs.
export async function withTaskSandbox<T>(
  taskId: string,
  fn: (sandbox: SandboxInstance) => Promise<T>
): Promise<T> {
  return withPersistentSandbox(
    `task-${taskId}`,
    env.MERLIN_WORKBENCH_SANDBOX_TTL,
    fn
  )
}

// writeBinary interprets a string argument as a LOCAL file path to read —
// text content must be encoded to bytes first.
export async function writeText(
  sandbox: SandboxInstance,
  path: string,
  text: string
): Promise<void> {
  await sandbox.fs.writeBinary(path, new TextEncoder().encode(text))
}

export type SandboxExecResult = {
  status: "completed" | "running" | "failed" | "killed" | "stopped" | "lost"
  exitCode: number
  stdout: string
  stderr: string
}

const STDOUT_POLL_MS = 1500

// Run one command to completion. keepAlive pins the sandbox awake for the
// whole run (no mid-session standby) and enforces `timeoutSec` as an
// auto-kill; a timed-out process surfaces as status "killed". Live stdout is
// POLLED from the authoritative process record — the push stream
// (process/logs/stream) drops lines under load, which starved the nested
// tool-event UX — and delivered to onStdout on newline boundaries, with the
// final tail flushed from the complete stdout after completion.
export async function execToCompletion(
  sandbox: SandboxInstance,
  opts: {
    command: string
    timeoutSec: number
    workingDir?: string
    env?: Record<string, string>
    abortSignal?: AbortSignal
    onStdout?: (chunk: string) => void
  }
): Promise<SandboxExecResult> {
  if (opts.abortSignal?.aborted) {
    return { status: "stopped", exitCode: -1, stdout: "", stderr: "" }
  }
  const name = `exec-${randomUUID().slice(0, 8)}`
  await sandbox.process.exec({
    name,
    command: opts.command,
    ...(opts.workingDir ? { workingDir: opts.workingDir } : {}),
    ...(opts.env ? { env: opts.env } : {}),
    keepAlive: true,
    timeout: opts.timeoutSec,
  })

  let seen = 0
  let pollStop = false
  const deliver = (chunk: string) => {
    if (!chunk) return
    try {
      opts.onStdout?.(chunk)
    } catch {}
  }
  const poller = opts.onStdout
    ? (async () => {
        while (!pollStop) {
          await new Promise((resolve) => setTimeout(resolve, STDOUT_POLL_MS))
          if (pollStop) return
          const stdout = await sandbox.process
            .logs(name, "stdout")
            .catch(() => null)
          if (pollStop || !stdout || stdout.length <= seen) continue
          // Whole lines only — a snapshot can end mid-line, and a partial
          // JSON line would be dropped by the consumer, losing the event.
          const cut = stdout.lastIndexOf("\n")
          if (cut < seen) continue
          const chunk = stdout.slice(seen, cut + 1)
          seen = cut + 1
          deliver(chunk)
        }
      })()
    : null
  const finishPolling = async (finalStdout: string) => {
    pollStop = true
    if (!poller) return
    await poller
    if (finalStdout.length > seen) deliver(finalStdout.slice(seen))
  }

  const onAbort = () => {
    sandbox.process.kill(name).catch(() => {})
  }
  opts.abortSignal?.addEventListener("abort", onAbort, { once: true })
  // An abort during the exec await fired before the listener existed.
  if (opts.abortSignal?.aborted) onAbort()
  const done = await sandbox.process
    .wait(name, { maxWait: (opts.timeoutSec + 60) * 1000, interval: 2000 })
    .catch(() => null)
  opts.abortSignal?.removeEventListener("abort", onAbort)

  if (!done) {
    // wait() gave up or errored; the process may still be running (pinning
    // the sandbox active via keepAlive) — kill it, then recover what the
    // process record has.
    await sandbox.process.kill(name).catch(() => {})
    const stdout = await sandbox.process.logs(name, "stdout").catch(() => "")
    const stderr = await sandbox.process.logs(name, "stderr").catch(() => "")
    await finishPolling(stdout)
    return { status: "lost", exitCode: -1, stdout, stderr }
  }
  const stdout =
    done.stdout || (await sandbox.process.logs(name, "stdout").catch(() => ""))
  await finishPolling(stdout)
  return {
    status: done.status,
    exitCode: done.exitCode,
    stdout,
    stderr:
      done.stderr ||
      (await sandbox.process.logs(name, "stderr").catch(() => "")),
  }
}

export type PiRunResult = {
  result: SandboxExecResult
  findings: string
  usage?: PiInvestigationUsage
  error?: string
}

// Run a Pi command: live events feed onStep/onAssistantText (sub-tool and
// streamed-summary UX), the authoritative findings/usage/error are parsed
// from the complete stdout after completion.
export async function runPi(
  sandbox: SandboxInstance,
  opts: PiCodeHandlers & {
    command: string
    timeoutSec: number
    workingDir: string
    abortSignal?: AbortSignal
    logLabel: string
  }
): Promise<PiRunResult> {
  const live = createPiEventCollector({
    onStep: (step) => {
      logger.info(
        { subTool: step.toolName },
        `${opts.logLabel}: agent tool call`
      )
      opts.onStep?.(step)
    },
    ...(opts.onAssistantText ? { onAssistantText: opts.onAssistantText } : {}),
  })

  const result = await execToCompletion(sandbox, {
    command: opts.command,
    timeoutSec: opts.timeoutSec,
    workingDir: opts.workingDir,
    env: {
      ...SANDBOX_PROCESS_ENV,
      AI_GATEWAY_API_KEY: env.AI_GATEWAY_API_KEY,
      IS_SANDBOX: "1",
    },
    abortSignal: opts.abortSignal,
    // Polled delivery: each chunk is one or more complete NDJSON lines.
    onStdout: (output) => live.consumeOutput(output),
  })

  const collector = createPiEventCollector()
  collector.consumeOutput(result.stdout)
  const collected = collector.result()
  return {
    result,
    findings: collected.findings,
    ...(collected.usage ? { usage: collected.usage } : {}),
    ...(collected.error ? { error: collected.error } : {}),
  }
}
