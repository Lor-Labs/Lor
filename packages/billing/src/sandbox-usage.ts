import { and, db, eq, inArray, schema } from "@repo/db"
import { assertBetaSandbox } from "@repo/db/queries/beta-access"
import { createLogger } from "@repo/logger"
import { trackCredits } from "./autumn"
import { isBetaWorkspace } from "./beta-credits"
import { SANDBOX_CREDITS_PER_GB_HOUR } from "./constants"

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

// Charges each sandbox-hour's measured time to the workspace's shared credit
// pool at the published rate, as the provider's totals grow. The Autumn key
// names the hour's charged total, so a retry never debits twice. Beta-mode
// debits cap at the balance (no customer debt). Returns this hour's
// sandboxes whose workspace may no longer use one (expired or out of
// credits), for the caller to stop.
export async function chargeSandboxUsage(buckets: SandboxUsage[]) {
  const workspaces = await sandboxWorkspaces([
    ...new Set(buckets.map((b) => b.sandboxName)),
  ])
  const beta = new Map<string, boolean>()
  const blocked = new Map<string, boolean>()
  const toStop: { sandboxName: string; workspaceId: string }[] = []
  const thisHour = Math.floor(Date.now() / 3_600_000) * 3_600_000
  for (const bucket of buckets) {
    const workspaceId = workspaces.get(bucket.sandboxName)
    if (!workspaceId) continue
    if (!beta.has(workspaceId))
      beta.set(workspaceId, await isBetaWorkspace(workspaceId))
    try {
      await db.transaction(async (tx) => {
        const usage = schema.sandboxUsage
        const [row] = await tx
          .insert(usage)
          .values({
            sandboxName: bucket.sandboxName,
            hourStart: bucket.hourStart,
            workspaceId,
            usageGbs: bucket.usageGbs,
            providerCostUsd: bucket.costUsd,
          })
          .onConflictDoUpdate({
            target: [usage.sandboxName, usage.hourStart],
            set: {
              usageGbs: bucket.usageGbs,
              providerCostUsd: bucket.costUsd,
              updatedAt: new Date(),
            },
          })
          .returning({ creditsCharged: usage.creditsCharged })
        if (!row) return
        const total = Math.round(
          (bucket.usageGbs / 3600) * SANDBOX_CREDITS_PER_GB_HOUR
        )
        const delta = total - row.creditsCharged
        if (delta <= 0) return
        const status = await trackCredits(
          workspaceId,
          delta,
          `sandbox:${bucket.sandboxName}:${bucket.hourStart.toISOString()}:${total}`,
          beta.get(workspaceId) ? "cap" : "overflow"
        )
        if (status !== "debited") return
        await tx
          .update(usage)
          .set({ creditsCharged: total })
          .where(
            and(
              eq(usage.sandboxName, bucket.sandboxName),
              eq(usage.hourStart, bucket.hourStart)
            )
          )
      })
    } catch (err) {
      logger.error(
        { err, sandbox: bucket.sandboxName },
        "Sandbox usage charge failed; the next sweep retries"
      )
    }
    if (bucket.hourStart.getTime() < thisHour || !beta.get(workspaceId))
      continue
    if (!blocked.has(workspaceId))
      blocked.set(
        workspaceId,
        await assertBetaSandbox(workspaceId).then(
          () => false,
          () => true
        )
      )
    if (blocked.get(workspaceId))
      toStop.push({ sandboxName: bucket.sandboxName, workspaceId })
  }
  return toStop
}
