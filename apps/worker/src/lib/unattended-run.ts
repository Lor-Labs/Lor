import { and, db, eq, inArray, schema } from "@repo/db"
import { notifyWorkspaceActivity } from "@/lib/workspace-activity"

// The queued run was cancelled before execution (kill switch: trigger
// disabled, loop paused). Terminal states are never clobbered.
export async function cancelPendingRun(runId: string): Promise<void> {
  await db
    .update(schema.agentRun)
    .set({
      state: "stopped",
      stopReason: "stopped_by_user",
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(schema.agentRun.id, runId),
        inArray(schema.agentRun.state, ["queued", "working", "finalizing"])
      )
    )
    .returning({ workspaceId: schema.agentRun.workspaceId })
    .then((r) => {
      if (r[0]) notifyWorkspaceActivity(r[0].workspaceId)
    })
    .catch(() => {})
}
