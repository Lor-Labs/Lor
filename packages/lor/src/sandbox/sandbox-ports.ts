import { randomUUID } from "node:crypto"
import { shellQuote } from "@ai-sdk/harness/utils"
import { SandboxInstance } from "@blaxel/core"
import { env } from "@repo/env/server"
import type { HarnessOwner } from "../session-core"
import { guardSandbox } from "./beta-compute"
import {
  blaxelConfigured,
  closeConnection,
  SANDBOX_PROCESS_ENV,
  WORKSPACE_MOUNT,
} from "./blaxel"
import {
  type BoatSandbox,
  boatExec,
  ensureBoatProcess,
  findBoatSandbox,
  hostBoatPort,
  listBoatProcesses,
  stopBoatProcess,
} from "./boat"
import { sessionSandboxName } from "./session-sandbox"

// The provider seam for the Preview and Terminal tabs
// (reference/dev-environment-runbook.md §1): expose a sandbox port, keep a
// named long-lived process running, check a port. Blaxel, or Boat for a
// session whose sandbox went there (boat.ts). Callers never assume processes
// survive idle: each open calls ensureProcess + portReady.

export type ExposedPort = {
  url: string
  // Private ports: the browser's credential, as a query parameter.
  token?: { param: string; value: string; expiresAt: Date }
}

// Blaxel's SDK reports a missing sandbox as `code: 404`, other calls as
// `status`.
const isNotFound = (err: unknown) =>
  typeof err === "object" &&
  err !== null &&
  [404, "404"].some(
    (value) =>
      ("status" in err && err.status === value) ||
      ("code" in err && err.code === value)
  )

type Located =
  | { provider: "blaxel"; sandbox: SandboxInstance }
  | { provider: "boat"; sandbox: BoatSandbox }

// The session's sandbox as it is; never creates one. Null when it is gone.
async function existingSandbox(owner: HarnessOwner): Promise<Located | null> {
  const name = sessionSandboxName(owner)
  await guardSandbox(name)
  if (blaxelConfigured()) {
    const sandbox = await SandboxInstance.get(name).catch((err: unknown) => {
      if (isNotFound(err)) return null
      throw err
    })
    if (sandbox) return { provider: "blaxel", sandbox }
  }
  const boat = await findBoatSandbox(name).catch(() => null)
  return boat ? { provider: "boat", sandbox: boat } : null
}

// `name` is stable per use (`preview-3000`, `terminal`), so the URL stays the
// same across opens. Public: no credential, for iframes. Private: the caller
// hands the browser a short-lived token.
export async function exposePort(
  owner: HarnessOwner,
  input: {
    name: string
    port: number
    access: "public" | "private"
    tokenTtlMs?: number
  }
): Promise<ExposedPort | null> {
  const located = await existingSandbox(owner)
  if (!located) return null
  const expiresAt = new Date(Date.now() + (input.tokenTtlMs ?? 15 * 60_000))
  if (located.provider === "boat") {
    // Boat's token lives as long as the hosted port.
    const hosted = await hostBoatPort(located.sandbox, input.port, input.access)
    return hosted.token
      ? { url: hosted.url, token: { ...hosted.token, expiresAt } }
      : { url: hosted.url }
  }
  const sandbox = located.sandbox
  try {
    const preview = await sandbox.previews.createIfNotExists({
      metadata: { name: input.name },
      spec: {
        port: input.port,
        public: input.access === "public",
        prefixUrl: `lor-${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        ...(env.LOR_PREVIEW_DOMAIN
          ? { customDomain: env.LOR_PREVIEW_DOMAIN }
          : {}),
      },
    })
    const url = (preview.spec as { url?: string }).url
    if (!url) throw new Error(`Preview ${input.name} has no URL`)
    if (input.access === "public") return { url }
    const token = await preview.tokens.create(expiresAt)
    return {
      url,
      token: { param: "bl_preview_token", value: token.value, expiresAt },
    }
  } finally {
    closeConnection(sandbox)
  }
}

// Boat has no way to unhost a port; its sandboxes keep theirs.
export async function revokePort(
  owner: HarnessOwner,
  name: string
): Promise<void> {
  const located = await existingSandbox(owner)
  if (located?.provider !== "blaxel") return
  const sandbox = located.sandbox
  try {
    await sandbox.previews.delete(name).catch((err: unknown) => {
      if (!isNotFound(err)) throw err
    })
  } finally {
    closeConnection(sandbox)
  }
}

// Starts the named process unless it already runs. Not keepAlive: it must
// not hold the sandbox out of standby, and standby freezes it rather than
// killing it. Turn fencing stops only run-/spawn-/bridge- processes.
export async function ensureProcess(
  owner: HarnessOwner,
  input: {
    name: string
    command: string
    cwd?: string
    env?: Record<string, string>
  }
): Promise<"running" | "started" | null> {
  const located = await existingSandbox(owner)
  if (!located) return null
  if (located.provider === "boat") {
    return ensureBoatProcess(located.sandbox, input)
  }
  const sandbox = located.sandbox
  try {
    const current = await sandbox.process.get(input.name).catch(() => null)
    if (current?.status === "running") return "running"
    await sandbox.process.exec({
      name: input.name,
      command: `bash -c ${shellQuote(input.command)}`,
      workingDir: input.cwd ?? WORKSPACE_MOUNT,
      env: { ...SANDBOX_PROCESS_ENV, ...input.env },
      keepAlive: false,
    })
    return "started"
  } finally {
    closeConnection(sandbox)
  }
}

export async function stopProcess(
  owner: HarnessOwner,
  name: string
): Promise<void> {
  const located = await existingSandbox(owner)
  if (!located) return
  if (located.provider === "boat") {
    await stopBoatProcess(located.sandbox, name)
    return
  }
  const sandbox = located.sandbox
  try {
    await sandbox.process.kill(name).catch(() => {})
  } finally {
    closeConnection(sandbox)
  }
}

// Named processes with a prefix (`preview-`) and whether each runs.
export async function listProcesses(
  owner: HarnessOwner,
  prefix: string
): Promise<{ name: string; running: boolean }[]> {
  const located = await existingSandbox(owner)
  if (!located) return []
  if (located.provider === "boat") {
    return listBoatProcesses(located.sandbox, prefix)
  }
  const sandbox = located.sandbox
  try {
    const records = await sandbox.process.list()
    return records
      .filter((record) => record.name.startsWith(prefix))
      .map((record) => ({
        name: record.name,
        running: record.status === "running",
      }))
  } finally {
    closeConnection(sandbox)
  }
}

// A command that may wait up to `timeoutSec` (under Blaxel's 60 s
// waitForCompletion), named so stopProcess can end it early. A run of the
// same name still going is stopped first.
export async function runNamed(
  owner: HarnessOwner,
  input: { name: string; command: string; timeoutSec: number }
): Promise<{ exitCode: number; stdout: string } | null> {
  const located = await existingSandbox(owner)
  if (!located) return null
  if (located.provider === "boat") {
    // A process group with the name's pid file, so stopProcess ends it.
    const pid = `/tmp/lor-procs/${input.name}.pid`
    const result = await boatExec(located.sandbox, {
      label: `named-${input.name}`,
      command: [
        "mkdir -p /tmp/lor-procs",
        `[ -f ${pid} ] && kill -TERM -- "-$(cat ${pid})" 2>/dev/null`,
        `setsid bash -c ${shellQuote(input.command)} & echo $! > ${pid}`,
        "wait $!; code=$?",
        `rm -f ${pid}`,
        "exit $code",
      ].join("\n"),
      timeoutSec: input.timeoutSec + 5,
    })
    return { exitCode: result.exitCode, stdout: result.stdout }
  }
  const sandbox = located.sandbox
  try {
    await sandbox.process.kill(input.name).catch(() => {})
    const result = await sandbox.process.exec({
      name: input.name,
      command: `bash -c ${shellQuote(input.command)}`,
      waitForCompletion: true,
      timeout: input.timeoutSec,
    })
    return { exitCode: result.exitCode ?? 1, stdout: result.stdout ?? "" }
  } finally {
    closeConnection(sandbox)
  }
}

// Blaxel's waitForCompletion stops at 60 s, so longer waits are rounds of
// shorter checks.
const PORT_CHECK_ROUND_SEC = 20

function portCheck(port: number, seconds: number, probe: PortProbe) {
  const check =
    probe === "http"
      ? `curl -s -o /dev/null --max-time 1 http://127.0.0.1:${port}/`
      : `bash -c "exec 3<>/dev/tcp/127.0.0.1/${port}" 2>/dev/null`
  return `for i in $(seq ${seconds}); do ${check} && exit 0; sleep 1; done; exit 1`
}

type PortProbe = "http" | "connect"

// Whether something answers on the port inside the sandbox, polling until
// the timeout. "http": any HTTP status counts; "connect": accepting a
// connection is enough.
export async function portReady(
  owner: HarnessOwner,
  port: number,
  timeoutMs: number,
  probe: PortProbe = "http"
): Promise<boolean> {
  const located = await existingSandbox(owner)
  if (!located) return false
  const seconds = Math.max(1, Math.ceil(timeoutMs / 1000))
  if (located.provider === "boat") {
    const result = await boatExec(located.sandbox, {
      label: "port-check",
      command: portCheck(port, seconds, probe),
      timeoutSec: seconds + 10,
    })
    return result.exitCode === 0
  }
  const sandbox = located.sandbox
  const deadline = Date.now() + timeoutMs
  try {
    while (Date.now() < deadline) {
      const round = Math.max(
        1,
        Math.min(
          PORT_CHECK_ROUND_SEC,
          Math.ceil((deadline - Date.now()) / 1000)
        )
      )
      const result = await sandbox.process.exec({
        name: `port-${randomUUID().slice(0, 8)}`,
        command: portCheck(port, round, probe),
        waitForCompletion: true,
        timeout: round + 5,
      })
      if (result.exitCode === 0) return true
    }
    return false
  } finally {
    closeConnection(sandbox)
  }
}
