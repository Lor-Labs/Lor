import { createRoute } from "@hono/zod-openapi"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import jsonContent from "@/lib/helpers/openapi/json-content"
import {
  badRequestSchema,
  forbiddenSchema,
  internalServerErrorSchema,
  notFoundSchema,
  unauthorizedSchema,
} from "@/lib/helpers/openapi/schemas"
import { workspaceAuthMiddleware } from "@/middleware/workspace-auth"
import {
  approvalPoliciesParamsSchema,
  approvalPolicyIdParamsSchema,
  deleteApprovalPolicyResponseSchema,
  listApprovalPoliciesResponseSchema,
  upsertApprovalPolicyRequestSchema,
  upsertApprovalPolicyResponseSchema,
} from "@/routes/v1/approval-policies/schema"

export const listApprovalPolicies = createRoute({
  path: "/workspaces/{workspaceSlug}/approval-policies",
  method: "get",
  summary: "List approval policies",
  description:
    "Returns the workspace's approval gates plus the full target list (capabilities, custom tools, MCP servers, core actions). A target without a policy row is ungated.",
  tags: ["Approvals"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: approvalPoliciesParamsSchema },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: listApprovalPoliciesResponseSchema,
      description: "Approval policies and available targets",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type ListApprovalPoliciesRoute = typeof listApprovalPolicies

export const upsertApprovalPolicy = createRoute({
  path: "/workspaces/{workspaceSlug}/approval-policies",
  method: "put",
  summary: "Turn an approval gate on or change its resolver",
  description:
    "Upserts the policy row for a target. Row existence is the gate: gated runs park until the configured resolver approves.",
  tags: ["Approvals"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: approvalPoliciesParamsSchema,
    body: jsonContent({
      schema: upsertApprovalPolicyRequestSchema,
      description: "Target and resolver",
    }),
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: upsertApprovalPolicyResponseSchema,
      description: "Policy saved",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type UpsertApprovalPolicyRoute = typeof upsertApprovalPolicy

export const deleteApprovalPolicy = createRoute({
  path: "/workspaces/{workspaceSlug}/approval-policies/{policyId}",
  method: "delete",
  summary: "Turn an approval gate off",
  description:
    "Deletes the policy row. Already-pending approvals stay answerable (they fall back to the approval permission).",
  tags: ["Approvals"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: approvalPolicyIdParamsSchema },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: deleteApprovalPolicyResponseSchema,
      description: "Policy deleted",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type DeleteApprovalPolicyRoute = typeof deleteApprovalPolicy
