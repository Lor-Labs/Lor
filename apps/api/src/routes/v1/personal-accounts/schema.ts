import { z } from "@hono/zod-openapi"

export const githubAccountSchema = z.object({
  login: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  avatarUrl: z.string().nullable(),
})

export const claudeAccountSchema = z.object({
  id: z.string().uuid(),
  label: z.string().nullable(),
  unavailableUntil: z.string().nullable(),
  // The token's last four characters.
  tokenHint: z.string(),
  connectedAt: z.string(),
  expiresAt: z.string().nullable(),
})

export const chatgptAccountSchema = z.object({
  id: z.string().uuid(),
  label: z.string().nullable(),
  unavailableUntil: z.string().nullable(),
  // The sign-in's email; null when the token didn't carry one.
  email: z.string().nullable(),
  // The ChatGPT plan ("plus", "pro"), as the token names it.
  plan: z.string().nullable(),
  connectedAt: z.string(),
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
    accounts: z.array(claudeAccountSchema),
  }),
  chatgpt: z.object({
    // False when Codex is off or the server can't encrypt tokens.
    available: z.boolean(),
    account: chatgptAccountSchema.nullable(),
    accounts: z.array(chatgptAccountSchema),
  }),
})

export const connectClaudeAccountBodySchema = z.object({
  label: z.string().trim().max(80).optional(),
  token: z.string().min(1).max(2_000),
})

export const connectClaudeAccountResponseSchema = z.object({
  account: claudeAccountSchema,
})

export const connectChatgptAccountBodySchema = z.object({
  // The whole auth.json `codex login` saved.
  label: z.string().trim().max(80).optional(),
  authJson: z.string().min(1).max(20_000),
})

export const connectChatgptAccountResponseSchema = z.object({
  account: chatgptAccountSchema,
})

export const githubConnectUrlResponseSchema = z.object({ url: z.string() })

export const connectGithubAccountBodySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
})

export const connectGithubAccountResponseSchema = z.object({
  account: githubAccountSchema,
  // Set when a workspace's GitHub connector started this link; the client
  // continues to that workspace's App install.
  continueToWorkspaceSlug: z.string().nullable(),
})

export const disconnectGithubAccountResponseSchema = z.object({
  success: z.literal(true),
})

export const disconnectHarnessAccountQuerySchema = z.object({
  accountId: z.string().uuid().optional(),
})

// The default validation hook's body for a malformed query.
export const validationErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.unknown(),
})
