import { auth } from "@repo/auth"
import { and, db, eq, isNull, or, schema } from "@repo/db"
import { env } from "@repo/env/server"
import { decryptSecret, encryptSecret } from "@repo/utils/crypto"
import { parseGithubInstallationId } from "@repo/utils/github"
import { logger } from "@/lib/logger"
import { signOAuthState, verifyOAuthState } from "@/lib/oauth-state"

// A person's own GitHub account ("Your accounts"), authorized through the
// GitHub App's user authorization (OAuth web flow). Its token acts as the
// person, limited to repos the App is installed on
// (reference/planned/code-sessions-runbook.md, chunk 4).

export const GITHUB_API = "https://api.github.com"
export const GITHUB_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "lor",
}

// Must match the App's Callback URL; used for both authorize and exchange.
const redirectUri = () => `${env.APP_BASE_URL}/accounts/github/callback`

export function githubAccountsAvailable(): boolean {
  return Boolean(
    env.GITHUB_APP_CLIENT_ID &&
      env.GITHUB_APP_CLIENT_SECRET &&
      env.INTEGRATION_ENCRYPTION_KEY
  )
}

// The signed state's routing slug. Personal accounts have no workspace; the
// signature still binds the flow to the user who started it. A link started
// from a workspace's GitHub connector also names that workspace, so the
// callback continues to the App install.
const ACCOUNT_STATE_SLUG = "github-account"

export function githubAuthorizeUrl(
  userId: string,
  continueToWorkspaceSlug?: string
): string | null {
  if (!(githubAccountsAvailable() && env.GITHUB_APP_CLIENT_ID)) return null
  const slug = continueToWorkspaceSlug
    ? `${ACCOUNT_STATE_SLUG}:${continueToWorkspaceSlug}`
    : ACCOUNT_STATE_SLUG
  const params = new URLSearchParams({
    client_id: env.GITHUB_APP_CLIENT_ID,
    redirect_uri: redirectUri(),
    state: signOAuthState(slug, userId),
  })
  return `https://github.com/login/oauth/authorize?${params.toString()}`
}

// null when the state is invalid, expired or minted for someone else.
export function verifyGithubAccountState(
  state: string,
  userId: string
): { continueToWorkspaceSlug: string | null } | null {
  const slug = verifyOAuthState(state, userId)
  if (slug === ACCOUNT_STATE_SLUG) return { continueToWorkspaceSlug: null }
  const prefix = `${ACCOUNT_STATE_SLUG}:`
  if (!slug?.startsWith(prefix) || slug.length === prefix.length) return null
  return { continueToWorkspaceSlug: slug.slice(prefix.length) }
}

type TokenResponse = {
  access_token?: string
  expires_in?: number
  refresh_token?: string
  refresh_token_expires_in?: number
  error?: string
}

// Expiry fields are absent when the App doesn't expire user tokens.
function encryptedTokens(body: TokenResponse, key: string) {
  if (!body.access_token) {
    throw new Error(`GitHub token request failed: ${body.error ?? "no token"}`)
  }
  const now = Date.now()
  return {
    accessToken: encryptSecret(body.access_token, key),
    accessTokenExpiresAt: body.expires_in
      ? new Date(now + body.expires_in * 1000)
      : null,
    refreshToken: body.refresh_token
      ? encryptSecret(body.refresh_token, key)
      : null,
    refreshTokenExpiresAt: body.refresh_token_expires_in
      ? new Date(now + body.refresh_token_expires_in * 1000)
      : null,
    plainAccessToken: body.access_token,
  }
}

const TOKEN_REQUEST_TIMEOUT_MS = 15_000

async function requestToken(params: Record<string, string>) {
  const { GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET } = env
  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!(GITHUB_APP_CLIENT_ID && GITHUB_APP_CLIENT_SECRET && key)) {
    throw new Error("GitHub accounts aren't configured")
  }
  // A refresh runs inside githubAccountToken's row lock.
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: GITHUB_APP_CLIENT_ID,
      client_secret: GITHUB_APP_CLIENT_SECRET,
      ...params,
    }),
    signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`GitHub token request failed: ${res.status}`)
  return encryptedTokens((await res.json()) as TokenResponse, key)
}

export function exchangeGithubCode(code: string) {
  return requestToken({ code, redirect_uri: redirectUri() })
}

export function refreshGithubToken(refreshToken: string) {
  return requestToken({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  })
}

// Refresh a little early so a push never starts on a token about to expire.
const REFRESH_MARGIN_MS = 5 * 60 * 1000

export type GithubAccountToken =
  | { status: "ok"; token: string; login: string }
  | { status: "missing" }
  // The refresh token expired or was revoked: the person links GitHub again.
  | { status: "expired" }

// The person's current access token, refreshed when it is about to expire.
// The row lock lets one refresh run at a time: GitHub rotates the refresh
// token on use, so a second, parallel refresh would fail.
export async function githubAccountToken(
  userId: string
): Promise<GithubAccountToken> {
  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!key) return { status: "missing" }
  return db.transaction(async (tx) => {
    const [account] = await tx
      .select()
      .from(schema.personalAccount)
      .where(
        and(
          eq(schema.personalAccount.userId, userId),
          eq(schema.personalAccount.provider, "github")
        )
      )
      .limit(1)
      .for("update")
    if (!account) return { status: "missing" as const }
    const now = Date.now()
    if (
      !account.accessTokenExpiresAt ||
      account.accessTokenExpiresAt.getTime() > now + REFRESH_MARGIN_MS
    ) {
      return {
        status: "ok" as const,
        token: decryptSecret(account.accessToken, key),
        login: account.login,
      }
    }
    if (
      !account.refreshToken ||
      (account.refreshTokenExpiresAt &&
        account.refreshTokenExpiresAt.getTime() <= now)
    ) {
      return { status: "expired" as const }
    }
    const refreshed = await refreshGithubToken(
      decryptSecret(account.refreshToken, key)
    ).catch(() => null)
    if (!refreshed) return { status: "expired" as const }
    const { plainAccessToken, ...tokens } = refreshed
    await tx
      .update(schema.personalAccount)
      .set(tokens)
      .where(eq(schema.personalAccount.id, account.id))
    return {
      status: "ok" as const,
      token: plainAccessToken,
      login: account.login,
    }
  })
}

// The person's GitHub identity. The email needs the App's "Email addresses"
// read permission; without it the email stays null.
export async function fetchGithubProfile(token: string) {
  const headers = { ...GITHUB_HEADERS, Authorization: `Bearer ${token}` }
  const res = await fetch(`${GITHUB_API}/user`, { headers })
  if (!res.ok) throw new Error(`GitHub user request failed: ${res.status}`)
  const user = (await res.json()) as {
    id: number
    login: string
    name: string | null
    avatar_url: string | null
  }
  const emails = await fetch(`${GITHUB_API}/user/emails`, { headers })
    .then((r) =>
      r.ok
        ? (r.json() as Promise<
            { email: string; primary: boolean; verified: boolean }[]
          >)
        : []
    )
    .catch(() => [])
  return {
    externalId: String(user.id),
    login: user.login,
    name: user.name,
    avatarUrl: user.avatar_url,
    email:
      emails.find((entry) => entry.primary && entry.verified)?.email ?? null,
  }
}

// Listing an installation alone also admits collaborators with access to only
// one repo. Sharing the entire installation requires its account owner.
export async function verifyGithubInstallationOwner(
  token: string,
  installationId: string
): Promise<{ accountLogin: string } | null> {
  const id = parseGithubInstallationId(installationId)
  if (id === null) return null
  const headers = { ...GITHUB_HEADERS, Authorization: `Bearer ${token}` }
  const signal = AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS)
  const get = (path: string) =>
    fetch(`${GITHUB_API}${path}`, {
      headers,
      redirect: "error",
      signal,
    })
  type Installation = {
    id: number
    account: { id: number; login: string; type: string } | null
    suspended_at: string | null
  }
  let installation: Installation | undefined
  for (let page = 1; page <= 100; page++) {
    const response = await get(`/user/installations?per_page=100&page=${page}`)
    if (!response.ok) return null
    const body = (await response.json()) as { installations: Installation[] }
    installation = body.installations.find((entry) => entry.id === id)
    if (installation || body.installations.length < 100) break
  }
  const account = installation?.account
  if (!account || installation?.suspended_at) return null
  if (account.type === "User") {
    const response = await get("/user")
    if (!response.ok) return null
    const user = (await response.json()) as { id: number }
    return user.id === account.id ? { accountLogin: account.login } : null
  }
  if (account.type !== "Organization") return null
  type Membership = {
    state: string
    role: string
    organization: { id: number }
  }
  for (let page = 1; page <= 100; page++) {
    const response = await get(
      `/user/memberships/orgs?state=active&per_page=100&page=${page}`
    )
    if (!response.ok) return null
    const memberships = (await response.json()) as Membership[]
    const membership = memberships.find(
      (entry) => entry.organization.id === account.id
    )
    if (membership) {
      return membership.state === "active" && membership.role === "admin"
        ? { accountLogin: account.login }
        : null
    }
    if (memberships.length < 100) break
  }
  return null
}

export async function fillMissingGithubAvatar(
  user: { id: string; image?: string | null },
  avatarUrl: string | null | undefined
) {
  if (user.image || !avatarUrl) return
  try {
    // Check in SQL too: connecting GitHub must not replace a concurrent upload.
    await db
      .update(schema.user)
      .set({ image: avatarUrl })
      .where(
        and(
          eq(schema.user.id, user.id),
          or(isNull(schema.user.image), eq(schema.user.image, ""))
        )
      )

    // Refresh Better Auth's Redis sessions from the current row without
    // writing the image again. Also repairs a stale session on the next load.
    const { internalAdapter } = await auth.$context
    await internalAdapter.updateUser(user.id, { updatedAt: new Date() })
  } catch (err) {
    logger.warn({ err, userId: user.id }, "GitHub avatar fallback failed")
  }
}

// Disconnecting revokes the token at GitHub too. Best-effort: the row is
// gone either way.
export async function revokeGithubToken(token: string) {
  const { GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET } = env
  if (!(GITHUB_APP_CLIENT_ID && GITHUB_APP_CLIENT_SECRET)) return
  const basic = Buffer.from(
    `${GITHUB_APP_CLIENT_ID}:${GITHUB_APP_CLIENT_SECRET}`
  ).toString("base64")
  await fetch(`${GITHUB_API}/applications/${GITHUB_APP_CLIENT_ID}/token`, {
    method: "DELETE",
    headers: { ...GITHUB_HEADERS, Authorization: `Basic ${basic}` },
    body: JSON.stringify({ access_token: token }),
  })
}
