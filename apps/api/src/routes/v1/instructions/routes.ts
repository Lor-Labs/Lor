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
import { workspaceAuthMiddleware } from "@/middleware/workspace-auth"
import {
  getInstructionsResponseSchema,
  instructionsVersionParamsSchema,
  instructionsWorkspaceParamsSchema,
  resolveProposalResponseSchema,
  updateInstructionsRequestSchema,
  updateInstructionsResponseSchema,
} from "@/routes/v1/instructions/schema"

export const getInstructions = createRoute({
  path: "/workspaces/{workspaceSlug}/instructions",
  method: "get",
  summary: "Get workspace instructions",
  description:
    "Returns the active workspace instructions (LOR.md), any pending agent proposal, and recent version history.",
  tags: ["Instructions"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: instructionsWorkspaceParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: getInstructionsResponseSchema,
      description: "Active instructions, pending proposal, and history",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type GetInstructionsRoute = typeof getInstructions

export const updateInstructions = createRoute({
  path: "/workspaces/{workspaceSlug}/instructions",
  method: "put",
  summary: "Edit workspace instructions",
  description:
    "Direct owner/admin edit — creates a new version and activates it immediately (audited). Guarded on baseVersion so concurrent edits conflict instead of merging.",
  tags: ["Instructions"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: instructionsWorkspaceParamsSchema,
    body: jsonContent({
      schema: updateInstructionsRequestSchema,
      description: "New instructions content + the base version edited from",
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: updateInstructionsResponseSchema,
      description: "The new active version",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type UpdateInstructionsRoute = typeof updateInstructions

export const approveInstructionsProposal = createRoute({
  path: "/workspaces/{workspaceSlug}/instructions/{version}/approve",
  method: "post",
  summary: "Approve a pending instructions proposal",
  description:
    "Activates the exact proposed version. Fails with a conflict if the active instructions changed since the proposal was written.",
  tags: ["Instructions"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: instructionsVersionParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: resolveProposalResponseSchema,
      description: "Proposal approved and activated",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type ApproveInstructionsProposalRoute =
  typeof approveInstructionsProposal

export const rejectInstructionsProposal = createRoute({
  path: "/workspaces/{workspaceSlug}/instructions/{version}/reject",
  method: "post",
  summary: "Reject a pending instructions proposal",
  tags: ["Instructions"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: instructionsVersionParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: resolveProposalResponseSchema,
      description: "Proposal rejected",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type RejectInstructionsProposalRoute = typeof rejectInstructionsProposal
