import { z } from "@hono/zod-openapi"
import { DATADOG_SITES } from "@repo/connectors"
import { integrationProviderEnum, merlinCapabilityEnum } from "@repo/db/schema"

export const integrationsWorkspaceParamsSchema = z.object({
  workspaceSlug: z.string().openapi({
    param: { name: "workspaceSlug", in: "path", required: true },
  }),
})

export const connectionIdParamsSchema =
  integrationsWorkspaceParamsSchema.extend({
    connectionId: z
      .string()
      .uuid()
      .openapi({ param: { name: "connectionId", in: "path", required: true } }),
  })

// One row per integration provider: whether this workspace has it connected,
// and how to connect it.
// A repository the connected installation can access. Repos are managed on
// GitHub (the App install picker), surfaced here read-only.
export const integrationRepoSchema = z.object({
  fullName: z.string(),
  private: z.boolean(),
})

export const integrationStatusSchema = z.object({
  id: z.enum(integrationProviderEnum.enumValues), // provider id, e.g. "github"
  name: z.string(), // display name, e.g. "GitHub"
  description: z.string(),
  capabilities: z.array(
    z.object({
      key: z.enum(merlinCapabilityEnum.enumValues),
      label: z.string(),
      description: z.string(),
    })
  ),
  connected: z.boolean(),
  accountLogin: z.string().nullable(),
  connectionId: z.string().nullable(),
  // Mirrors ConnectorAuthType — api-key connectors connect via an in-app form
  // instead of a redirect, so they have no connectUrl.
  authType: z.enum(["github-app", "oauth", "api-key"]),
  // Some org-shared connectors (currently Notion) can only be managed by a
  // Lor workspace admin even though every member may use the granted tools.
  canManage: z.boolean(),
  // Whether the server is configured to accept a connection right now.
  available: z.boolean(),
  connectUrl: z.string().nullable(), // null when the provider isn't configured
  // Accessible repos + the GitHub management URL; null when not connected or
  // the installation can't be enumerated (App not configured). `repos` may be
  // capped for payload size — use `repoCount` for the true total.
  repos: z.array(integrationRepoSchema).nullable(),
  repoCount: z.number().nullable(),
  manageUrl: z.string().nullable(),
  // The provider's notifiable event kinds (from the connector registry), each
  // with the channel it currently posts to; null = off.
  events: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      channelId: z.string().nullable(),
    })
  ),
})

export const listIntegrationsResponseSchema = z.object({
  providers: z.array(integrationStatusSchema),
})

export const connectGithubRequestSchema = z.object({
  // GitHub App installation ids are numeric; reject anything else up front.
  installationId: z.string().regex(/^\d+$/),
})

export const connectGithubResponseSchema = z.object({
  success: z.literal(true),
  accountLogin: z.string().nullable(),
})

export const connectLinearRequestSchema = z.object({
  // The OAuth authorization code from Linear's callback.
  code: z.string().min(1),
  // The signed `state` Linear echoed back, verified server-side (CSRF).
  state: z.string().min(1),
})

export const connectLinearResponseSchema = z.object({
  success: z.literal(true),
  accountLogin: z.string().nullable(),
})

export const connectAttioRequestSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
})

export const connectAttioResponseSchema = z.object({
  success: z.literal(true),
  accountLogin: z.string().nullable(),
})

export const connectNotionRequestSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
})

export const connectNotionResponseSchema = z.object({
  success: z.literal(true),
  accountLogin: z.string().nullable(),
})

export const connectDatadogRequestSchema = z.object({
  site: z.enum(DATADOG_SITES),
  apiKey: z.string().min(1),
  // A scoped application key with logs read access, ideally from a service account.
  appKey: z.string().min(1),
})

export const connectDatadogResponseSchema = z.object({
  success: z.literal(true),
  accountLogin: z.string().nullable(),
})

export const updateIntegrationRequestSchema = z.object({
  // One of the provider's event keys from the connector registry.
  event: z.string().min(1),
  // Text channel this event posts into; null turns it off.
  notifyChannelId: z.string().uuid().nullable(),
})

export const updateIntegrationResponseSchema = z.object({
  success: z.literal(true),
})

export const disconnectResponseSchema = z.object({
  success: z.literal(true),
})
