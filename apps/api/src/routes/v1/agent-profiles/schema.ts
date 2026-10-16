import { z } from "@hono/zod-openapi"
import {
  DEFAULT_PROFILE_TOOL_ACCESS,
  profileToolAccessSchema,
  selectAgentProfileSchema,
} from "@repo/db/schema"

export const agentProfilesWorkspaceParamsSchema = z.object({
  workspaceSlug: z.string().openapi({
    param: { name: "workspaceSlug", in: "path", required: true },
  }),
})

export const agentProfileIdParamsSchema =
  agentProfilesWorkspaceParamsSchema.extend({
    profileId: z
      .string()
      .uuid()
      .openapi({ param: { name: "profileId", in: "path", required: true } }),
  })

export const agentProfileSchema = selectAgentProfileSchema
  .pick({
    id: true,
    name: true,
    isDefault: true,
    toolAccess: true,
  })
  .extend({
    toolAccess: profileToolAccessSchema,
  })

export const listAgentProfilesResponseSchema = z.object({
  profiles: z.array(agentProfileSchema),
  // Built-in tools, connected services, MCP servers and API tools. For API
  // tools, a tool's `name` is its custom_tool id and `label` its name.
  availableToolGroups: z.array(
    z.object({
      kind: z.enum(["builtin", "connector", "mcpServer", "customTools"]),
      id: z.string(),
      name: z.string(),
      description: z.string(),
      tools: z.array(
        z.object({
          name: z.string(),
          label: z.string(),
          description: z.string(),
          readOnlyHint: z.boolean().optional(),
        })
      ),
    })
  ),
})

export const createAgentProfileRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    toolAccess: profileToolAccessSchema.default(DEFAULT_PROFILE_TOOL_ACCESS),
  })
  .strict()

export const updateAgentProfileRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    toolAccess: profileToolAccessSchema.optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.toolAccess !== undefined, {
    message: "At least one field must be provided",
  })

export const deleteAgentProfileResponseSchema = z.object({
  success: z.literal(true),
})
