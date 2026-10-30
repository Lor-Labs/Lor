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
import { sessionSandboxName } from "./session-sandbox"

// The provider seam for the Preview and Terminal tabs
// (reference/dev-environment-runbook.md §1): expose a sandbox port, keep a
// named long-lived process running, check a port. The only Blaxel-specific
// part of those features; another provider (or Lor's own VMs) implements
// these four. Callers never assume processes survive idle: each open calls
// ensureProcess + portReady.

export type ExposedPort = {
  url: string
  // Private ports: the browser's credential, as a query parameter.
  token?: { param: string; value: string; expiresAt: Date }
}

const isNotFound = (err: unknown) =>
  typeof err === "object" &&
  err !== null &&
  "status" in err &&
  (err.status === 404 || err.status === "404")

// The session's sandbox as it is; never creates one. Null when it is gone.
async function existingSandbox(
  owner: HarnessOwner
): Promise<SandboxInstance | null> {
  if (!blaxelConfigured()) return null
  const name = sessionSandboxName(owner)
  await guardSandbox(name)
  return SandboxInstance.get(name).catch((err: unknown) => {
    if (isNotFound(err)) return null
    throw err
  })
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
  const sandbox = await existingSandbox(owner)
  if (!sandbox) return null
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
    const expiresAt = new Date(Date.now() + (input.tokenTtlMs ?? 15 * 60_000))
    const token = await preview.tokens.create(expiresAt)
    return {
      url,
      token: { param: "bl_preview_token", value: token.value, expiresAt },
    }
  } finally {
    closeConnection(sandbox)
  }
}

export async function revokePort(
  owner: HarnessOwner,
  name: string
): Promise<void> {
  const sandbox = await existingSandbox(owner)
  if (!sandbox) return
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
  const sandbox = await existingSandbox(owner)
  if (!sandbox) return null
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
  const sandbox = await existingSandbox(owner)
  if (!sandbox) return
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
  const sandbox = await existingSandbox(owner)
  if (!sandbox) return []
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

// Blaxel's waitForCompletion stops at 60 s, so longer waits are rounds of
// shorter checks.
const PORT_CHECK_ROUND_SEC = 20

// Whether something answers on the port inside the sandbox, polling until
// the timeout. Any HTTP status counts.
export async function portReady(
  owner: HarnessOwner,
  port: number,
  timeoutMs: number
): Promise<boolean> {
  const sandbox = await existingSandbox(owner)
  if (!sandbox) return false
  const deadline = Date.now() + timeoutMs
  try {
    while (Date.now() < deadline) {
      const seconds = Math.max(
        1,
        Math.min(
          PORT_CHECK_ROUND_SEC,
          Math.ceil((deadline - Date.now()) / 1000)
        )
      )
      const result = await sandbox.process.exec({
        name: `port-${randomUUID().slice(0, 8)}`,
        command: `for i in $(seq ${seconds}); do curl -s -o /dev/null --max-time 1 http://127.0.0.1:${port}/ && exit 0; sleep 1; done; exit 1`,
        waitForCompletion: true,
        timeout: seconds + 5,
      })
      if (result.exitCode === 0) return true
    }
    return false
  } finally {
    closeConnection(sandbox)
  }
}
