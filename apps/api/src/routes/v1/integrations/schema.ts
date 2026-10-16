import { z } from "@hono/zod-openapi"
import { AWS_REGIONS, DATADOG_SITES } from "@repo/connectors"
import { integrationProviderEnum } from "@repo/db/schema"

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
// A repository the connected installation can access. Repo access is managed
// on GitHub (the App install picker); the PR base branch for code actions is
// configurable here (null = the repo's default branch).
export const integrationRepoSchema = z.object({
  fullName: z.string(),
  private: z.boolean(),
  defaultBranch: z.string(),
  baseBranch: z.string().nullable(),
})

export const integrationStatusSchema = z.object({
  id: z.enum(integrationProviderEnum.enumValues), // provider id, e.g. "github"
  name: z.string(), // display name, e.g. "GitHub"
  description: z.string(),
  tools: z.array(
    z.object({
      name: z.string(),
      label: z.string(),
      description: z.string(),
      readOnlyHint: z.boolean(),
      defaultEnabled: z.boolean(),
    })
  ),
  enabledTools: z.array(z.string()),
  connected: z.boolean(),
  accountLogin: z.string().nullable(),
  connectionId: z.string().nullable(),
  // Mirrors ConnectorAuthType — api-key connectors connect via an in-app form
  // instead of a redirect; `token` (BYO webhooks) never appears here but keeps
  // the enum aligned with the registry type.
  authType: z.enum(["github-app", "oauth", "api-key", "token"]),
  // connector:manage: connecting, disconnecting and configuring connectors is
  // admin-only, though every member may use the granted tools.
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
  // The provider's triggerable event kinds (from the connector registry), each
  // with its trigger config; channelId null = the event is off.
  events: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      channelId: z.string().nullable(),
      post: z.boolean(),
      remember: z.boolean(),
      rememberHint: z.string().nullable(),
      actInstructions: z.string().nullable(),
      // Act rate shape (reference/automation-primitives.md §5).
      actWindowSeconds: z.number(),
      hourlyRunCap: z.number(),
      dailyRunCap: z.number(),
      // Newest Act run on this event's trigger + the handoff note it left for
      // the next run. Read-only; null = never run (or no trigger).
      lastAct: z
        .object({
          note: z.string().nullable(),
          state: z.string(),
          stopReason: z.string().nullable(),
          at: z.string(),
        })
        .nullable(),
    })
  ),
})

export const listIntegrationsResponseSchema = z.object({
  providers: z.array(integrationStatusSchema),
})

export const startGithubConnectResponseSchema = z.object({
  url: z.string(),
})

export const completeGithubSetupRequestSchema = z.object({
  // GitHub App installation ids are numeric; reject anything else up front.
  installationId: z.string().regex(/^\d+$/),
  // The signed state from the install URL. GitHub's configure-page redirect
  // can omit it; the server then uses the recorded connect intent.
  state: z.string().min(1).optional(),
})

export const completeGithubSetupResponseSchema = z.object({
  success: z.literal(true),
  workspaceSlug: z.string(),
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

export const connectCloudwatchRequestSchema = z.object({
  region: z.enum(AWS_REGIONS),
  accessKeyId: z.string().min(1),
  // The secret for a read-only IAM user (logs + cloudwatch read), ideally
  // scoped to just DescribeLogGroups/StartQuery/GetQueryResults/GetMetricData.
  secretAccessKey: z.string().min(1),
})

export const connectCloudwatchResponseSchema = z.object({
  success: z.literal(true),
  accountLogin: z.string().nullable(),
})

export const updateIntegrationRequestSchema = z.object({
  // One of the provider's event keys from the connector registry.
  event: z.string().min(1),
  // The trigger's anchor channel (target/scope of every effect); null removes
  // the trigger — the event is off.
  channelId: z.string().uuid().nullable(),
  post: z.boolean().default(true),
  remember: z.boolean().default(false),
  // Optional steering for Remember's summarize pass.
  rememberHint: z.string().trim().max(2000).nullable().default(null),
  // The Act effect's instructions for Lor; null = Act off.
  actInstructions: z.string().trim().max(4000).nullable().default(null),
  // Act rate shape. Optional (not defaulted) so a client that doesn't know
  // about these can't silently reset them on an unrelated toggle.
  actWindowSeconds: z.number().int().min(0).max(3600).optional(),
  hourlyRunCap: z.number().int().min(1).max(500).optional(),
  dailyRunCap: z.number().int().min(1).max(2000).optional(),
})

export const updateIntegrationResponseSchema = z.object({
  success: z.literal(true),
})

// Same shape git itself allows for branch names we're willing to interpolate
// (mirrors the code-session SAFE_REF guard).
const baseBranchSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9._/-]+$/, "Not a valid branch name")
  .refine((v) => !v.includes("..") && !v.startsWith("-"), {
    message: "Not a valid branch name",
  })

export const updateGithubRepoConfigRequestSchema = z.object({
  repoFullName: z.string().min(3).max(200),
  // The branch code-action pull requests target for this repo; null resets to
  // the repository's default branch.
  baseBranch: baseBranchSchema.nullable(),
})

export const updateGithubRepoConfigResponseSchema = z.object({
  success: z.literal(true),
})

export const disconnectResponseSchema = z.object({
  success: z.literal(true),
})

export const updateIntegrationToolsRequestSchema = z.object({
  enabledTools: z.array(z.string().trim().min(1).max(128)).max(200),
})

export const connectBetterstackRequestSchema = z.object({
  apiToken: z
    .string()
    .trim()
    .min(1)
    .max(4096)
    .refine(
      (value) => !/\s/.test(value),
      "API tokens cannot contain whitespace"
    ),
})

export const connectBetterstackResponseSchema = z.object({
  success: z.literal(true),
  accountLogin: z.string().nullable(),
})
