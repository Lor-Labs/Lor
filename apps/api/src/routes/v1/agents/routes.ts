import { createRoute } from "@hono/zod-openapi"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import jsonContent from "@/lib/helpers/openapi/json-content"
import {
  badRequestSchema,
  forbiddenSchema,
  notFoundSchema,
  unauthorizedSchema,
} from "@/lib/helpers/openapi/schemas"
import { workspaceAuthMiddleware } from "@/middleware/workspace-auth"
import {
  agentFactParamsSchema,
  agentFactSchema,
  agentParamsSchema,
  agentSchema,
  agentWorkspaceParamsSchema,
  createAgentRequestSchema,
  deleteAgentFactResponseSchema,
  deleteAgentResponseSchema,
  listAgentFactsResponseSchema,
  listAgentsResponseSchema,
  updateAgentFactRequestSchema,
  updateAgentRequestSchema,
} from "@/routes/v1/agents/schema"

export const listAgents = createRoute({
  path: "/workspaces/{workspaceSlug}/agents",
  method: "get",
  summary: "List the workspace's agents",
  description:
    "The agents the caller can see, each with the channels it is in (reference/agents-and-chats.md).",
  tags: ["Agents"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: agentWorkspaceParamsSchema },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: listAgentsResponseSchema,
      description: "The agents",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
  },
})

export const createAgent = createRoute({
  path: "/workspaces/{workspaceSlug}/agents",
  method: "post",
  summary: "Create an agent",
  description:
    "A new agent, in no channel yet. A name or creature left out is picked for it.",
  tags: ["Agents"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: agentWorkspaceParamsSchema,
    body: jsonContent({
      schema: createAgentRequestSchema,
      description: "The agent's settings",
    }),
  },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: agentSchema,
      description: "The new agent",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
  },
})

export const updateAgent = createRoute({
  path: "/workspaces/{workspaceSlug}/agents/{agentId}",
  method: "patch",
  summary: "Change an agent's settings",
  description:
    "Its name, creature, role, brief or model. The change reaches every channel the agent is in.",
  tags: ["Agents"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: agentParamsSchema,
    body: jsonContent({
      schema: updateAgentRequestSchema,
      description: "The fields to change",
    }),
  },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: agentSchema,
      description: "The agent",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
  },
})

export const deleteAgent = createRoute({
  path: "/workspaces/{workspaceSlug}/agents/{agentId}",
  method: "delete",
  summary: "Delete an agent",
  description:
    "Removes the agent and its facts. The channels it was in are left with no agent.",
  tags: ["Agents"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: agentParamsSchema },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: deleteAgentResponseSchema,
      description: "The agent was deleted",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
  },
})

export const listAgentFacts = createRoute({
  path: "/workspaces/{workspaceSlug}/agents/{agentId}/facts",
  method: "get",
  summary: "List an agent's facts",
  description:
    "The facts the agent keeps, each with its source and date (reference/always-on-agents.md §7).",
  tags: ["Agents"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: agentParamsSchema },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: listAgentFactsResponseSchema,
      description: "The agent's facts",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
  },
})

export const updateAgentFact = createRoute({
  path: "/workspaces/{workspaceSlug}/agents/{agentId}/facts/{factId}",
  method: "patch",
  summary: "Edit one of an agent's facts",
  description: "Anyone who can see the agent can edit a fact.",
  tags: ["Agents"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: agentFactParamsSchema,
    body: jsonContent({
      schema: updateAgentFactRequestSchema,
      description: "The fact's new text",
    }),
  },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: agentFactSchema,
      description: "The edited fact",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
  },
})

export const deleteAgentFact = createRoute({
  path: "/workspaces/{workspaceSlug}/agents/{agentId}/facts/{factId}",
  method: "delete",
  summary: "Delete one of an agent's facts",
  description: "Anyone who can see the agent can delete a fact.",
  tags: ["Agents"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: agentFactParamsSchema },
  hide: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: deleteAgentFactResponseSchema,
      description: "The fact was deleted",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
  },
})

export type ListAgentsRoute = typeof listAgents
export type CreateAgentRoute = typeof createAgent
export type UpdateAgentRoute = typeof updateAgent
export type DeleteAgentRoute = typeof deleteAgent
export type ListAgentFactsRoute = typeof listAgentFacts
export type UpdateAgentFactRoute = typeof updateAgentFact
export type DeleteAgentFactRoute = typeof deleteAgentFact
