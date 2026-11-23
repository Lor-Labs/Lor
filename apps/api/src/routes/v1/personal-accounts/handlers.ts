import { and, asc, db, eq, schema, sql } from "@repo/db"
import { env } from "@repo/env/server"
import { decryptSecret } from "@repo/utils/crypto"
import { features } from "@repo/utils/features"
import { HTTPException } from "hono/http-exception"
import {
  exchangeGithubCode,
  fetchGithubProfile,
  fillMissingGithubAvatar,
  githubAccountsAvailable,
  githubAuthorizeUrl,
  revokeGithubToken,
  verifyGithubAccountState,
} from "@/lib/github-account"
import {
  connectHarnessAccount,
  disconnectHarnessAccount,
} from "@/lib/harness-accounts"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { logger } from "@/lib/logger"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  ConnectChatgptAccountRoute,
  ConnectClaudeAccountRoute,
  ConnectGithubAccountRoute,
  DisconnectChatgptAccountRoute,
  DisconnectClaudeAccountRoute,
  DisconnectGithubAccountRoute,
  GetPersonalAccountsRoute,
  StartGithubAccountConnectRoute,
} from "@/routes/v1/personal-accounts/routes"

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
  id: schema.personalAccount.id,
  label: schema.personalAccount.label,
  unavailableUntil: schema.personalAccount.unavailableUntil,
  login: schema.personalAccount.login,
  updatedAt: schema.personalAccount.updatedAt,
  accessTokenExpiresAt: schema.personalAccount.accessTokenExpiresAt,
}

const toClaudeAccount = (row: {
  id: string
  label: string | null
  unavailableUntil: Date | null
  login: string
  updatedAt: Date
  accessTokenExpiresAt: Date | null
}) => ({
  id: row.id,
  label: row.label,
  unavailableUntil: row.unavailableUntil?.toISOString() ?? null,
  tokenHint: row.login,
  connectedAt: row.updatedAt.toISOString(),
  expiresAt: row.accessTokenExpiresAt?.toISOString() ?? null,
})

const isChatgptAccount = (userId: string) =>
  and(
    eq(schema.personalAccount.userId, userId),
    eq(schema.personalAccount.provider, "chatgpt")
  )

// A refresh updates the tokens, not the connection: "connected" is when the
// row was made.
const chatgptAccountColumns = {
  id: schema.personalAccount.id,
  label: schema.personalAccount.label,
  unavailableUntil: schema.personalAccount.unavailableUntil,
  email: schema.personalAccount.email,
  name: schema.personalAccount.name,
  createdAt: schema.personalAccount.createdAt,
}

const toChatgptAccount = (row: {
  id: string
  label: string | null
  unavailableUntil: Date | null
  email: string | null
  name: string | null
  createdAt: Date
}) => ({
  id: row.id,
  label: row.label,
  unavailableUntil: row.unavailableUntil?.toISOString() ?? null,
  email: row.email,
  plan: row.name,
  connectedAt: row.createdAt.toISOString(),
})

// The shared account helpers throw 400s; these routes document
// `{ success: false, message }`, so return them in that shape.
class BadRequest {
  constructor(readonly message: string) {}
}
const asBadRequest = (err: unknown) => {
  if (err instanceof HTTPException && err.status === 400)
    return new BadRequest(err.message)
  throw err
}
const badRequestBody = (err: BadRequest) => ({
  success: false as const,
  message: err.message,
})

export const getPersonalAccounts: AppRouteHandler<
  GetPersonalAccountsRoute
> = async (c) => {
  c.header("Cache-Control", "no-store")
  const [account, claude, chatgpt] = await Promise.all([
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
      .orderBy(
        asc(schema.personalAccount.createdAt),
        asc(schema.personalAccount.id)
      ),
    db
      .select(chatgptAccountColumns)
      .from(schema.personalAccount)
      .where(isChatgptAccount(c.var.user.id))
      .orderBy(
        asc(schema.personalAccount.createdAt),
        asc(schema.personalAccount.id)
      ),
  ])
  await fillMissingGithubAvatar(c.var.user, account?.avatarUrl)
  return c.json(
    {
      github: { available: githubAccountsAvailable(), account },
      claude: {
        available:
          features.claudeCodeHarness && Boolean(env.INTEGRATION_ENCRYPTION_KEY),
        account: claude[0] ? toClaudeAccount(claude[0]) : null,
        accounts: claude.map(toClaudeAccount),
      },
      chatgpt: {
        available:
          features.codexHarness && Boolean(env.INTEGRATION_ENCRYPTION_KEY),
        account: chatgpt[0] ? toChatgptAccount(chatgpt[0]) : null,
        accounts: chatgpt.map(toChatgptAccount),
      },
    },
    HttpStatusCodes.OK
  )
}

export const connectClaudeAccount: AppRouteHandler<
  ConnectClaudeAccountRoute
> = async (c) => {
  const { token, label } = c.req.valid("json")
  const row = await connectHarnessAccount(
    { userId: c.var.user.id, workspaceId: "" },
    "claude",
    { credential: token, label }
  ).catch(asBadRequest)
  if (row instanceof BadRequest)
    return c.json(badRequestBody(row), HttpStatusCodes.BAD_REQUEST)
  return c.json({ account: toClaudeAccount(row) }, HttpStatusCodes.OK)
}

export const disconnectClaudeAccount: AppRouteHandler<
  DisconnectClaudeAccountRoute
> = async (c) => {
  const result = await disconnectHarnessAccount(
    { userId: c.var.user.id, workspaceId: "" },
    "claude",
    c.req.valid("query").accountId
  ).catch(asBadRequest)
  if (result instanceof BadRequest)
    return c.json(badRequestBody(result), HttpStatusCodes.BAD_REQUEST)
  return c.json({ success: true as const }, HttpStatusCodes.OK)
}

export const connectChatgptAccount: AppRouteHandler<
  ConnectChatgptAccountRoute
> = async (c) => {
  const { authJson, label } = c.req.valid("json")
  const row = await connectHarnessAccount(
    { userId: c.var.user.id, workspaceId: "" },
    "chatgpt",
    { credential: authJson, label }
  ).catch(asBadRequest)
  if (row instanceof BadRequest)
    return c.json(badRequestBody(row), HttpStatusCodes.BAD_REQUEST)
  return c.json({ account: toChatgptAccount(row) }, HttpStatusCodes.OK)
}

export const disconnectChatgptAccount: AppRouteHandler<
  DisconnectChatgptAccountRoute
> = async (c) => {
  const result = await disconnectHarnessAccount(
    { userId: c.var.user.id, workspaceId: "" },
    "chatgpt",
    c.req.valid("query").accountId
  ).catch(asBadRequest)
  if (result instanceof BadRequest)
    return c.json(badRequestBody(result), HttpStatusCodes.BAD_REQUEST)
  return c.json({ success: true as const }, HttpStatusCodes.OK)
}

export const startGithubAccountConnect: AppRouteHandler<
  StartGithubAccountConnectRoute
> = async (c) => {
  const url = githubAuthorizeUrl(c.var.user.id)
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
  const verified = verifyGithubAccountState(state, c.var.user.id)
  if (!verified) {
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
      targetWhere: sql`${schema.personalAccount.provider} = 'github'`,
      set: values,
    })
    .returning(accountColumns)
  if (!account) throw new Error("GitHub account upsert returned no row")
  await fillMissingGithubAvatar(c.var.user, account.avatarUrl)
  return c.json(
    { account, continueToWorkspaceSlug: verified.continueToWorkspaceSlug },
    HttpStatusCodes.OK
  )
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
