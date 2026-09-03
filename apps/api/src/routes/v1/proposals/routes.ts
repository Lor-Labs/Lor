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
  approveProposalRequestSchema,
  approveProposalResponseSchema,
  channelProposalsParamsSchema,
  getProposalResponseSchema,
  listChannelProposalsResponseSchema,
  proposalParamsSchema,
  rejectProposalRequestSchema,
  rejectProposalResponseSchema,
} from "@/routes/v1/proposals/schema"

export const getProposal = createRoute({
  path: "/proposals/{proposalId}",
  method: "get",
  summary: "Get a workspace change proposal",
  description:
    "Returns the proposal with its typed operations and the permission union an approver must hold.",
  tags: ["Change proposals"],
  middleware: [sessionAuthMiddleware] as const,
  request: { params: proposalParamsSchema },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: getProposalResponseSchema,
      description: "The proposal",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type GetProposalRoute = typeof getProposal

export const listChannelProposals = createRoute({
  path: "/channels/{channelId}/proposals",
  method: "get",
  summary: "List a channel's pending change proposals",
  description:
    "Returns pending proposals anchored to this channel, for card rendering on reload.",
  tags: ["Change proposals"],
  middleware: [sessionAuthMiddleware] as const,
  request: { params: channelProposalsParamsSchema },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: listChannelProposalsResponseSchema,
      description: "Pending proposals",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type ListChannelProposalsRoute = typeof listChannelProposals

export const rejectProposal = createRoute({
  path: "/proposals/{proposalId}/reject",
  method: "post",
  summary: "Reject a change proposal",
  description:
    "Marks the proposal rejected, posts the resolution (with the optional note) into the card thread as the rejecter, and starts a continuation run so the agent can revise.",
  tags: ["Change proposals"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: proposalParamsSchema,
    body: jsonContent({
      schema: rejectProposalRequestSchema,
      description: "Optional rejection note",
    }),
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: rejectProposalResponseSchema,
      description: "Proposal rejected",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type RejectProposalRoute = typeof rejectProposal

export const approveProposal = createRoute({
  path: "/proposals/{proposalId}/approve",
  method: "post",
  summary: "Approve and apply a change proposal",
  description:
    "Applies every operation in one transaction (nothing lands on failure), posts the results into the card thread as the approver, and starts the follow-up continuation run. Secrets for proposed custom tools ride this request only.",
  tags: ["Change proposals"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: proposalParamsSchema,
    body: jsonContent({
      schema: approveProposalRequestSchema,
      description: "Approver-supplied secrets, when the proposal declared any",
    }),
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: approveProposalResponseSchema,
      description: "Proposal applied (or failed — see status)",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type ApproveProposalRoute = typeof approveProposal
