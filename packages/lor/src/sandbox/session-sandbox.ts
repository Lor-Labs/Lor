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
import { guardSandbox } from "./beta-compute"
import {
  baseConfig,
  blaxelConfigured,
  closeConnection,
  hasWorkspaceDisk,
  isSandboxGatewayError,
  isWorkloadUnavailable,
  persistentLifecycle,
  probeSandbox,
  SANDBOX_PROCESS_ENV,
  WORKSPACE_MOUNT,
  whileSandboxStarts,
} from "./blaxel"
import {
  type BoatSandbox,
  boatConfigured,
  boatExec,
  boatSandboxExists,
  boatSandboxSession,
  boatStatus,
  createBoatSandbox,
  deleteBoatSandbox,
  findBoatSandbox,
  hostBoatPort,
  stopBoatLeftovers,
} from "./boat"

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

// Egress is open (Jacob, 2026-10-28; reference/dev-environment-runbook.md
// §2): dev servers and env files need to reach their APIs. The proxy stays
// for per-turn credential routing (grantHarnessAccess). updateNetwork
// replaces the whole config (checked 2026-10-29).
//
// The proxy exists only in a sandbox created with it, and Blaxel cannot add
// it later. Version 2 (2026-10-29) created sandboxes with nothing but an empty
// routing list, which Blaxel does not count as a proxy: they have no
// HTTPS_PROXY and no proxy CA, and reach Anthropic directly (checked
// 2026-11-02 in a production session sandbox: real certificate, and the
// placeholder answered "401 Invalid bearer token"). So no routing rule could
// ever fill a Claude Code or Codex turn's credential there — the 401 every
// production Claude Code turn has failed with. Version 3 creates the proxy
// with a domain filter again, as version 1 did (its "GET:HEAD:OPTIONS:*" is
// the syntax Blaxel accepted then), now allowing every method to every host,
// so egress stays as open as version 2's.
const EGRESS_LABEL = "lor-egress"
const EGRESS_VERSION = "3"
// Version 1 was made with the GET-only allowlist, so it has the proxy and is
// opened in place when next used. Version 2 is kept for Lor's own turns,
// which need no proxy, and replaced for a Claude Code or Codex turn
// (openSessionSandbox's `proxy`), which cannot work without one.
const OLD_EGRESS_VERSIONS = new Set(["1", "2"])
const PROXYLESS_EGRESS_VERSIONS = new Set(["2"])
const OPEN_EGRESS = ["GET:HEAD:OPTIONS:POST:PUT:PATCH:DELETE:*"]
const SESSION_NETWORK = {
  allowedDomains: OPEN_EGRESS,
  proxy: { routing: [] },
}
// Debian's git ignores SSL_CERT_FILE, so it would reject the proxy's CA.
const GIT_PROXY_CA =
  'if [ -n "$SSL_CERT_FILE" ]; then export GIT_SSL_CAINFO="$SSL_CERT_FILE"; fi; '

// A harness's sandbox bridge (@ai-sdk/harness-claude-code or -codex), started
// by the adapter as `node <bootstrap>/<harness>/bridge.mjs …`; the CLI it
// runs inherits its env. Node trusts the proxy's CA only through
// NODE_EXTRA_CA_CERTS (code-sessions-runbook.md chunk 7a). The sandbox runs
// as root, where Claude Code refuses Bypass permissions unless IS_SANDBOX=1.
// Claude Code's auto memory is off: its notes live only in the sandbox,
// outlive rewinds and are shared by everyone's turns, and Lor keeps the
// team's memory. Codex's settings are in the image (~/.codex/config.toml).
const HARNESS_BRIDGE_SCRIPT = /\.harness-bootstrap\/([a-z-]+)\/bridge\.mjs/
const BRIDGE_SHELL =
  'if [ -n "$SSL_CERT_FILE" ]; then export NODE_EXTRA_CA_CERTS="$SSL_CERT_FILE"; fi; '
const CLAUDE_CODE_ENV = {
  IS_SANDBOX: "1",
  DISABLE_AUTOUPDATER: "1",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
}

// A harness turn's model credential (code-sessions-runbook.md chunks 7 and
// 8): the proxy fills in the credential wherever the CLI sends its
// placeholder to the model API, so it never enters the sandbox. Claude Code
// uses the turn owner's subscription token, Codex their ChatGPT access token.
// Sandbox code can use the placeholder too while the rule exists: grant it for
// the turn and revoke it when the turn ends. Network changes apply to a
// running sandbox, so a long Codex turn is granted its refreshed token.
export const CLAUDE_TOKEN_PLACEHOLDER = "{{SECRET:claude}}"
export const CHATGPT_TOKEN_PLACEHOLDER = "{{SECRET:chatgpt}}"
const CLAUDE_API_HOST = "api.anthropic.com"
const CHATGPT_HOST = "chatgpt.com"

export type HarnessAccess = { claudeToken: string } | { chatgptToken: string }

// Boat has no proxy: a turn on a Boat sandbox passes the credential itself in
// place of the placeholder (SessionSandbox.provider), so these do nothing.
export async function grantHarnessAccess(
  owner: HarnessOwner,
  access: HarnessAccess
): Promise<void> {
  const [host, secrets] =
    "claudeToken" in access
      ? [CLAUDE_API_HOST, { claude: access.claudeToken }]
      : [CHATGPT_HOST, { chatgpt: access.chatgptToken }]
  if (await onBoat(owner)) return
  await SandboxInstance.updateNetwork(sessionSandboxName(owner), {
    network: {
      // The session's own open filter, unchanged for the turn: the routing
      // rule alone carries the credential (Blaxel's filter and routing are
      // independent). #214's `["*", host]` is gone with it: `*` is not a
      // syntax Blaxel documents, and in a sandbox that has the proxy it could
      // have blocked a turn's own clone and POST traffic.
      ...SESSION_NETWORK,
      proxy: { routing: [{ destinations: [host], headers: {}, secrets }] },
    },
  })
}

// One request that exercises the turn's credential path, for the failure log
// when a turn dies on Anthropic's 401: it sends exactly what the CLI sends —
// the placeholder, through the sandbox proxy, while the rule is granted — and
// reports the status Anthropic answered, with the message from its error body
// when there is one. Read it with the worker's own `storedTokenCheck`
// (claudeStoredTokenCheck). What that pair establishes, and what it does not:
//   - "200": the proxy substituted a token Anthropic accepted.
//   - "401" beside a rejected stored token: the stored token is what failed,
//     and this says nothing about the sandbox path.
//   - "401" beside an accepted stored token: the sandbox request did not
//     authenticate with a token Anthropic currently accepts. That is all the
//     status proves — an unresolved placeholder and a token Anthropic refused
//     are the same 401, so a 401 is *not* evidence that substitution worked,
//     nor that it failed. The body's message is what points at one of the
//     two: 7a's spike saw the literal placeholder answered "Invalid bearer
//     token", while an expired or revoked OAuth token is answered in other
//     words. That is Anthropic's wording, not a measurement of the proxy,
//     so it narrows the failure without naming the cause.
//   - A leading "proxy set|unset|unknown" is the sandbox's own HTTPS_PROXY:
//     "unset" puts the sandbox outside the proxy altogether, where no routing
//     rule can resolve the placeholder and the token is not the question.
// Never fails or delays the turn it watches: "aborted" when the turn's signal
// stopped it, "probe failed: …" otherwise. Temporary: it exists to label the
// 401 that Claude Code turns fail with in production.
const CREDENTIAL_PROBE_TIMEOUT_SEC = 20
const PROBE_TEXT_MAX_CHARS = 200
// curl prints the marker and status after the body, so one run returns both.
const PROBE_STATUS_MARKER = "\nSTATUS "

// The message Anthropic puts in an error body; trimmed, never a credential.
function credentialMessage(body: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null) return null
  const error = (parsed as { error?: unknown }).error
  if (typeof error !== "object" || error === null) return null
  const message = (error as { message?: unknown }).message
  return typeof message === "string" && message.length > 0
    ? message.slice(0, PROBE_TEXT_MAX_CHARS)
    : null
}

export async function probeClaudeCredential(
  session: SandboxSession,
  abortSignal?: AbortSignal
): Promise<string> {
  try {
    const result = await session.run({
      command:
        // Whether the sandbox is even pointed at the proxy. The placeholder
        // is resolved by that proxy, so a sandbox with no proxy in its path
        // reaches Anthropic with the literal placeholder and answers the
        // same 401 as a proxy that resolved nothing — and the token cannot be
        // at fault in the first case. Says set/unset only, never the URL.
        'if [ -n "$HTTPS_PROXY" ]; then echo "PROXY_ENV set"; ' +
        'else echo "PROXY_ENV unset"; fi; ' +
        "curl -sS " +
        `--max-time ${CREDENTIAL_PROBE_TIMEOUT_SEC} ` +
        `-H 'Authorization: Bearer ${CLAUDE_TOKEN_PLACEHOLDER}' ` +
        "-H 'anthropic-version: 2023-06-01' " +
        "-H 'anthropic-beta: oauth-2025-04-20' " +
        "-w '\\nSTATUS %{http_code}' " +
        `'https://${CLAUDE_API_HOST}/v1/models?limit=1'`,
      workingDirectory: WORKSPACE_MOUNT,
      ...(abortSignal ? { abortSignal } : {}),
    })
    // Not trimmed first: an empty body leaves the marker as the first line.
    const text = result.stdout
    // Printed first, so only the start of the output is read for it.
    const proxyMatch = /^PROXY_ENV (set|unset)\n/.exec(text)
    const proxyEnv = proxyMatch?.[1] ?? "unknown"
    const marker = text.lastIndexOf(PROBE_STATUS_MARKER)
    const status =
      marker === -1
        ? null
        : text.slice(marker + PROBE_STATUS_MARKER.length).trim()
    // The proxy line is this probe's own; Anthropic's body is what is left.
    const body =
      marker === -1
        ? ""
        : text.slice(proxyMatch ? proxyMatch[0].length : 0, marker)
    // curl writes 000 when the request never completed; its exit code says why.
    if (result.exitCode !== 0)
      return status !== null && status !== "000"
        ? `proxy ${proxyEnv}; ${status} (curl exit ${result.exitCode})`
        : `proxy ${proxyEnv}; curl exit ${result.exitCode}`
    if (status === null) return `proxy ${proxyEnv}; no status`
    const message = credentialMessage(body)
    return `proxy ${proxyEnv}; ${message ? `${status}: ${message}` : status}`
  } catch (err) {
    // The turn is what matters: a probe that could not run reports itself.
    if (abortSignal?.aborted) return "aborted"
    const message = err instanceof Error ? err.message : String(err)
    return `probe failed: ${message.slice(0, PROBE_TEXT_MAX_CHARS)}`
  }
}

export async function revokeHarnessAccess(owner: HarnessOwner): Promise<void> {
  if (await onBoat(owner)) return
  await SandboxInstance.updateNetwork(sessionSandboxName(owner), {
    network: SESSION_NETWORK,
  })
}

// The worker reaches a sandbox's harness bridge through a private preview on
// this port (8080 is Blaxel's sandbox API), with a token per turn.
export const HARNESS_BRIDGE_PORT = 8790
const BRIDGE_PREVIEW_TOKEN_TTL_MS = 60 * 60 * 1000

export async function harnessBridgeEndpoint(
  owner: HarnessOwner
): Promise<{ url: string; headers: Record<string, string> }> {
  await guardSandbox(sessionSandboxName(owner))
  const sandbox = await SandboxInstance.get(sessionSandboxName(owner)).catch(
    (err: unknown) => {
      if (isNotFound(err)) return null
      throw err
    }
  )
  if (!sandbox) {
    const boat = await findBoatSandbox(sessionSandboxName(owner))
    if (!boat) throw new Error("The session's sandbox is gone")
    const hosted = await hostBoatPort(boat, HARNESS_BRIDGE_PORT, "private")
    const url = new URL(hosted.url.replace(/^http/, "ws"))
    // Boat's query token sets a cookie via redirect; the bridge WebSocket
    // client does not follow redirects. Authenticate the upgrade directly.
    return {
      url: url.toString(),
      headers: hosted.token
        ? { Cookie: `_port_auth=${hosted.token.value}` }
        : {},
    }
  }
  try {
    // Named in chunk 7; existing sandboxes already have it on this port.
    const preview = await sandbox.previews.createIfNotExists({
      metadata: { name: "claude-code-bridge" },
      spec: { port: HARNESS_BRIDGE_PORT, public: false },
    })
    const url = (preview.spec as { url?: string }).url
    if (!url) throw new Error("The harness bridge preview has no URL")
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

function egressVersion(sandbox: SandboxInstance): string | undefined {
  return sandbox.metadata.labels?.[EGRESS_LABEL]
}

// Made by Lor with a known network config: current, or an older one that
// openSessionSandbox brings up to date in place (not replaced for this: it
// holds the session's files; only a proxyless one is, for a harness turn).
function hasEgressLimits(sandbox: SandboxInstance): boolean {
  const version = egressVersion(sandbox)
  return (
    version === EGRESS_VERSION ||
    (version !== undefined && OLD_EGRESS_VERSIONS.has(version))
  )
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

// A sandbox being deleted (a size change replaces it) or one that failed still
// answers a lookup for a while. It counts as gone: createIfNotExists waits
// for the delete and makes the new one.
const UNUSABLE_STATUSES: ReadonlySet<string> = new Set([
  "DELETING",
  "TERMINATED",
  "FAILED",
])

async function findBlaxelSandbox(
  name: string
): Promise<SandboxInstance | null> {
  if (!blaxelConfigured()) return null
  const sandbox = await SandboxInstance.get(name).catch((err: unknown) => {
    if (isNotFound(err)) return null
    throw err
  })
  if (!sandbox || !UNUSABLE_STATUSES.has(sandbox.status ?? "")) return sandbox
  closeConnection(sandbox)
  return null
}

export function sessionSandboxName(owner: HarnessOwner): string {
  return "sessionId" in owner
    ? `ses-${owner.sessionId}`
    : `call-${owner.voiceSessionId}`
}

export type SessionSandbox = {
  session: SandboxSession
  // Boat has no credential proxy: a harness turn there passes the credential
  // in place of the placeholder (grantHarnessAccess).
  provider: "blaxel" | "boat"
  // Created on this run: the conversation's first run, or its sandbox was
  // missing or unhealthy. When earlier turns are saved, the caller tells the
  // model and the session that earlier files are gone.
  fresh: boolean
  // With keepBridges: a Claude Code bridge still runs, holding a paused turn.
  bridgeRunning?: boolean
  // Ends our connection so Blaxel can put the sandbox in standby.
  close(): void
}

// Sandboxes this process found or made on Boat.
const boatNames = new Set<string>()

async function onBoat(owner: HarnessOwner): Promise<boolean> {
  return boatNames.has(sessionSandboxName(owner))
}

function boatSessionSandbox(
  boat: BoatSandbox,
  fresh: boolean,
  bridgeRunning?: boolean
): SessionSandbox {
  boatNames.add(boat.name)
  return {
    session: boatSandboxSession(boat, {
      bridgeEnv: (bridge) => (bridge === "claude-code" ? CLAUDE_CODE_ENV : {}),
    }),
    provider: "boat",
    fresh,
    ...(bridgeRunning !== undefined ? { bridgeRunning } : {}),
    close: () => {},
  }
}

function blaxelSessionSandbox(
  sandbox: SandboxInstance,
  fresh: boolean,
  bridgeRunning?: boolean
): SessionSandbox {
  return {
    session: blaxelSandboxSession(sandbox),
    provider: "blaxel",
    fresh,
    ...(bridgeRunning !== undefined ? { bridgeRunning } : {}),
    close: () => closeConnection(sandbox),
  }
}

// The session's Boat sandbox, when it has one and Blaxel has none.
async function existingBoatSandbox(name: string): Promise<BoatSandbox | null> {
  if (!boatConfigured()) return null
  // Boat down must not stop sessions that belong on Blaxel: a failed lookup
  // counts as none (a Boat session then gets a new sandbox, like a lost one).
  const boat = await findBoatSandbox(name).catch((err: unknown) => {
    logger.error({ err, sandbox: name }, "Sandbox: Boat lookup failed")
    return null
  })
  if (boat) boatNames.add(name)
  return boat
}

// Code sessions get the larger size, or their environment's size. A sandbox
// keeps its size until it is replaced: an older, smaller code sandbox is
// still reused, since replacing it would lose installed packages and ignored
// files. When Blaxel's memory quota is full, the sandbox goes to Boat.
async function createSessionSandbox(
  name: string,
  code: boolean,
  memoryMb: number | null,
  abortSignal?: AbortSignal
): Promise<SessionSandbox> {
  await guardSandbox(name)
  const size = code
    ? (memoryMb ?? env.LOR_CODE_SANDBOX_MEMORY_MB)
    : env.LOR_WORKBENCH_MEMORY_MB
  const onBoatInstead = async (cause: unknown) => {
    const boat = await createBoatSandbox(name, size).catch((err: unknown) => {
      // Boat's own plan limits (active sandboxes, starts per day).
      if ([402, 429].includes(boatStatus(err) ?? 0))
        throw new SandboxCapacityError(cause)
      throw err
    })
    return boatSessionSandbox(boat, true)
  }
  if (
    !blaxelConfigured() ||
    (env.LOR_SANDBOX_PRIMARY === "boat" && boatConfigured())
  )
    return onBoatInstead(null)
  let sandbox: SandboxInstance
  try {
    sandbox = await SandboxInstance.createIfNotExists({
      ...(code
        ? baseConfig(name, env.LOR_CODE_SANDBOX_DISK_MB, size)
        : baseConfig(name, env.LOR_SESSION_DISK_MB)),
      lifecycle: persistentLifecycle(env.LOR_SESSION_SANDBOX_TTL),
      network: SESSION_NETWORK,
      labels: { [EGRESS_LABEL]: EGRESS_VERSION },
    })
  } catch (err) {
    if (!hasCode(err, ["QUOTA_EXCEEDED"])) throw err
    if (!boatConfigured()) throw new SandboxCapacityError(err)
    logger.warn(
      { sandbox: name },
      "Sandbox: Blaxel capacity is full; creating it on Boat"
    )
    return onBoatInstead(err)
  }
  const health = await probeSandbox(sandbox, abortSignal).catch(
    (err: unknown) => {
      closeConnection(sandbox)
      throw err
    }
  )
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
  return blaxelSessionSandbox(sandbox, true)
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

// `proxy`: the run is a Claude Code or Codex turn, whose model credential
// only Blaxel's proxy can fill in (grantHarnessAccess). `memoryMb`: a code
// session's environment size, used only when a sandbox is created.
// `beforeFencing`: awaited once an existing sandbox answers and before its
// leftover commands are stopped, so a restore or rewind running in it (its
// command is a run-* too) finishes instead of being killed.
export async function openSessionSandbox(
  owner: HarnessOwner,
  options: {
    keepBridges?: boolean
    code?: boolean
    proxy?: boolean
    memoryMb?: number | null
    abortSignal?: AbortSignal
    beforeFencing?: () => Promise<void>
  } = {}
): Promise<SessionSandbox> {
  const name = sessionSandboxName(owner)
  await guardSandbox(name)
  const existing = await findBlaxelSandbox(name)
  const boat = existing ? null : await existingBoatSandbox(name)
  if (boat) {
    // A probe error does not prove the workspace is gone (as below): only a
    // sandbox that answers unhealthy is replaced.
    const health = await boatExec(boat, { command: "true", timeoutSec: 30 })
    if (health.exitCode === 0) {
      await options.beforeFencing?.()
      const bridgeRunning = await stopBoatLeftovers(
        boat,
        options.keepBridges ?? false
      )
      return boatSessionSandbox(boat, false, bridgeRunning)
    }
    logger.warn(
      { sandbox: name },
      "Sandbox: Boat sandbox unhealthy; replacing it"
    )
    await deleteBoatSandbox(name)
  }
  const version = existing ? egressVersion(existing) : undefined
  const proxyless =
    version !== undefined && PROXYLESS_EGRESS_VERSIONS.has(version)

  if (existing && options.proxy && proxyless) {
    // Its files go, but no Claude Code or Codex turn can ever authenticate in
    // it, and the proxy cannot be added in place. The caller tells the
    // session that earlier files are gone, as for any replaced sandbox.
    logger.warn(
      { sandbox: name, egressVersion: version },
      "Sandbox: session sandbox has no credential proxy; replacing it"
    )
    closeConnection(existing)
    await SandboxInstance.delete(name)
  } else if (existing) {
    // A probe error does not prove the workspace is gone: fail the run rather
    // than delete files. Only a sandbox that answers unhealthy is replaced,
    // or one created without the current egress limits.
    const health =
      hasWorkspaceDisk(existing, env.LOR_SESSION_DISK_MB) &&
      hasEgressLimits(existing)
        ? await probeSandbox(existing, options.abortSignal).catch(
            (err: unknown) => {
              closeConnection(existing)
              throw err
            }
          )
        : null
    if (health?.healthy) {
      // Labels can't change, so this repeats on each open until the old
      // sandbox is replaced; one control-plane call. Not for a proxyless
      // one: its egress is already open, and a filter needs the proxy.
      if (version !== EGRESS_VERSION && !proxyless) {
        await SandboxInstance.updateNetwork(name, { network: SESSION_NETWORK })
      }
      await options.beforeFencing?.().catch((err: unknown) => {
        closeConnection(existing)
        throw err
      })
      const bridgeRunning = await stopLeftoverCommands(
        existing,
        name,
        options.keepBridges ?? false
      )
      return blaxelSessionSandbox(existing, false, bridgeRunning)
    }
    logger.warn(
      { sandbox: name, health },
      "Sandbox: session sandbox unhealthy; replacing it"
    )
    closeConnection(existing)
    await SandboxInstance.delete(name)
  }

  return createSessionSandbox(
    name,
    options.code ?? false,
    options.memoryMb ?? null,
    options.abortSignal
  )
}

// People's actions on a session's files (the Changes panel) use the sandbox
// as it is: never create one, and never stop a run's commands. Null when it
// is gone.
export async function attachSessionSandbox(
  owner: HarnessOwner
): Promise<SessionSandbox | null> {
  const name = sessionSandboxName(owner)
  if (!blaxelConfigured() && !boatConfigured()) return null
  await guardSandbox(name)
  const existing = await findBlaxelSandbox(name)
  if (existing) return blaxelSessionSandbox(existing, false)
  const boat = await existingBoatSandbox(name)
  return boat ? boatSessionSandbox(boat, false) : null
}

// A code session's restore from the Changes panel: the sandbox as it is, or a
// new one when it is gone. Like attachSessionSandbox it never stops a run's
// commands or replaces an unhealthy sandbox; the worker does that.
export async function attachOrCreateSessionSandbox(
  owner: HarnessOwner,
  memoryMb: () => Promise<number | null>
): Promise<SessionSandbox | null> {
  const existing = await attachSessionSandbox(owner)
  if (existing || (!blaxelConfigured() && !boatConfigured())) return existing
  return createSessionSandbox(sessionSandboxName(owner), true, await memoryMb())
}

// A turn parked on an approval keeps its sandbox out of standby (billed as
// running) while its bridge waits (code-sessions-runbook.md 7d-4a). Past its
// live window the bridge stops; the next decision finds none and drops the
// turn with a note. Never creates a sandbox. Returns how many were stopped.
export async function stopParkedBridges(owner: HarnessOwner): Promise<number> {
  const name = sessionSandboxName(owner)
  const sandbox = blaxelConfigured()
    ? await SandboxInstance.get(name).catch((err: unknown) => {
        if (isNotFound(err)) return null
        throw err
      })
    : null
  if (!sandbox) {
    const boat = await existingBoatSandbox(name)
    if (!boat) return 0
    // Fencing with no bridge kept stops every marked bridge.
    const running = await stopBoatLeftovers(boat, true)
    if (!running) return 0
    await stopBoatLeftovers(boat, false)
    return 1
  }
  try {
    const bridges = (await sandbox.process.list()).filter(
      (record) =>
        record.status === "running" && record.name.startsWith("bridge-")
    )
    await Promise.all(
      bridges.map((record) => sandbox.process.kill(record.name))
    )
    return bridges.length
  } finally {
    closeConnection(sandbox)
  }
}

// Unlike attachSessionSandbox, a failed lookup throws instead of reading as
// none, so callers about to replace the sandbox never act on a guess.
export async function sessionSandboxExists(
  owner: HarnessOwner
): Promise<boolean> {
  const name = sessionSandboxName(owner)
  if (blaxelConfigured()) {
    const sandbox = await SandboxInstance.get(name).catch((err: unknown) => {
      if (isNotFound(err)) return null
      throw err
    })
    if (sandbox) {
      closeConnection(sandbox)
      return true
    }
  }
  return boatSandboxExists(name)
}

// The conversation's files go with it; Pi's saved state and shared files
// live in Postgres and R2. A sandbox that is already gone counts as deleted.
// `strict`: a Boat delete failure throws after the Blaxel delete (a resize
// must not report a replaced sandbox that is still there).
export async function deleteSessionSandbox(
  owner: HarnessOwner,
  { strict = false }: { strict?: boolean } = {}
): Promise<void> {
  const name = sessionSandboxName(owner)
  boatNames.delete(name)
  // A Boat error never blocks deleting the Blaxel sandbox.
  let boatError: unknown = null
  await deleteBoatSandbox(name).catch((err: unknown) => {
    logger.error({ err, sandbox: name }, "Sandbox: Boat delete failed")
    boatError = err
  })
  if (blaxelConfigured()) {
    await SandboxInstance.delete(name).catch((err: unknown) => {
      if (!isNotFound(err)) throw err
    })
    logger.info({ sandbox: name }, "Sandbox: session sandbox deleted")
  }
  if (strict && boatError) throw boatError
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

// defaultWorkingDirectory is the harness's own field (its network sandbox
// session): with it, every turn's start skips a `pwd` in the sandbox.
export function blaxelSandboxSession(
  sandbox: SandboxInstance
): SandboxSession & { defaultWorkingDirectory: string } {
  const access = () => guardSandbox(sandbox.metadata.name ?? "")
  const readBytes = async (path: string): Promise<Uint8Array | null> => {
    await access()
    try {
      // Retried while the sandbox wakes: that 404 is not a missing file.
      const blob = await whileSandboxStarts(() => sandbox.fs.readBinary(path))
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
    await access()
    try {
      await sandbox.fs.writeBinary(path, bytes)
    } catch {
      await run({ command: `mkdir -p ${shellQuote(posix.dirname(path))}` })
      await sandbox.fs.writeBinary(path, bytes)
    }
  }

  // A command sent while the sandbox boots or wakes from standby waits for it.
  // exec is a POST, replayed only when it never started: Blaxel's
  // not-dispatched answer, or a gateway error after which the sandbox has no
  // process by this name.
  const startProcess = (
    request: Parameters<SandboxInstance["process"]["exec"]>[0] & {
      name: string
    },
    abortSignal?: AbortSignal
  ) =>
    whileSandboxStarts(
      async () => {
        try {
          await sandbox.process.exec(request)
        } catch (err) {
          if (!isSandboxGatewayError(err)) throw err
          const started = await sandbox.process.get(request.name).then(
            () => true,
            (lookup: unknown) => {
              if (isNotFound(lookup)) return false
              throw new Error("Sandbox command state is unknown", {
                cause: err,
              })
            }
          )
          if (!started) throw err
        }
      },
      {
        retry: (err) =>
          isWorkloadUnavailable(err) || isSandboxGatewayError(err),
        ...(abortSignal ? { abortSignal } : {}),
      }
    )

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
    await access()
    const name = `run-${randomUUID().slice(0, 8)}`
    const onAbort = () => {
      sandbox.process.kill(name).catch(() => {})
    }
    abortSignal?.addEventListener("abort", onAbort, { once: true })
    try {
      await startProcess(
        {
          name,
          command: inShell(command),
          // Default to the persistent volume: the harness resolves its working
          // directory with `pwd`, so the conversation's files land on it.
          workingDir: workingDirectory ?? WORKSPACE_MOUNT,
          env: { ...SANDBOX_PROCESS_ENV, ...env },
          keepAlive: true,
          timeout: RUN_TIMEOUT_SEC,
        },
        abortSignal
      )
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
    await access()
    // The harness whose bridge this is ("claude-code", "codex"), or null.
    const bridge = HARNESS_BRIDGE_SCRIPT.exec(command)?.[1] ?? null
    const name = `${bridge ? "bridge" : "spawn"}-${randomUUID().slice(0, 8)}`
    await startProcess(
      {
        name,
        command: inShell(bridge ? `${BRIDGE_SHELL}${command}` : command),
        workingDir: workingDirectory ?? WORKSPACE_MOUNT,
        env: {
          ...SANDBOX_PROCESS_ENV,
          ...(bridge === "claude-code" ? CLAUDE_CODE_ENV : {}),
          ...env,
        },
        // A bridge outlives its turn while it waits on an approval: no time
        // limit, and no keepAlive. A parked one still kept its sandbox out of
        // standby, so it stops after 30 minutes (release-parked-bridge).
        ...(bridge
          ? {}
          : {
              keepAlive: true,
              timeout: RUN_TIMEOUT_SEC,
            }),
      },
      abortSignal
    )
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
      // The adapter waits on this after stopping a bridge, at every turn's end.
      wait() {
        done ??= waitForProcess(name).then((result) => {
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
    defaultWorkingDirectory: WORKSPACE_MOUNT,
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
