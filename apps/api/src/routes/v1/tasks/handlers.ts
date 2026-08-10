import { and, db, desc, eq, inArray, schema } from "@repo/db"
import type { Approval } from "@repo/db/schema"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { logger } from "@/lib/logger"
import { userCanAccessChannel } from "@/lib/queries/channel-access"
import {
  emitTaskUpdated,
  postTaskThreadMessage,
  serializeTask,
  startTaskContinuationRun,
} from "@/lib/task-runs"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  ApproveApprovalRoute,
  GetTaskRoute,
  ListChannelTasksRoute,
  RejectApprovalRoute,
} from "@/routes/v1/tasks/routes"

const ACTIVE_STATUSES = [
  "running",
  "waiting_for_input",
  "waiting_for_approval",
] as const

function serializeApproval(row: Approval) {
  return {
    id: row.id,
    taskId: row.taskId,
    action: row.action,
    description: row.description,
    status: row.status,
    resolvedBy: row.resolvedBy,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }
}

export const listChannelTasks: AppRouteHandler<ListChannelTasksRoute> = async (
  c
) => {
  const currentUser = c.var.user
  const { channelId } = c.req.valid("param")
  const { active } = c.req.valid("query")

  const canAccess = await userCanAccessChannel(channelId, currentUser.id)
  if (!canAccess) {
    return c.json(
      { success: false as const, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }

  const tasks = await db
    .select()
    .from(schema.task)
    .where(
      and(
        eq(schema.task.channelId, channelId),
        ...(active === "true"
          ? [inArray(schema.task.status, [...ACTIVE_STATUSES])]
          : [])
      )
    )
    .orderBy(desc(schema.task.createdAt))
    .limit(50)

  return c.json({ tasks: tasks.map(serializeTask) }, HttpStatusCodes.OK)
}

export const getTask: AppRouteHandler<GetTaskRoute> = async (c) => {
  const currentUser = c.var.user
  const { taskId } = c.req.valid("param")

  const row = await db
    .select({
      task: schema.task,
      channelWorkspaceId: schema.channel.workspaceId,
    })
    .from(schema.task)
    .innerJoin(schema.channel, eq(schema.task.channelId, schema.channel.id))
    .where(eq(schema.task.id, taskId))
    .limit(1)
    .then((rows) => rows[0])

  if (!row || row.channelWorkspaceId !== row.task.workspaceId) {
    return c.json(
      { success: false as const, message: "Task not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  const canAccess = await userCanAccessChannel(
    row.task.channelId,
    currentUser.id
  )
  if (!canAccess) {
    return c.json(
      { success: false as const, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }

  const pending = await db
    .select()
    .from(schema.approval)
    .where(
      and(
        eq(schema.approval.taskId, taskId),
        eq(schema.approval.status, "pending")
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  return c.json(
    {
      task: serializeTask(row.task),
      pendingApproval: pending ? serializeApproval(pending) : null,
    },
    HttpStatusCodes.OK
  )
}

type ResolveOutcome =
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "conflict" }
  | { kind: "resolved"; approval: Approval }

async function resolveApproval(
  approvalId: string,
  userId: string,
  resolution: "approved" | "rejected"
): Promise<ResolveOutcome> {
  const row = await db
    .select({
      approval: schema.approval,
      task: schema.task,
      channelWorkspaceId: schema.channel.workspaceId,
    })
    .from(schema.approval)
    .innerJoin(schema.task, eq(schema.approval.taskId, schema.task.id))
    .innerJoin(schema.channel, eq(schema.task.channelId, schema.channel.id))
    .where(eq(schema.approval.id, approvalId))
    .limit(1)
    .then((rows) => rows[0])

  if (!row || row.channelWorkspaceId !== row.approval.workspaceId) {
    return { kind: "not_found" }
  }
  const canAccess = await userCanAccessChannel(row.task.channelId, userId)
  if (!canAccess) {
    return { kind: "forbidden" }
  }

  // CAS: only one resolver wins; a second click reads as already resolved.
  const resolved = await db
    .update(schema.approval)
    .set({
      status: resolution,
      resolvedBy: userId,
      resolvedAt: new Date(),
    })
    .where(
      and(
        eq(schema.approval.id, approvalId),
        eq(schema.approval.status, "pending")
      )
    )
    .returning()
    .then((rows) => rows[0] ?? null)
  if (!resolved) {
    return { kind: "conflict" }
  }

  // Everything past the CAS is a side effect of an already-committed
  // resolution — a failure here is logged, never surfaced as a 500.
  try {
    // The resolution message is the continuation trigger: it lands in the
    // task thread as the resolver, and the next run answers it.
    const content =
      resolution === "approved"
        ? `✅ Approved — go ahead: ${resolved.description}`
        : `❌ Rejected — do not proceed: ${resolved.description}`
    const messageId = await postTaskThreadMessage({
      task: row.task,
      authorId: userId,
      content,
    })

    if (messageId) {
      // Only a parked task moves back to running, and only when the trigger
      // message exists — never resurrect a terminal task (the continuation
      // run re-claims status itself if it does start).
      const updatedTask = await db
        .update(schema.task)
        .set({ status: "running" })
        .where(
          and(
            eq(schema.task.id, row.task.id),
            inArray(schema.task.status, [
              "waiting_for_approval",
              "waiting_for_input",
            ])
          )
        )
        .returning()
        .then((rows) => rows[0] ?? null)
      if (updatedTask) await emitTaskUpdated(updatedTask)

      await startTaskContinuationRun({
        task: updatedTask ?? row.task,
        triggerMessageId: messageId,
        senderId: userId,
      })
    }
  } catch (err) {
    logger.error(
      { err, approvalId, taskId: row.task.id },
      "Approval post-resolution side effects failed"
    )
  }

  return { kind: "resolved", approval: resolved }
}

export const approveApproval: AppRouteHandler<ApproveApprovalRoute> = async (
  c
) => {
  const outcome = await resolveApproval(
    c.req.valid("param").approvalId,
    c.var.user.id,
    "approved"
  )
  switch (outcome.kind) {
    case "not_found":
      return c.json(
        { success: false as const, message: "Approval not found" },
        HttpStatusCodes.NOT_FOUND
      )
    case "forbidden":
      return c.json(
        { success: false as const, message: "Forbidden" },
        HttpStatusCodes.FORBIDDEN
      )
    case "conflict":
      return c.json(
        { success: false as const, message: "Already resolved" },
        HttpStatusCodes.CONFLICT
      )
    case "resolved":
      return c.json(
        { approval: serializeApproval(outcome.approval) },
        HttpStatusCodes.OK
      )
  }
}

export const rejectApproval: AppRouteHandler<RejectApprovalRoute> = async (
  c
) => {
  const outcome = await resolveApproval(
    c.req.valid("param").approvalId,
    c.var.user.id,
    "rejected"
  )
  switch (outcome.kind) {
    case "not_found":
      return c.json(
        { success: false as const, message: "Approval not found" },
        HttpStatusCodes.NOT_FOUND
      )
    case "forbidden":
      return c.json(
        { success: false as const, message: "Forbidden" },
        HttpStatusCodes.FORBIDDEN
      )
    case "conflict":
      return c.json(
        { success: false as const, message: "Already resolved" },
        HttpStatusCodes.CONFLICT
      )
    case "resolved":
      return c.json(
        { approval: serializeApproval(outcome.approval) },
        HttpStatusCodes.OK
      )
  }
}
