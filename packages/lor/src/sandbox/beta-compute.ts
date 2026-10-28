import { getSandbox, SandboxInstance } from "@blaxel/core"
import { and, db, eq, inArray, schema } from "@repo/db"
import { hostedBetaEnabled } from "@repo/db/queries/beta-access"
import {
  assertBetaCompute,
  observeBetaCompute,
} from "@repo/db/queries/beta-compute"
import { logger } from "../logger"
import { blaxelConfigured, closeConnection } from "./blaxel"

export async function guardSandbox(name: string) {
  if (!hostedBetaEnabled()) return
  const source = name.startsWith("ses-")
    ? schema.agentSession
    : schema.voiceSession
  const [owner] = await db
    .select({ workspaceId: source.workspaceId })
    .from(source)
    .where(eq(source.id, name.slice(name.startsWith("ses-") ? 4 : 5)))
  if (!owner) throw new Error("Sandbox owner no longer exists")
  return assertBetaCompute(owner.workspaceId, name)
}

export async function sweepBetaCompute() {
  if (!hostedBetaEnabled() || !blaxelConfigured()) return
  const resources = await db
    .select({
      resource: schema.betaComputeResource,
      workspaceId: schema.workspaceBetaTrial.workspaceId,
    })
    .from(schema.betaComputeResource)
    .innerJoin(
      schema.workspaceBetaTrial,
      eq(schema.workspaceBetaTrial.id, schema.betaComputeResource.trialId)
    )
  for (const { resource, workspaceId } of resources) {
    try {
      // The raw control-plane read does not establish a connection or wake a VM.
      const observedAt = new Date()
      const response = await getSandbox({
        path: { sandboxName: resource.name },
      })
      if (response.response.status === 404) {
        await observeBetaCompute(resource.name, false, observedAt)
        continue
      }
      if (response.error || !response.data?.state)
        throw new Error("Sandbox state unavailable")
      await observeBetaCompute(
        resource.name,
        response.data.state === "RUNNING",
        observedAt
      )
      let allowed = false
      if (workspaceId) {
        try {
          await assertBetaCompute(workspaceId)
          allowed = true
        } catch {
          /* fail closed */
        }
      }
      if (allowed) continue
      if (workspaceId)
        await db
          .update(schema.agentRun)
          .set({ stopRequestedAt: new Date() })
          .where(
            and(
              eq(schema.agentRun.workspaceId, workspaceId),
              inArray(schema.agentRun.state, [
                "queued",
                "working",
                "finalizing",
              ])
            )
          )
      if (resource.stoppedAt && response.data.state === "STANDBY") continue
      const sandbox = await SandboxInstance.get(resource.name)
      try {
        for (const preview of await sandbox.previews.list())
          await sandbox.previews.delete(preview.name)
        for (const process of await sandbox.process.list()) {
          if (process.status === "running")
            await sandbox.process.kill(process.name)
        }
      } finally {
        closeConnection(sandbox)
      }
      await db
        .update(schema.betaComputeResource)
        .set({ stoppedAt: new Date() })
        .where(eq(schema.betaComputeResource.name, resource.name))
      // Do not delete the VM: ignored files and packages are not in Git checkpoints.
    } catch (err) {
      logger.error(
        { err, sandbox: resource.name },
        "Beta compute reconciliation failed; shutdown will retry"
      )
    }
  }
}
