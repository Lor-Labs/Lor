import { createRoute, z } from "@hono/zod-openapi"
import { assertWorkspaceActive } from "@repo/db/queries/beta-access"
import {
  removeWorkspaceInferenceKey,
  saveWorkspaceInferenceKey,
  workspaceInferenceKeys,
} from "@repo/db/queries/inference"
import { verifyProviderKey } from "@repo/lor/byok"
import { KEY_PROVIDERS } from "@repo/utils/inference"
import jsonContent from "@/lib/helpers/openapi/json-content"
import { assertWorkspaceAuthority } from "@/lib/permissions"
import type { AppRouteHandler } from "@/lib/types/app-types"
import { workspaceAuthMiddleware } from "@/middleware/workspace-auth"
import { billingWorkspaceParamsSchema } from "./schema"

// The workspace's own Anthropic/OpenAI keys, one per provider. Composer
// models listed under a key run on it; see reference/beta-pricing-runbook.md.

const provider = z.enum(KEY_PROVIDERS)
const result = z.object({
  keys: z.array(
    z.object({
      provider,
      lastFour: z.string(),
      createdAt: z.string(),
      createdBy: z.string().nullable(),
    })
  ),
})
const providerParams = billingWorkspaceParamsSchema.extend({
  provider: provider.openapi({
    param: { name: "provider", in: "path", required: true },
  }),
})
const path = "/workspaces/{workspaceSlug}/billing/provider-keys"

export const listProviderKeys = createRoute({
  path,
  tags: ["Billing"],
  middleware: [workspaceAuthMiddleware] as const,
  method: "get",
  request: { params: billingWorkspaceParamsSchema },
  responses: {
    200: jsonContent({ schema: result, description: "Masked provider keys" }),
  },
})
export const putProviderKey = createRoute({
  path: `${path}/{provider}`,
  tags: ["Billing"],
  middleware: [workspaceAuthMiddleware] as const,
  method: "put",
  request: {
    params: providerParams,
    body: jsonContent({
      description: "Provider API key",
      schema: z.object({ apiKey: z.string().trim().min(20).max(512) }),
    }),
  },
  responses: {
    200: jsonContent({ schema: result, description: "Key verified and saved" }),
    400: jsonContent({
      schema: z.object({ message: z.string() }),
      description: "The provider rejected the key",
    }),
  },
})
export const deleteProviderKey = createRoute({
  path: `${path}/{provider}`,
  tags: ["Billing"],
  middleware: [workspaceAuthMiddleware] as const,
  method: "delete",
  request: { params: providerParams },
  responses: {
    200: jsonContent({ schema: result, description: "Key removed" }),
  },
})

async function keysOf(workspaceId: string) {
  const keys = await workspaceInferenceKeys(workspaceId)
  return {
    keys: keys.map((key) => ({
      ...key,
      createdAt: key.createdAt.toISOString(),
    })),
  }
}

export const listProviderKeysHandler: AppRouteHandler<
  typeof listProviderKeys
> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { billing: ["manage"] })
  c.header("Cache-Control", "no-store")
  return c.json(await keysOf(c.var.workspace.id), 200)
}

export const putProviderKeyHandler: AppRouteHandler<
  typeof putProviderKey
> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { billing: ["manage"] })
  await assertWorkspaceActive(c.var.workspace.id)
  const { provider } = c.req.valid("param")
  const { apiKey } = c.req.valid("json")
  const native =
    provider === "anthropic"
      ? /^sk-ant-api\S+$/.test(apiKey)
      : /^sk-(?!ant-)\S+$/.test(apiKey)
  if (!native)
    return c.json(
      {
        message:
          "Use an API key from the provider's console. Subscription tokens are not supported.",
      },
      400
    )
  const rejected = await verifyProviderKey(provider, apiKey)
  if (rejected) return c.json({ message: rejected }, 400)
  await saveWorkspaceInferenceKey({
    workspaceId: c.var.workspace.id,
    provider,
    apiKey,
    createdById: c.var.user.id,
  })
  c.header("Cache-Control", "no-store")
  return c.json(await keysOf(c.var.workspace.id), 200)
}

// Stays available after the beta expires, so a team can always revoke.
export const deleteProviderKeyHandler: AppRouteHandler<
  typeof deleteProviderKey
> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { billing: ["manage"] })
  await removeWorkspaceInferenceKey(
    c.var.workspace.id,
    c.req.valid("param").provider
  )
  c.header("Cache-Control", "no-store")
  return c.json(await keysOf(c.var.workspace.id), 200)
}
