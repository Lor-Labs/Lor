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
  approvalParamsSchema,
  resolveApprovalResponseSchema,
} from "@/routes/v1/approvals/schema"

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
  hidden: true,
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
  hidden: true,
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
