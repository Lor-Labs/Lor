import { createRoute, z } from "@hono/zod-openapi"
import {
  assertWorkspaceActive,
  workspaceBetaAccess,
} from "@repo/db/queries/beta-access"
import {
  currentWorkspaceInferenceCredential,
  removeWorkspaceInferenceKey,
  saveWorkspaceInferenceKey,
  workspaceInferenceKeys,
} from "@repo/db/queries/inference"
import {
  AZURE_MODELS,
  parseInferenceCredential,
  reusesSavedSecret,
  verifyInferenceCredential,
} from "@repo/lor/inference-providers"
import { KEY_PROVIDERS } from "@repo/utils/inference"
import { createRouter } from "@/lib/helpers/app/create-app"
import jsonContent from "@/lib/helpers/openapi/json-content"
import { assertWorkspaceAuthority } from "@/lib/permissions"
import type { AppRouteHandler } from "@/lib/types/app-types"
import { workspaceAuthMiddleware } from "@/middleware/workspace-auth"

// The workspace's own AI providers (BYOK), one credential per provider:
// Anthropic and OpenAI API keys, Azure OpenAI, Google Vertex AI and AWS
// Bedrock. Composer models listed under a provider run on it; see
// reference/beta-pricing-runbook.md. Managing them takes billing:manage,
// since the provider pays for those runs.

const provider = z.enum(KEY_PROVIDERS)
const deployment = z.object({
  model: z.string().min(1).max(100),
  deployment: z.string().trim().min(1).max(64),
})
const config = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("anthropic") }),
  z.object({ provider: z.literal("openai") }),
  z.object({
    provider: z.literal("azure"),
    endpoint: z.string(),
    deployments: z.array(deployment),
  }),
  z.object({
    provider: z.literal("google-vertex"),
    project: z.string(),
    location: z.string(),
    clientEmail: z.string(),
  }),
  z.object({
    provider: z.literal("amazon-bedrock"),
    region: z.string(),
    authMethod: z.enum(["access_key", "api_key"]),
    accessKeyId: z.string().nullable(),
  }),
])
const result = z.object({
  providers: z.array(
    z.object({
      provider,
      lastFour: z.string(),
      config,
      createdAt: z.string(),
      createdBy: z.string().nullable(),
    })
  ),
  // After the beta ends a provider can still be removed, not changed.
  locked: z.boolean(),
  // Models an Azure deployment can serve, for the deployment picker.
  azureModels: z.array(z.object({ id: z.string(), name: z.string() })),
})
const apiKey = z.string().trim().min(20).max(512)
// Secrets left out keep the saved value (inference-providers.ts).
const body = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("anthropic"), apiKey }),
  z.object({ provider: z.literal("openai"), apiKey }),
  z.object({
    provider: z.literal("azure"),
    endpoint: z.string().trim().min(1).max(300),
    apiKey: z.string().max(512).optional(),
    deployments: z.array(deployment).min(1).max(50),
  }),
  z.object({
    provider: z.literal("google-vertex"),
    serviceAccountKey: z.string().max(20_000).optional(),
    project: z.string().max(64).optional(),
    location: z.string().trim().min(1).max(64),
  }),
  z.object({
    provider: z.literal("amazon-bedrock"),
    region: z.string().trim().min(1).max(32),
    authMethod: z.enum(["access_key", "api_key"]),
    accessKeyId: z.string().max(128).optional(),
    secretAccessKey: z.string().max(256).optional(),
    apiKey: z.string().max(8192).optional(),
  }),
])
const params = z.object({
  workspaceSlug: z.string().openapi({
    param: { name: "workspaceSlug", in: "path", required: true },
  }),
})
const providerParams = params.extend({
  provider: provider.openapi({
    param: { name: "provider", in: "path", required: true },
  }),
})
const path = "/workspaces/{workspaceSlug}/ai-providers"

const listAiProviders = createRoute({
  path,
  tags: ["AI providers"],
  middleware: [workspaceAuthMiddleware] as const,
  method: "get",
  request: { params },
  responses: {
    200: jsonContent({ schema: result, description: "Saved AI providers" }),
  },
})
const putAiProvider = createRoute({
  path,
  tags: ["AI providers"],
  middleware: [workspaceAuthMiddleware] as const,
  method: "put",
  request: {
    params,
    body: jsonContent({ description: "Provider settings", schema: body }),
  },
  responses: {
    200: jsonContent({
      // What the provider check couldn't confirm, though the settings saved.
      schema: result.extend({ notice: z.string().nullable() }),
      description: "Settings verified and saved",
    }),
    400: jsonContent({
      schema: z.object({ message: z.string() }),
      description: "The settings are invalid or the provider rejected them",
    }),
    409: jsonContent({
      schema: z.object({ message: z.string() }),
      description: "The saved provider changed while it was being edited",
    }),
  },
})
const deleteAiProvider = createRoute({
  path: `${path}/{provider}`,
  tags: ["AI providers"],
  middleware: [workspaceAuthMiddleware] as const,
  method: "delete",
  request: { params: providerParams },
  responses: {
    200: jsonContent({ schema: result, description: "Provider removed" }),
  },
})

async function providersOf(workspaceId: string) {
  const [keys, access] = await Promise.all([
    workspaceInferenceKeys(workspaceId),
    workspaceBetaAccess(workspaceId),
  ])
  return {
    providers: keys.map((key) => ({
      ...key,
      createdAt: key.createdAt.toISOString(),
    })),
    locked: access.state !== "active",
    azureModels: AZURE_MODELS,
  }
}

const listHandler: AppRouteHandler<typeof listAiProviders> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { billing: ["manage"] })
  c.header("Cache-Control", "no-store")
  return c.json(await providersOf(c.var.workspace.id), 200)
}

const putHandler: AppRouteHandler<typeof putAiProvider> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { billing: ["manage"] })
  const workspaceId = c.var.workspace.id
  await assertWorkspaceActive(workspaceId)
  const input = c.req.valid("json")
  c.header("Cache-Control", "no-store")
  const saved = await currentWorkspaceInferenceCredential(
    workspaceId,
    input.provider
  )
  const reuses = Boolean(saved) && reusesSavedSecret(input)
  if (reuses && !saved?.credential)
    return c.json(
      {
        message:
          "The saved credentials can't be read anymore. Enter the secret again to replace them.",
      },
      400
    )
  const parsed = parseInferenceCredential(input, saved?.credential ?? null)
  if ("error" in parsed) return c.json({ message: parsed.error }, 400)
  const verified = await verifyInferenceCredential(parsed.credential)
  if ("error" in verified) return c.json({ message: verified.error }, 400)
  const written = await saveWorkspaceInferenceKey({
    workspaceId,
    credential: parsed.credential,
    createdById: c.var.user.id,
    ...(reuses && saved ? { replacesKeyId: saved.keyId } : {}),
  })
  if (!written)
    return c.json(
      {
        message:
          "Someone changed or removed this provider while you were editing. Reopen it and try again.",
      },
      409
    )
  return c.json(
    { ...(await providersOf(workspaceId)), notice: verified.notice },
    200
  )
}

// Stays available after the beta expires, so a team can always revoke.
const deleteHandler: AppRouteHandler<typeof deleteAiProvider> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { billing: ["manage"] })
  await removeWorkspaceInferenceKey(
    c.var.workspace.id,
    c.req.valid("param").provider
  )
  c.header("Cache-Control", "no-store")
  return c.json(await providersOf(c.var.workspace.id), 200)
}

const aiProvidersRouter = createRouter()
  .openapi(listAiProviders, listHandler)
  .openapi(putAiProvider, putHandler)
  .openapi(deleteAiProvider, deleteHandler)

export default aiProvidersRouter
