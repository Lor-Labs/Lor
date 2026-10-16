import { z } from "zod"
import { integrationProviderEnum } from "./integration-connections"

export const profileToolSelectionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("workspace") }).strict(),
  z.object({ mode: z.literal("off") }).strict(),
  z
    .object({
      mode: z.literal("custom"),
      tools: z.array(z.string().trim().min(1).max(128)).max(200),
    })
    .strict(),
])

// Lor's own tools that need no connection, grouped like a service.
export const BUILTIN_TOOL_GROUPS = ["web", "artifacts"] as const
export type BuiltinToolGroup = (typeof BUILTIN_TOOL_GROUPS)[number]

// Every tool source uses the same selection: a missing entry follows the
// workspace (all available tools, including ones added later).
export const profileToolAccessSchema = z
  .object({
    connectors: z
      .partialRecord(
        z.enum(integrationProviderEnum.enumValues),
        profileToolSelectionSchema
      )
      .default({}),
    mcpServers: z
      .record(z.string().uuid(), profileToolSelectionSchema)
      .refine(
        (value) => Object.keys(value).length <= 200,
        "At most 200 MCP server overrides"
      )
      .default({}),
    builtins: z
      .partialRecord(z.enum(BUILTIN_TOOL_GROUPS), profileToolSelectionSchema)
      .default({}),
    // Custom HTTP tools; a custom selection lists custom_tool ids.
    customTools: profileToolSelectionSchema.optional(),
  })
  .strict()

export type ProfileToolSelection = z.infer<typeof profileToolSelectionSchema>
export type ProfileToolAccess = z.infer<typeof profileToolAccessSchema>

export const DEFAULT_PROFILE_TOOL_ACCESS: ProfileToolAccess = {
  connectors: {},
  mcpServers: {},
  builtins: {},
}
