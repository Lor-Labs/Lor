import { createRoute } from "@hono/zod-openapi"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import jsonContent from "@/lib/helpers/openapi/json-content"
import {
  conflictSchema,
  forbiddenSchema,
  internalServerErrorSchema,
  notFoundSchema,
  unauthorizedSchema,
} from "@/lib/helpers/openapi/schemas"
import { sessionAuthMiddleware } from "@/middleware/session-auth"
import {
  approvalParamsSchema,
  channelTasksParamsSchema,
  channelTasksQuerySchema,
  getTaskResponseSchema,
  listChannelTasksResponseSchema,
  resolveApprovalResponseSchema,
  taskParamsSchema,
} from "@/routes/v1/tasks/schema"

export const listChannelTasks = createRoute({
  path: "/channels/{channelId}/tasks",
  method: "get",
  summary: "List a channel's tasks",
  description:
    "Returns the channel's tasks, newest first. Pass active=true for only tasks that are running or waiting on the team.",
  tags: ["Tasks"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: channelTasksParamsSchema,
    query: channelTasksQuerySchema,
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: listChannelTasksResponseSchema,
      description: "Channel tasks",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type ListChannelTasksRoute = typeof listChannelTasks

export const getTask = createRoute({
  path: "/tasks/{taskId}",
  method: "get",
  summary: "Get a task",
  description:
    "Returns the task snapshot plus its pending approval, if one is waiting on the team.",
  tags: ["Tasks"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: taskParamsSchema,
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: getTaskResponseSchema,
      description: "Task and pending approval",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type GetTaskRoute = typeof getTask

export const approveApproval = createRoute({
  path: "/approvals/{approvalId}/approve",
  method: "post",
  summary: "Approve a requested action",
  description:
    "Marks the approval approved, posts the resolution into the task thread as the approver, and starts the task's continuation run.",
  tags: ["Tasks"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: approvalParamsSchema,
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: resolveApprovalResponseSchema,
      description: "Approval resolved",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type ApproveApprovalRoute = typeof approveApproval

export const rejectApproval = createRoute({
  path: "/approvals/{approvalId}/reject",
  method: "post",
  summary: "Reject a requested action",
  description:
    "Marks the approval rejected, posts the resolution into the task thread as the rejecter, and starts the task's continuation run so the agent can adjust.",
  tags: ["Tasks"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: approvalParamsSchema,
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: resolveApprovalResponseSchema,
      description: "Approval resolved",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type RejectApprovalRoute = typeof rejectApproval
