import { and, db, desc, eq, inArray, schema } from "@repo/db"
import { loadApprovalResolvers, serializeApproval } from "@/lib/approvals"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { userCanAccessChannel } from "@/lib/queries/channel-access"
import { serializeTask } from "@/lib/scope-runs"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  GetTaskRoute,
  ListChannelTasksRoute,
} from "@/routes/v1/tasks/routes"

const ACTIVE_STATUSES = [
  "running",
  "waiting_for_input",
  "waiting_for_approval",
] as const

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

  // Resolver spec + display name so the card can gate its buttons client-side
  // (the resolve endpoint enforces regardless).
  const resolver = pending
    ? ((await loadApprovalResolvers(row.task.workspaceId, [pending])).get(
        pending.id
      ) ?? null)
    : null
  const resolverUserName =
    resolver?.kind === "user"
      ? await db
          .select({ name: schema.user.name })
          .from(schema.user)
          .where(eq(schema.user.id, resolver.userId))
          .limit(1)
          .then((rows) => rows[0]?.name ?? null)
      : null

  return c.json(
    {
      task: serializeTask(row.task),
      pendingApproval: pending
        ? { ...serializeApproval(pending), resolver, resolverUserName }
        : null,
    },
    HttpStatusCodes.OK
  )
}
