import { and, db, desc, eq, inArray, schema } from "@repo/db"
import { resolveChannelAccess } from "@repo/db/queries/channel-access"
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
  | { kind: "archived" }
  | { kind: "conflict" }
  | { kind: "post_failed" }
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
  const access = await resolveChannelAccess(userId, row.task.channelId)
  if (!access.ok) {
    return { kind: "forbidden" }
  }
  // Archived channel: the resolution message and continuation run can never
  // land, so refuse before the CAS instead of resolving into a stranded task.
  if (!access.access.canWrite) {
    return { kind: "archived" }
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

  // The resolution message is the continuation trigger: it lands in the task
  // thread as the resolver, and the next run answers it. If it can't be
  // created, un-resolve the CAS so the caller can retry — a success response
  // without the thread message would strand the task.
  const content =
    resolution === "approved"
      ? `Approved — go ahead: ${resolved.description}`
      : `Rejected — do not proceed: ${resolved.description}`
  const messageId = await postTaskThreadMessage({
    task: row.task,
    authorId: userId,
    content,
  }).catch(() => null)
  if (!messageId) {
    await db
      .update(schema.approval)
      .set({ status: "pending", resolvedBy: null, resolvedAt: null })
      .where(
        and(
          eq(schema.approval.id, approvalId),
          eq(schema.approval.status, resolution),
          eq(schema.approval.resolvedBy, userId)
        )
      )
      .catch(() => {})
    return { kind: "post_failed" }
  }

  // Remaining side effects are best-effort: the continuation path self-heals
  // (an enqueue failure parks the task back in waiting_for_input).
  try {
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
    case "archived":
      return c.json(
        { success: false as const, message: "Channel is archived" },
        HttpStatusCodes.BAD_REQUEST
      )
    case "conflict":
      return c.json(
        { success: false as const, message: "Already resolved" },
        HttpStatusCodes.CONFLICT
      )
    case "post_failed":
      return c.json(
        {
          success: false as const,
          message: "Failed to post approval resolution",
        },
        HttpStatusCodes.INTERNAL_SERVER_ERROR
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
    case "archived":
      return c.json(
        { success: false as const, message: "Channel is archived" },
        HttpStatusCodes.BAD_REQUEST
      )
    case "conflict":
      return c.json(
        { success: false as const, message: "Already resolved" },
        HttpStatusCodes.CONFLICT
      )
    case "post_failed":
      return c.json(
        {
          success: false as const,
          message: "Failed to post approval resolution",
        },
        HttpStatusCodes.INTERNAL_SERVER_ERROR
      )
    case "resolved":
      return c.json(
        { approval: serializeApproval(outcome.approval) },
        HttpStatusCodes.OK
      )
  }
}
