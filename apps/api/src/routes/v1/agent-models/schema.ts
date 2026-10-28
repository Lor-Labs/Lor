import { z } from "@hono/zod-openapi"

export const agentModelsQuerySchema = z.object({
  harness: z
    .enum(["pi", "claude_code", "codex"])
    .openapi({ param: { name: "harness", in: "query", required: true } }),
})

export const agentModelsResponseSchema = z.object({
  models: z.array(
    z.object({
      // What a message sends as its model.
      id: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      resolvedModel: z.string().nullable(),
      provider: z.string().nullable(),
      // Effort levels the model takes, lowest first; empty: none to pick.
      efforts: z.array(z.string()),
      fast: z.boolean(),
    })
  ),
  defaultModel: z.string(),
  defaultEffort: z.string().nullable(),
})
