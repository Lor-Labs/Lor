import { and, db, eq, schema } from "@repo/db"
import { env } from "@repo/env/server"
import { decryptSecret, encryptSecret } from "@repo/utils/crypto"
import { features } from "@repo/utils/features"
import {
  claudeTokenDetails,
  normalizeClaudeToken,
  verifyClaudeToken,
} from "@/lib/claude-account"
import {
  exchangeGithubCode,
  fetchGithubProfile,
  fillMissingGithubAvatar,
  githubAccountsAvailable,
  githubAuthorizeUrl,
  revokeGithubToken,
} from "@/lib/github-account"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { logger } from "@/lib/logger"
import { signOAuthState, verifyOAuthState } from "@/lib/oauth-state"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  ConnectClaudeAccountRoute,
  ConnectGithubAccountRoute,
  DisconnectClaudeAccountRoute,
  DisconnectGithubAccountRoute,
  GetPersonalAccountsRoute,
  StartGithubAccountConnectRoute,
} from "@/routes/v1/personal-accounts/routes"

// The signed state's routing slug. Personal accounts have no workspace; the
// signature still binds the flow to the user who started it.
const GITHUB_STATE_SLUG = "github-account"

const accountColumns = {
  login: schema.personalAccount.login,
  name: schema.personalAccount.name,
  email: schema.personalAccount.email,
  avatarUrl: schema.personalAccount.avatarUrl,
}

const isGithubAccount = (userId: string) =>
  and(
    eq(schema.personalAccount.userId, userId),
    eq(schema.personalAccount.provider, "github")
  )

const isClaudeAccount = (userId: string) =>
  and(
    eq(schema.personalAccount.userId, userId),
    eq(schema.personalAccount.provider, "claude")
  )

// A reconnect replaces the token, so "connected" is the last update.
const claudeAccountColumns = {
  login: schema.personalAccount.login,
  updatedAt: schema.personalAccount.updatedAt,
  accessTokenExpiresAt: schema.personalAccount.accessTokenExpiresAt,
}

const toClaudeAccount = (row: {
  login: string
  updatedAt: Date
  accessTokenExpiresAt: Date | null
}) => ({
  tokenHint: row.login,
  connectedAt: row.updatedAt.toISOString(),
  expiresAt: row.accessTokenExpiresAt?.toISOString() ?? null,
})

export const getPersonalAccounts: AppRouteHandler<
  GetPersonalAccountsRoute
> = async (c) => {
  const [account, claude] = await Promise.all([
    db
      .select(accountColumns)
      .from(schema.personalAccount)
      .where(isGithubAccount(c.var.user.id))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select(claudeAccountColumns)
      .from(schema.personalAccount)
      .where(isClaudeAccount(c.var.user.id))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ])
  await fillMissingGithubAvatar(c.var.user, account?.avatarUrl)
  return c.json(
    {
      github: { available: githubAccountsAvailable(), account },
      claude: {
        available:
          features.claudeCodeHarness && Boolean(env.INTEGRATION_ENCRYPTION_KEY),
        account: claude ? toClaudeAccount(claude) : null,
      },
    },
    HttpStatusCodes.OK
  )
}

// Checked with Anthropic before it is stored, so a cut-off paste fails here
// rather than on the person's first Claude Code turn.
export const connectClaudeAccount: AppRouteHandler<
  ConnectClaudeAccountRoute
> = async (c) => {
  const refuse = (message: string) =>
    c.json({ success: false as const, message }, HttpStatusCodes.BAD_REQUEST)
  if (!features.claudeCodeHarness)
    return refuse("Claude Code is temporarily unavailable")
  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!key) return refuse("Claude subscriptions aren't available yet")
  const token = normalizeClaudeToken(c.req.valid("json").token)
  if (!token) {
    return refuse(
      "That isn't a Claude setup token. It starts with sk-ant-oat01-; run claude setup-token to get one"
    )
  }
  const verified = await verifyClaudeToken(token)
  if (verified === "rejected") {
    return refuse(
      "Anthropic didn't accept that token. Run claude setup-token again and paste all of it"
    )
  }
  if (verified === "unreachable") {
    return refuse("Couldn't reach Anthropic to check the token. Try again")
  }
  const values = {
    ...claudeTokenDetails(token),
    accessToken: encryptSecret(token, key),
    name: null,
    email: null,
    avatarUrl: null,
    refreshToken: null,
    refreshTokenExpiresAt: null,
    // Another subscription can offer other models: the picker reads them again.
    models: null,
  }
  const [row] = await db
    .insert(schema.personalAccount)
    .values({ userId: c.var.user.id, provider: "claude", ...values })
    .onConflictDoUpdate({
      target: [schema.personalAccount.userId, schema.personalAccount.provider],
      set: values,
    })
    .returning(claudeAccountColumns)
  if (!row) throw new Error("Claude account upsert returned no row")
  return c.json({ account: toClaudeAccount(row) }, HttpStatusCodes.OK)
}

// Anthropic has no endpoint to revoke a setup token; the person revokes it in
// their Claude account settings if they want it gone there too.
export const disconnectClaudeAccount: AppRouteHandler<
  DisconnectClaudeAccountRoute
> = async (c) => {
  await db.delete(schema.personalAccount).where(isClaudeAccount(c.var.user.id))
  return c.json({ success: true as const }, HttpStatusCodes.OK)
}

export const startGithubAccountConnect: AppRouteHandler<
  StartGithubAccountConnectRoute
> = async (c) => {
  const url = githubAccountsAvailable()
    ? githubAuthorizeUrl(signOAuthState(GITHUB_STATE_SLUG, c.var.user.id))
    : null
  if (!url) {
    return c.json(
      { success: false, message: "GitHub accounts aren't available" },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  return c.json({ url }, HttpStatusCodes.OK)
}

export const connectGithubAccount: AppRouteHandler<
  ConnectGithubAccountRoute
> = async (c) => {
  const { code, state } = c.req.valid("json")
  // Minted for this user, so a code can't be replayed into another account.
  if (verifyOAuthState(state, c.var.user.id) !== GITHUB_STATE_SLUG) {
    return c.json(
      { success: false, message: "Invalid or expired connection request" },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  const connected = await exchangeGithubCode(code)
    .then(async ({ plainAccessToken, ...tokens }) => ({
      tokens,
      profile: await fetchGithubProfile(plainAccessToken),
    }))
    .catch((err) => {
      logger.warn({ err }, "GitHub account connect failed")
      return null
    })
  if (!connected) {
    return c.json(
      { success: false, message: "Couldn't connect GitHub" },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  const values = { ...connected.profile, ...connected.tokens }
  const [account] = await db
    .insert(schema.personalAccount)
    .values({ userId: c.var.user.id, provider: "github", ...values })
    .onConflictDoUpdate({
      target: [schema.personalAccount.userId, schema.personalAccount.provider],
      set: values,
    })
    .returning(accountColumns)
  if (!account) throw new Error("GitHub account upsert returned no row")
  await fillMissingGithubAvatar(c.var.user, account.avatarUrl)
  return c.json({ account }, HttpStatusCodes.OK)
}

export const disconnectGithubAccount: AppRouteHandler<
  DisconnectGithubAccountRoute
> = async (c) => {
  const [removed] = await db
    .delete(schema.personalAccount)
    .where(isGithubAccount(c.var.user.id))
    .returning({ accessToken: schema.personalAccount.accessToken })
  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (removed && key) {
    // Inside the chain: a token that fails to decrypt must not fail the
    // disconnect, which already happened.
    void Promise.resolve()
      .then(() => revokeGithubToken(decryptSecret(removed.accessToken, key)))
      .catch((err) => logger.warn({ err }, "GitHub token revoke failed"))
  }
  return c.json({ success: true as const }, HttpStatusCodes.OK)
}
