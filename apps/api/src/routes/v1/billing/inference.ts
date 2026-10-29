import { createRoute, z } from "@hono/zod-openapi"
import { assertWorkspaceActive } from "@repo/db/queries/beta-access"
import {
  removeWorkspaceInferenceKey,
  saveWorkspaceInferenceKey,
  workspaceInferenceSummary,
} from "@repo/db/queries/inference"
import { byokModels } from "@repo/lor/byok"
import jsonContent from "@/lib/helpers/openapi/json-content"
import { assertWorkspaceAuthority } from "@/lib/permissions"
import type { AppRouteHandler } from "@/lib/types/app-types"
import { workspaceAuthMiddleware } from "@/middleware/workspace-auth"
import { billingWorkspaceParamsSchema } from "./schema"

const provider = z.enum(["anthropic", "openai"])
const summary = z
  .object({ provider, model: z.string(), lastFour: z.string() })
  .nullable()
const result = z.object({
  key: summary,
  models: z.array(z.object({ provider, id: z.string(), name: z.string() })),
})
const common = {
  path: "/workspaces/{workspaceSlug}/billing/inference" as const,
  tags: ["Billing"],
}
export const getInference = createRoute({
  ...common,
  middleware: [workspaceAuthMiddleware] as const,
  method: "get",
  request: { params: billingWorkspaceParamsSchema },
  responses: {
    200: jsonContent({
      schema: result,
      description: "Masked workspace key and supported models",
    }),
  },
})
export const putInference = createRoute({
  ...common,
  middleware: [workspaceAuthMiddleware] as const,
  method: "put",
  request: {
    params: billingWorkspaceParamsSchema,
    body: jsonContent({
      description: "Workspace API key",
      schema: z.object({
        provider,
        model: z.string().min(1).max(200),
        apiKey: z.string().trim().min(20).max(512),
      }),
    }),
  },
  responses: {
    200: jsonContent({ schema: result, description: "Key saved" }),
    400: jsonContent({
      schema: z.object({ message: z.string() }),
      description: "Invalid provider, model or key",
    }),
  },
})
export const deleteInference = createRoute({
  ...common,
  middleware: [workspaceAuthMiddleware] as const,
  method: "delete",
  request: { params: billingWorkspaceParamsSchema },
  responses: {
    200: jsonContent({ schema: result, description: "Key removed" }),
  },
})
export const getInferenceHandler: AppRouteHandler<typeof getInference> = async (
  c
) => {
  assertWorkspaceAuthority(c.var.authority, { billing: ["manage"] })
  c.header("Cache-Control", "no-store")
  return c.json(
    {
      key: await workspaceInferenceSummary(c.var.workspace.id),
      models: byokModels(),
    },
    200
  )
}
export const putInferenceHandler: AppRouteHandler<typeof putInference> = async (
  c
) => {
  assertWorkspaceAuthority(c.var.authority, { billing: ["manage"] })
  await assertWorkspaceActive(c.var.workspace.id)
  const input = c.req.valid("json")
  const models = byokModels()
  const validKey =
    input.provider === "anthropic"
      ? /^sk-ant-api\S+$/.test(input.apiKey)
      : /^sk-(?!ant-)\S+$/.test(input.apiKey)
  if (
    !validKey ||
    !models.some(
      (model) => model.provider === input.provider && model.id === input.model
    )
  )
    return c.json(
      {
        message:
          "Choose a supported model and a native provider API key. Subscription tokens are not supported.",
      },
      400
    )
  await saveWorkspaceInferenceKey({ workspaceId: c.var.workspace.id, ...input })
  c.header("Cache-Control", "no-store")
  return c.json(
    { key: await workspaceInferenceSummary(c.var.workspace.id), models },
    200
  )
}
export const deleteInferenceHandler: AppRouteHandler<
  typeof deleteInference
> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { billing: ["manage"] })
  await removeWorkspaceInferenceKey(c.var.workspace.id)
  return c.json({ key: null, models: byokModels() }, 200)
}
