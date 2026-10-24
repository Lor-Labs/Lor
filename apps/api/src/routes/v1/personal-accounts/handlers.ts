import { and, db, eq, schema } from "@repo/db"
import { env } from "@repo/env/server"
import { decryptSecret } from "@repo/utils/crypto"
import {
  exchangeGithubCode,
  fetchGithubProfile,
  githubAccountsAvailable,
  githubAuthorizeUrl,
  revokeGithubToken,
} from "@/lib/github-account"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { logger } from "@/lib/logger"
import { signOAuthState, verifyOAuthState } from "@/lib/oauth-state"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  ConnectGithubAccountRoute,
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

export const getPersonalAccounts: AppRouteHandler<
  GetPersonalAccountsRoute
> = async (c) => {
  const account = await db
    .select(accountColumns)
    .from(schema.personalAccount)
    .where(isGithubAccount(c.var.user.id))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  return c.json(
    { github: { available: githubAccountsAvailable(), account } },
    HttpStatusCodes.OK
  )
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
    void revokeGithubToken(decryptSecret(removed.accessToken, key)).catch(
      (err) => logger.warn({ err }, "GitHub token revoke failed")
    )
  }
  return c.json({ success: true as const }, HttpStatusCodes.OK)
}
