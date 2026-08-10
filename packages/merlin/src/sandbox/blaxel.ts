import { randomUUID } from "node:crypto"
import { SandboxInstance } from "@blaxel/core"
import { env } from "@repo/env/server"
import { logger } from "../logger"
import {
  createPiEventCollector,
  type PiCodeStep,
  type PiInvestigationUsage,
} from "./pi-events"

// The one sandbox provider. Sandboxes are Firecracker microVMs booted from
// our custom image (packages/merlin/sandbox-image, pushed via `bl push`);
// the SDK authenticates via BL_API_KEY/BL_WORKSPACE from process.env.
export function blaxelConfigured(): boolean {
  return Boolean(env.BL_API_KEY && env.BL_WORKSPACE)
}

export type BlaxelSandbox = SandboxInstance

function baseConfig(name: string) {
  return {
    name,
    image: env.MERLIN_WORKBENCH_IMAGE,
    memory: env.MERLIN_WORKBENCH_MEMORY_MB,
  }
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

// A task's sandbox persists across runs: it drops to standby (free) between
// sessions and resumes with its filesystem — Pi session, scripts, scratch —
// intact. If the idle TTL deleted it, createIfNotExists rebuilds it cold and
// the artifact reseed restores the deliverables: deletion only costs warmth.
export async function withTaskSandbox<T>(
  taskId: string,
  fn: (sandbox: SandboxInstance) => Promise<T>
): Promise<T> {
  const name = `task-${taskId}`
  const sandbox = await SandboxInstance.createIfNotExists({
    ...baseConfig(name),
    lifecycle: {
      expirationPolicies: [
        {
          action: "delete" as const,
          type: "ttl-idle" as const,
          value: env.MERLIN_WORKBENCH_SANDBOX_TTL,
        },
      ],
    },
  })
  logger.info({ sandbox: name }, "Sandbox: task sandbox ready")
  try {
    return await fn(sandbox)
  } finally {
    closeConnection(sandbox)
  }
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

// Run one command to completion. keepAlive pins the sandbox awake for the
// whole run (no mid-session standby) and enforces `timeoutSec` as an
// auto-kill; a timed-out process surfaces as status "killed". The optional
// live stdout stream drives UX only — it can attach late and miss lines, so
// callers needing complete output must use the returned stdout, which is
// fetched from the process record after completion.
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
  const started = await sandbox.process.exec({
    name,
    command: opts.command,
    ...(opts.workingDir ? { workingDir: opts.workingDir } : {}),
    ...(opts.env ? { env: opts.env } : {}),
    keepAlive: true,
    timeout: opts.timeoutSec,
    ...(opts.onStdout ? { onStdout: opts.onStdout } : {}),
  })

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
  if ("close" in started) started.close()

  if (!done) {
    // wait() gave up or errored; the process may still be running (pinning
    // the sandbox active via keepAlive) — kill it, then recover what the
    // process record has.
    await sandbox.process.kill(name).catch(() => {})
    const stdout = await sandbox.process.logs(name, "stdout").catch(() => "")
    const stderr = await sandbox.process.logs(name, "stderr").catch(() => "")
    return { status: "lost", exitCode: -1, stdout, stderr }
  }
  return {
    status: done.status,
    exitCode: done.exitCode,
    stdout:
      done.stdout ||
      (await sandbox.process.logs(name, "stdout").catch(() => "")),
    stderr: done.stderr ?? "",
  }
}

export type PiRunResult = {
  result: SandboxExecResult
  findings: string
  usage?: PiInvestigationUsage
  error?: string
}

// Run a Pi command: live events feed onStep (sub-tool UX), the authoritative
// findings/usage/error are parsed from the complete stdout after completion.
export async function runPi(
  sandbox: SandboxInstance,
  opts: {
    command: string
    timeoutSec: number
    workingDir: string
    abortSignal?: AbortSignal
    onStep?: (step: PiCodeStep) => void
    logLabel: string
  }
): Promise<PiRunResult> {
  const live = createPiEventCollector((step) => {
    logger.info({ subTool: step.toolName }, `${opts.logLabel}: agent tool call`)
    opts.onStep?.(step)
  })
  let buffer = ""
  const onLine = (line: string) => {
    live.consume(line)
  }

  const result = await execToCompletion(sandbox, {
    command: opts.command,
    timeoutSec: opts.timeoutSec,
    workingDir: opts.workingDir,
    env: { AI_GATEWAY_API_KEY: env.AI_GATEWAY_API_KEY, IS_SANDBOX: "1" },
    abortSignal: opts.abortSignal,
    onStdout: (chunk) => {
      buffer += chunk
      let nl = buffer.indexOf("\n")
      while (nl >= 0) {
        onLine(buffer.slice(0, nl))
        buffer = buffer.slice(nl + 1)
        nl = buffer.indexOf("\n")
      }
    },
  })
  if (buffer.trim()) onLine(buffer)

  const collector = createPiEventCollector()
  for (const line of result.stdout.split("\n")) collector.consume(line)
  const collected = collector.result()
  return {
    result,
    findings: collected.findings,
    ...(collected.usage ? { usage: collected.usage } : {}),
    ...(collected.error ? { error: collected.error } : {}),
  }
}
