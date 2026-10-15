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
  })
  .strict()

export type ProfileToolSelection = z.infer<typeof profileToolSelectionSchema>
export type ProfileToolAccess = z.infer<typeof profileToolAccessSchema>

// Missing overrides follow workspace selections; there is no legacy grant fallback.
export const DEFAULT_PROFILE_TOOL_ACCESS: ProfileToolAccess = {
  connectors: {},
  mcpServers: {},
}
