import { db, inArray, schema } from "@repo/db"
import {
  assertBetaSandbox,
  getBetaExemption,
} from "@repo/db/queries/beta-access"
import { createLogger } from "@repo/logger"
import { trackSandboxUsage } from "./autumn"
import { isBetaWorkspace } from "./beta-credits"

const logger = createLogger("billing")

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type SandboxUsage = {
  sandboxName: string
  hourStart: Date
  usageGbs: number
  costUsd: number
}

// Session sandboxes are `ses-<session id>`, voice calls `call-<call id>`.
async function sandboxWorkspaces(names: string[]) {
  const ids = (prefix: string) =>
    names
      .filter((name) => name.startsWith(prefix))
      .map((name) => name.slice(prefix.length))
      .filter((id) => UUID.test(id))
  const sessionIds = ids("ses-")
  const callIds = ids("call-")
  const sessions = sessionIds.length
    ? await db
        .select({
          id: schema.agentSession.id,
          workspaceId: schema.agentSession.workspaceId,
        })
        .from(schema.agentSession)
        .where(inArray(schema.agentSession.id, sessionIds))
    : []
  const calls = callIds.length
    ? await db
        .select({
          id: schema.voiceSession.id,
          workspaceId: schema.voiceSession.workspaceId,
        })
        .from(schema.voiceSession)
        .where(inArray(schema.voiceSession.id, callIds))
    : []
  return new Map<string, string>([
    ...sessions.map((s): [string, string] => [`ses-${s.id}`, s.workspaceId]),
    ...calls.map((c): [string, string] => [`call-${c.id}`, c.workspaceId]),
  ])
}

// Charges closed sandbox-hours to the workspace's shared credit pool: each
// hour's final GB-hours go to Autumn once, whose credit system prices them
// (autumn.config.ts). Usage history lives in Autumn and the provider's
// billing data; the Autumn key names the sandbox-hour, so a repeat is
// rejected (409) instead of charged twice. Beta-mode debits cap at the
// balance (no customer debt).
export async function chargeSandboxUsage(buckets: SandboxUsage[]) {
  const workspaces = await sandboxWorkspaces([
    ...new Set(buckets.map((b) => b.sandboxName)),
  ])
  const beta = new Map<string, boolean>()
  const exemptions = new Map<
    string,
    Awaited<ReturnType<typeof getBetaExemption>>
  >()
  for (const bucket of buckets) {
    const workspaceId = workspaces.get(bucket.sandboxName)
    if (!workspaceId) continue
    // Internal workspaces run sandboxes free: an hour that overlaps the
    // exemption is skipped, even when it is read again after removal.
    if (!exemptions.has(workspaceId))
      exemptions.set(workspaceId, await getBetaExemption(workspaceId))
    const exemption = exemptions.get(workspaceId)
    const hourEnd = new Date(bucket.hourStart.getTime() + 3_600_000)
    if (
      exemption &&
      exemption.createdAt < hourEnd &&
      (!exemption.endedAt || exemption.endedAt > bucket.hourStart)
    )
      continue
    if (!beta.has(workspaceId))
      beta.set(workspaceId, await isBetaWorkspace(workspaceId))
    const status = await trackSandboxUsage(
      workspaceId,
      bucket.usageGbs / 3600,
      `sandbox:${bucket.sandboxName}:${bucket.hourStart.toISOString()}`,
      beta.get(workspaceId) ? "cap" : "overflow"
    )
    if (status === "fail_open")
      logger.error(
        { sandbox: bucket.sandboxName, hour: bucket.hourStart },
        "Sandbox usage charge failed; the next hourly run retries"
      )
  }
}

// Sandboxes running this hour in beta workspaces that may no longer use
// one (expired, out of credits or halted), for the caller to stop.
export async function blockedSandboxes(buckets: SandboxUsage[]) {
  const workspaces = await sandboxWorkspaces([
    ...new Set(buckets.map((b) => b.sandboxName)),
  ])
  const blocked = new Map<string, boolean>()
  const toStop: { sandboxName: string; workspaceId: string }[] = []
  for (const bucket of buckets) {
    const workspaceId = workspaces.get(bucket.sandboxName)
    if (!workspaceId) continue
    if (!blocked.has(workspaceId))
      blocked.set(
        workspaceId,
        (await isBetaWorkspace(workspaceId)) &&
          (await assertBetaSandbox(workspaceId).then(
            () => false,
            () => true
          ))
      )
    if (blocked.get(workspaceId))
      toStop.push({ sandboxName: bucket.sandboxName, workspaceId })
  }
  return toStop
}
