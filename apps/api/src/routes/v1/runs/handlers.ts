import { and, asc, db, eq, gt, schema } from "@repo/db"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { userCanAccessChannel } from "@/lib/queries/channel-access"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type { GetRunEventsRoute } from "@/routes/v1/runs/routes"

// Retention cleanup prunes terminal runs' events; a full replay is bounded by
// one run's answer, but cap defensively.
const EVENT_LIMIT = 10_000

export const getRunEvents: AppRouteHandler<GetRunEventsRoute> = async (c) => {
  const currentUser = c.var.user
  const { messageId } = c.req.valid("param")
  const { after } = c.req.valid("query")

  // Tenant guard: the run's channel must still belong to the run's workspace
  // (fail closed on drift) before the caller's channel access is checked.
  const run = await db
    .select({
      id: schema.agentRun.id,
      messageId: schema.agentRun.messageId,
      channelId: schema.agentRun.channelId,
      threadRootId: schema.agentRun.threadRootId,
      workspaceId: schema.agentRun.workspaceId,
      channelWorkspaceId: schema.channel.workspaceId,
      state: schema.agentRun.state,
      stopReason: schema.agentRun.stopReason,
    })
    .from(schema.agentRun)
    .innerJoin(schema.channel, eq(schema.agentRun.channelId, schema.channel.id))
    .where(eq(schema.agentRun.messageId, messageId))
    .limit(1)
    .then((rows) => rows[0])

  if (!run) {
    return c.json(
      { success: false, message: "Run not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  if (run.channelWorkspaceId !== run.workspaceId) {
    return c.json(
      { success: false, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }
  const canAccess = await userCanAccessChannel(run.channelId, currentUser.id)
  if (!canAccess) {
    return c.json(
      { success: false, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }

  const events = await db
    .select({
      seq: schema.agentRunEvent.seq,
      kind: schema.agentRunEvent.kind,
      payload: schema.agentRunEvent.payload,
    })
    .from(schema.agentRunEvent)
    .where(
      and(
        eq(schema.agentRunEvent.runId, run.id),
        ...(after !== undefined ? [gt(schema.agentRunEvent.seq, after)] : [])
      )
    )
    .orderBy(asc(schema.agentRunEvent.seq))
    .limit(EVENT_LIMIT)

  return c.json(
    {
      run: {
        id: run.id,
        messageId: run.messageId,
        channelId: run.channelId,
        threadRootId: run.threadRootId,
        state: run.state,
        stopReason: run.stopReason,
      },
      events,
    },
    HttpStatusCodes.OK
  )
}
