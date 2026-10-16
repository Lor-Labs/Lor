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
  bulkApprovalPoliciesRequestSchema,
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
    "Returns approval gates and individual built-in, custom HTTP, and MCP tools. Core messaging and memory tools are not gateable. A tool without a policy row is ungated.",
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

export const bulkApprovalPolicies = createRoute({
  path: "/workspaces/{workspaceSlug}/approval-policies/bulk",
  method: "put",
  summary: "Update approval requirements for selected tools",
  description:
    "Atomically enable or remove individual tool rules. Enabling preserves existing resolvers and assigns any member to newly enabled rules.",
  tags: ["Approvals"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: approvalPoliciesParamsSchema,
    body: jsonContent({
      schema: bulkApprovalPoliciesRequestSchema,
      description: "Explicit tool targets and approval requirement",
    }),
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: deleteApprovalPolicyResponseSchema,
      description: "Policies updated",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type BulkApprovalPoliciesRoute = typeof bulkApprovalPolicies

export const deleteApprovalPolicy = createRoute({
  path: "/workspaces/{workspaceSlug}/approval-policies/{policyId}",
  method: "delete",
  summary: "Turn an approval gate off",
  description:
    "Deletes the policy row. Already-pending approvals stay answerable by any member (the action is no longer gated).",
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
