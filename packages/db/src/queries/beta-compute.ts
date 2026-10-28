import { and, db, eq, schema, sql } from "../index"
import { BetaAccessError, hostedBetaEnabled, isBetaExempt } from "./beta-access"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// Provider state observations are estimates, not invoice line items. Never
// charge an unobserved outage as hours of use; Lor absorbs that uncertainty.
async function meter(
  tx: Tx,
  trial: typeof schema.workspaceBetaTrial.$inferSelect,
  now: Date
) {
  const resource = schema.betaComputeResource
  const until = new Date(
    Math.min(now.getTime(), trial.expiresAt.getTime())
  ).toISOString()
  await tx
    .update(resource)
    .set({
      usedMilliseconds: sql`${resource.usedMilliseconds} + greatest(0, least(60000, floor(extract(epoch from (${until}::timestamptz - ${resource.meteredAt})) * 1000)))`,
      meteredAt: now,
    })
    .where(and(eq(resource.trialId, trial.id), eq(resource.active, true)))
  const [total] = await tx
    .select({
      used: sql<string>`coalesce(sum(${resource.usedMilliseconds}), 0)`,
    })
    .from(resource)
    .where(eq(resource.trialId, trial.id))
  return Number(total?.used ?? 0)
}

export async function betaComputeSummary(workspaceId: string) {
  if (!hostedBetaEnabled()) return null
  return db.transaction(async (tx) => {
    const [trial] = await tx
      .select()
      .from(schema.workspaceBetaTrial)
      .where(eq(schema.workspaceBetaTrial.workspaceId, workspaceId))
      .for("update")
    if (!trial || trial.subscribedAt) return null
    const used = await meter(tx, trial, new Date())
    return {
      sandboxGrantSeconds: trial.sandboxGrantSeconds,
      sandboxUsedSeconds: Math.min(trial.sandboxGrantSeconds, used / 1000),
      sandboxRemainingSeconds: Math.max(
        0,
        trial.sandboxGrantSeconds - used / 1000
      ),
    }
  })
}

export async function assertBetaCompute(workspaceId: string, name?: string) {
  if (!hostedBetaEnabled()) return
  // Commit elapsed usage even when refusing the next operation.
  const result = await db.transaction(async (tx) => {
    const [trial] = await tx
      .select()
      .from(schema.workspaceBetaTrial)
      .where(eq(schema.workspaceBetaTrial.workspaceId, workspaceId))
      .for("update")
    if (trial?.subscribedAt || (!trial && (await isBetaExempt(workspaceId))))
      return { remainingSeconds: undefined }
    if (!trial || trial.expiresAt <= new Date())
      return {
        error:
          "This team's beta is not active. Saved work remains readable; compute is paused.",
      }
    const now = new Date()
    const used = await meter(tx, trial, now)
    const remaining = trial.sandboxGrantSeconds * 1000 - used
    if (remaining <= 0)
      return {
        error:
          "Your team's included sandbox time is used up. Subscribe in billing to keep working; AI credit purchases do not add compute time.",
      }
    if (name) {
      const [existing] = await tx
        .select()
        .from(schema.betaComputeResource)
        .where(eq(schema.betaComputeResource.name, name))
      if (existing && existing.trialId !== trial.id)
        throw new Error("Sandbox belongs to another trial")
      await tx
        .insert(schema.betaComputeResource)
        .values({
          name,
          trialId: trial.id,
          active: true,
          meteredAt: now,
          lastAccessAt: now,
        })
        .onConflictDoUpdate({
          target: schema.betaComputeResource.name,
          set: {
            active: true,
            meteredAt: now,
            lastAccessAt: now,
            stoppedAt: null,
          },
        })
    }
    return {
      remainingSeconds: Math.max(
        1,
        Math.floor(
          Math.min(remaining, trial.expiresAt.getTime() - now.getTime()) / 1000
        )
      ),
    }
  })
  if (result.error) throw new BetaAccessError(result.error)
  return result.remainingSeconds
}

export async function observeBetaCompute(
  name: string,
  active: boolean,
  observedAt: Date
) {
  await db.transaction(async (tx) => {
    const [resource] = await tx
      .select()
      .from(schema.betaComputeResource)
      .where(eq(schema.betaComputeResource.name, name))
    if (!resource) return
    const [trial] = await tx
      .select()
      .from(schema.workspaceBetaTrial)
      .where(eq(schema.workspaceBetaTrial.id, resource.trialId))
      .for("update")
    if (!trial) return
    await meter(tx, trial, new Date())
    await tx
      .update(schema.betaComputeResource)
      .set({ active, meteredAt: new Date() })
      .where(
        and(
          eq(schema.betaComputeResource.name, name),
          eq(schema.betaComputeResource.trialId, trial.id),
          sql`${schema.betaComputeResource.lastAccessAt} <= ${observedAt.toISOString()}::timestamptz`
        )
      )
  })
}
