import { getSandbox, SandboxInstance } from "@blaxel/core"
import { and, db, eq, inArray, schema } from "@repo/db"
import {
  assertBetaSandbox,
  hostedBetaEnabled,
} from "@repo/db/queries/beta-access"
import { logger } from "../logger"
import { closeConnection } from "./blaxel"

// The guard runs on every file read and command, so an allowed answer is
// reused briefly. A sandbox's workspace never changes.
const ALLOWED_TTL_MS = 15_000
const owners = new Map<string, string>()
const allowedUntil = new Map<string, number>()

async function sandboxWorkspace(name: string) {
  const known = owners.get(name)
  if (known) return known
  const source = name.startsWith("ses-")
    ? schema.agentSession
    : schema.voiceSession
  const [owner] = await db
    .select({ workspaceId: source.workspaceId })
    .from(source)
    .where(eq(source.id, name.slice(name.indexOf("-") + 1)))
  if (!owner) throw new Error("Sandbox owner no longer exists")
  owners.set(name, owner.workspaceId)
  return owner.workspaceId
}

// Hosted beta: sandbox work needs an active workspace with credits left.
export async function guardSandbox(name: string) {
  if (!hostedBetaEnabled()) return
  if ((allowedUntil.get(name) ?? 0) > Date.now()) return
  await assertBetaSandbox(await sandboxWorkspace(name))
  allowedUntil.set(name, Date.now() + ALLOWED_TTL_MS)
}

// Called by the usage sweep for sandboxes that ran recently in a workspace
// that is out of credits or expired. Stops the runs and the box's processes
// and previews, then lets Blaxel put it in standby. Never deletes the VM:
// ignored files and packages are not in Git checkpoints.
export async function stopBlockedSandboxes(
  sandboxes: { sandboxName: string; workspaceId: string }[]
) {
  const workspaceIds = [...new Set(sandboxes.map((s) => s.workspaceId))]
  if (workspaceIds.length > 0)
    await db
      .update(schema.agentRun)
      .set({ stopRequestedAt: new Date() })
      .where(
        and(
          inArray(schema.agentRun.workspaceId, workspaceIds),
          inArray(schema.agentRun.state, ["queued", "working", "finalizing"])
        )
      )
  for (const { sandboxName } of sandboxes) {
    allowedUntil.delete(sandboxName)
    try {
      // The control-plane read does not wake a VM in standby.
      const response = await getSandbox({ path: { sandboxName } })
      if (response.data?.state !== "RUNNING") continue
      const sandbox = await SandboxInstance.get(sandboxName)
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
    } catch (err) {
      logger.error(
        { err, sandbox: sandboxName },
        "Stopping a blocked sandbox failed; the next sweep retries"
      )
    }
  }
}
