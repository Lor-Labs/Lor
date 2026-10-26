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
// any host, writes only for git fetch and npm audit. They bind tools that use
// HTTP_PROXY/HTTPS_PROXY (curl, git, npm, pip, Python, and Node with
// NODE_USE_ENV_PROXY); raw sockets get past them. The `proxy` firewall
// ruleset that would force all traffic through is off: since 2026-10-23
// Blaxel puts ephemeral volumes only on Carbon, which has no firewalling yet.
// The network is fixed at creation, so the label marks sandboxes with the
// current limits; bump the version to replace older ones.
const EGRESS_LABEL = "lor-egress"
const EGRESS_VERSION = "1"
// Code session checkpoints push and fetch Lor's own Code Storage org with a
// token for one session branch (code-checkpoints.ts). Added without a version
// bump: a bump would replace live sandboxes and lose their work, so older
// sandboxes skip checkpoints until they are replaced.
const checkpointHost = env.CODE_STORAGE_ORG
  ? `${env.CODE_STORAGE_ORG}.code.storage`
  : null
const SESSION_NETWORK = {
  allowedDomains: [
    "GET:HEAD:OPTIONS:*",
    "POST:github.com/*git-upload-pack",
    "POST:gitlab.com/*git-upload-pack",
    "POST:bitbucket.org/*git-upload-pack",
    "POST:registry.npmjs.org/-/npm/v1/security/",
    ...(checkpointHost
      ? [
          `POST:${checkpointHost}/*git-upload-pack`,
          `POST:${checkpointHost}/*git-receive-pack`,
        ]
      : []),
  ],
  proxy: { routing: [] },
}
// Debian's git ignores SSL_CERT_FILE, so it would reject the proxy's CA.
const GIT_PROXY_CA =
  'if [ -n "$SSL_CERT_FILE" ]; then export GIT_SSL_CAINFO="$SSL_CERT_FILE"; fi; '

// Claude Code's sandbox bridge (@ai-sdk/harness-claude-code), started by the
// adapter as `node <bootstrap>/bridge.mjs …`; Claude Code inherits its env.
// The sandbox runs as root, where Claude Code refuses Bypass permissions
// unless IS_SANDBOX=1; Node trusts the proxy's CA only through
// NODE_EXTRA_CA_CERTS (code-sessions-runbook.md chunk 7a).
const CLAUDE_CODE_BRIDGE_SCRIPT = ".harness-bootstrap/claude-code/bridge.mjs"
const CLAUDE_CODE_SHELL =
  'if [ -n "$SSL_CERT_FILE" ]; then export NODE_EXTRA_CA_CERTS="$SSL_CERT_FILE"; fi; '
const CLAUDE_CODE_ENV = {
  IS_SANDBOX: "1",
  DISABLE_AUTOUPDATER: "1",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
}

// A Claude Code turn (code-sessions-runbook.md chunk 7): the sandbox may
// POST to Anthropic's API, and the proxy fills in the turn owner's
// subscription token wherever Claude Code sends this placeholder, so the
// token never enters the sandbox. Sandbox code can use the placeholder too
// while the rule exists: grant it for the owner's own turn and revoke it
// when the turn ends. Network changes apply to a running sandbox.
export const CLAUDE_TOKEN_PLACEHOLDER = "{{SECRET:claude}}"
const CLAUDE_API_HOST = "api.anthropic.com"

export async function grantClaudeAccess(
  owner: HarnessOwner,
  token: string
): Promise<void> {
  await SandboxInstance.updateNetwork(sessionSandboxName(owner), {
    network: {
      allowedDomains: [
        ...SESSION_NETWORK.allowedDomains,
        `POST:${CLAUDE_API_HOST}/*`,
      ],
      proxy: {
        routing: [
          {
            destinations: [CLAUDE_API_HOST],
            headers: {},
            secrets: { claude: token },
          },
        ],
      },
    },
  })
}

export async function revokeClaudeAccess(owner: HarnessOwner): Promise<void> {
  await SandboxInstance.updateNetwork(sessionSandboxName(owner), {
    network: SESSION_NETWORK,
  })
}

// The worker reaches a sandbox's Claude Code bridge through a private
// preview on this port (8080 is Blaxel's sandbox API), with a token per turn.
export const CLAUDE_CODE_BRIDGE_PORT = 8790
const BRIDGE_PREVIEW_TOKEN_TTL_MS = 60 * 60 * 1000

export async function claudeCodeBridgeEndpoint(
  owner: HarnessOwner
): Promise<{ url: string; headers: Record<string, string> }> {
  const sandbox = await SandboxInstance.get(sessionSandboxName(owner))
  try {
    const preview = await sandbox.previews.createIfNotExists({
      metadata: { name: "claude-code-bridge" },
      spec: { port: CLAUDE_CODE_BRIDGE_PORT, public: false },
    })
    const url = (preview.spec as { url?: string }).url
    if (!url) throw new Error("The Claude Code bridge preview has no URL")
    const token = await preview.tokens.create(
      new Date(Date.now() + BRIDGE_PREVIEW_TOKEN_TTL_MS)
    )
    return {
      url: url.replace(/^http/, "ws"),
      headers: { "X-Blaxel-Preview-Token": token.value },
    }
  } finally {
    closeConnection(sandbox)
  }
}

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
  // With keepBridges: a Claude Code bridge still runs, holding a paused turn.
  bridgeRunning?: boolean
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
// Claude Code bridges (bridge-*) go too, unless this run continues the turn
// one of them is parked on.
// Returns whether a kept bridge is still running. A failed list reads as no
// bridge: continuing a paused turn through a dead bridge never settles.
async function stopLeftoverCommands(
  sandbox: SandboxInstance,
  name: string,
  keepBridges: boolean
): Promise<boolean> {
  const fenced = keepBridges ? /^(run|spawn)-/ : /^(run|spawn|bridge)-/
  const running = await sandbox.process
    .list()
    .then((records) => records.filter((record) => record.status === "running"))
    .catch((err: unknown) => {
      logger.warn({ err, sandbox: name }, "Sandbox: process list failed")
      return []
    })
  const bridgeRunning =
    keepBridges && running.some((record) => record.name.startsWith("bridge-"))
  const leftover = running.filter((record) => fenced.test(record.name))
  if (leftover.length === 0) return bridgeRunning
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
  return bridgeRunning
}

export async function openSessionSandbox(
  owner: HarnessOwner,
  options: { keepBridges?: boolean } = {}
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
      const bridgeRunning = await stopLeftoverCommands(
        existing,
        name,
        options.keepBridges ?? false
      )
      return {
        session: blaxelSandboxSession(existing),
        fresh: false,
        bridgeRunning,
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

// People's actions on a session's files (the Changes panel) use the sandbox
// as it is: never create one, and never stop a run's commands. Null when it
// is gone.
export async function attachSessionSandbox(
  owner: HarnessOwner
): Promise<SessionSandbox | null> {
  if (!blaxelConfigured()) return null
  const existing = await SandboxInstance.get(sessionSandboxName(owner)).catch(
    (err: unknown) => {
      if (isNotFound(err)) return null
      throw err
    }
  )
  if (!existing) return null
  return {
    session: blaxelSandboxSession(existing),
    fresh: false,
    close: () => closeConnection(existing),
  }
}

// A code session's restore from the Changes panel: the sandbox as it is, or a
// new one when it is gone. Like attachSessionSandbox it never stops a run's
// commands or replaces an unhealthy sandbox; the worker does that.
export async function attachOrCreateSessionSandbox(
  owner: HarnessOwner
): Promise<SessionSandbox | null> {
  const existing = await attachSessionSandbox(owner)
  if (existing || !blaxelConfigured()) return existing
  const created = await createSessionSandbox(sessionSandboxName(owner))
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

// SANDBOX_PROCESS_ENV points TMPDIR at the workspace disk, which starts
// without that folder; mktemp and others fail until it exists.
const ENSURE_TMPDIR = 'mkdir -p "$TMPDIR" 2>/dev/null; '

function inShell(command: string): string {
  return `bash -c ${shellQuote(GIT_PROXY_CA + ENSURE_TMPDIR + command)}`
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
// drops lines under load (see execToCompletion in blaxel.ts). `ended` closes
// the stream while the process keeps running.
function logStream(
  sandbox: SandboxInstance,
  name: string,
  type: "stdout" | "stderr",
  ended: (text: string) => boolean = () => false
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let seen = 0
  let closing = false
  return new ReadableStream({
    async pull(controller) {
      if (closing) {
        controller.close()
        return
      }
      for (;;) {
        // Status first: output written before the process ended is then in logs.
        const proc = await sandbox.process.get(name).catch(() => null)
        const text = await sandbox.process.logs(name, type).catch(() => "")
        if (text.length > seen) {
          controller.enqueue(encoder.encode(text.slice(seen)))
          seen = text.length
          closing = ended(text)
          return
        }
        if (ended(text) || !proc || proc.status !== "running") {
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
      // Process summaries can contain truncation notices. Read the full logs
      // so file lists, diffs and previews receive the actual command output.
      const [stdout, stderr] = await Promise.all([
        sandbox.process.logs(name, "stdout"),
        sandbox.process.logs(name, "stderr"),
      ])
      abortSignal?.throwIfAborted()
      return {
        exitCode: result.exitCode ?? -1,
        stdout,
        stderr,
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
    const bridge = command.includes(CLAUDE_CODE_BRIDGE_SCRIPT)
    const name = `${bridge ? "bridge" : "spawn"}-${randomUUID().slice(0, 8)}`
    await sandbox.process.exec({
      name,
      command: inShell(bridge ? `${CLAUDE_CODE_SHELL}${command}` : command),
      workingDir: workingDirectory ?? WORKSPACE_MOUNT,
      env: {
        ...SANDBOX_PROCESS_ENV,
        ...(bridge ? CLAUDE_CODE_ENV : {}),
        ...env,
      },
      // A bridge outlives its turn while it waits on an approval: no time
      // limit, and no keepAlive, so the sandbox can go to standby meanwhile.
      ...(bridge ? {} : { keepAlive: true, timeout: RUN_TIMEOUT_SEC }),
    })
    const kill = async () => {
      await sandbox.process.kill(name).catch(() => {})
    }
    abortSignal?.addEventListener("abort", () => void kill(), { once: true })
    // An abort during exec fired before the process existed.
    if (abortSignal?.aborted) void kill()
    // The adapter reads a bridge's output for as long as it runs. Once it
    // printed bridge-ready, both streams end, so nothing polls the sandbox
    // (and keeps it awake) while the bridge waits.
    let bridgeReady = false
    const readyIn = (text: string) => {
      if (bridge && text.includes('"bridge-ready"')) bridgeReady = true
      return bridgeReady
    }
    let done: Promise<{ exitCode: number }> | null = null
    const handle: SandboxProcess = {
      stdout: logStream(sandbox, name, "stdout", readyIn),
      stderr: logStream(sandbox, name, "stderr", () => bridgeReady),
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
