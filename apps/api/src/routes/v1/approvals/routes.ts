import { createRoute } from "@hono/zod-openapi"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import jsonContent from "@/lib/helpers/openapi/json-content"
import {
  badRequestSchema,
  conflictSchema,
  forbiddenSchema,
  internalServerErrorSchema,
  notFoundSchema,
  unauthorizedSchema,
} from "@/lib/helpers/openapi/schemas"
import { sessionAuthMiddleware } from "@/middleware/session-auth"
import {
  answerApprovalBodySchema,
  approvalParamsSchema,
  approvePlanBodySchema,
  channelApprovalsParamsSchema,
  channelApprovalsQuerySchema,
  listChannelApprovalsResponseSchema,
  resolveApprovalResponseSchema,
} from "@/routes/v1/approvals/schema"

export const listChannelApprovals = createRoute({
  path: "/channels/{channelId}/approvals",
  method: "get",
  summary: "List a channel's approvals",
  description:
    "Returns approvals for runs in this channel, anchored to the message whose run parked: the pending ones, or with threadRootId every approval in that session (resolved ones show who decided).",
  tags: ["Approvals"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: channelApprovalsParamsSchema,
    query: channelApprovalsQuerySchema,
  },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: listChannelApprovalsResponseSchema,
      description: "Pending approvals",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type ListChannelApprovalsRoute = typeof listChannelApprovals

// Session auth rather than workspace auth: the path carries no workspace slug,
// so the handler resolves the approval's workspace and the caller's authority
// itself (see reference/approval-policies.md).
export const approveApproval = createRoute({
  path: "/approvals/{approvalId}/approve",
  method: "post",
  summary: "Approve a requested action",
  description:
    "Marks the approval approved, posts the resolution into the run's scope as the approver, and starts the continuation run that carries the action out.",
  tags: ["Approvals"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: approvalParamsSchema,
  },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: resolveApprovalResponseSchema,
      description: "Approval resolved",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type ApproveApprovalRoute = typeof approveApproval

export const approvePlanApproval = createRoute({
  path: "/approvals/{approvalId}/approve-plan",
  method: "post",
  summary: "Approve a Claude Code plan",
  description:
    "Approves a Claude Code plan (ExitPlanMode) and sets the mode its turn goes on in, as in Claude Code's own plan dialog. Only the turn's sender may approve it.",
  tags: ["Approvals"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: approvalParamsSchema,
    body: jsonContent({
      schema: approvePlanBodySchema,
      description: "The mode the turn goes on in",
    }),
  },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: resolveApprovalResponseSchema,
      description: "Plan approved",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type ApprovePlanApprovalRoute = typeof approvePlanApproval

export const answerApproval = createRoute({
  path: "/approvals/{approvalId}/answer",
  method: "post",
  summary: "Answer a Claude Code question",
  description:
    "Answers a Claude Code question (AskUserQuestion) and continues its turn with the answers. Only the turn's sender may answer it.",
  tags: ["Approvals"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: approvalParamsSchema,
    body: jsonContent({
      schema: answerApprovalBodySchema,
      description: "The answers, per question id",
    }),
  },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: resolveApprovalResponseSchema,
      description: "Question answered",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type AnswerApprovalRoute = typeof answerApproval

export const rejectApproval = createRoute({
  path: "/approvals/{approvalId}/reject",
  method: "post",
  summary: "Reject a requested action",
  description:
    "Marks the approval rejected, posts the resolution into the run's scope as the rejecter, and starts the continuation run so the agent can adjust.",
  tags: ["Approvals"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: approvalParamsSchema,
  },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: resolveApprovalResponseSchema,
      description: "Approval resolved",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type RejectApprovalRoute = typeof rejectApproval
