import { z } from "@hono/zod-openapi"

export const githubAccountSchema = z.object({
  login: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  avatarUrl: z.string().nullable(),
})

export const claudeAccountSchema = z.object({
  // The token's last four characters.
  tokenHint: z.string(),
  connectedAt: z.string(),
  expiresAt: z.string().nullable(),
})

export const personalAccountsResponseSchema = z.object({
  github: z.object({
    // False when the server has no GitHub App OAuth client configured.
    available: z.boolean(),
    account: githubAccountSchema.nullable(),
  }),
  claude: z.object({
    // False when the server can't encrypt tokens.
    available: z.boolean(),
    account: claudeAccountSchema.nullable(),
  }),
})

export const connectClaudeAccountBodySchema = z.object({
  token: z.string().min(1).max(2_000),
})

export const connectClaudeAccountResponseSchema = z.object({
  account: claudeAccountSchema,
})

export const githubConnectUrlResponseSchema = z.object({ url: z.string() })

export const connectGithubAccountBodySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
})

export const connectGithubAccountResponseSchema = z.object({
  account: githubAccountSchema,
})

export const disconnectGithubAccountResponseSchema = z.object({
  success: z.literal(true),
})
