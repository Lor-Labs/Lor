import { createHash } from "node:crypto"
import { and, db, eq, schema } from "@repo/db"
import { assertHostedHarness } from "@repo/db/queries/beta-access"
import type { ReportedHarnessModel } from "@repo/db/schema"
import { env } from "@repo/env/server"
import { decryptSecret, encryptSecret } from "@repo/utils/crypto"

// A person's ChatGPT plan for their own Codex turns (code-sessions-runbook.md
// chunk 8f), like the Claude subscription: the tokens `codex login` saves in
// auth.json, pasted once and stored encrypted. Access tokens last about an
// hour. Lor refreshes them with the Codex CLI's own OAuth client, and every
// refresh replaces the refresh token, so the pasted sign-in must not also be
// the one the person's own Codex uses (the connect dialog logs in to a
// separate CODEX_HOME).

const TOKEN_URL = "https://auth.openai.com/oauth/token"
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
// Codex's ChatGPT backend; requests carry the account id beside the token.
export const CHATGPT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex"
// A turn starts with at least this long left on its token; longer turns
// refresh it mid-turn.
const REFRESH_MARGIN_MS = 20 * 60_000

export type ChatgptTokens = {
  accessToken: string
  refreshToken: string
  idToken: string | null
}

export type ChatgptCredential = { accessToken: string; accountId: string }

// The stored sign-in no longer works (refresh token expired, revoked or used
// elsewhere): the person connects again.
export class ChatgptSignInError extends Error {
  constructor() {
    super(
      "Your ChatGPT sign-in has expired. Connect it again in Settings → Linked accounts."
    )
    this.name = "ChatgptSignInError"
  }
}

type TokenClaims = {
  exp?: unknown
  email?: unknown
  "https://api.openai.com/auth"?: {
    chatgpt_account_id?: unknown
    chatgpt_plan_type?: unknown
  }
  "https://api.openai.com/profile"?: { email?: unknown }
}

// Read only, never verified: OpenAI checks the token on every request.
function jwtClaims(token: string | null): TokenClaims | null {
  const payload = token?.split(".")[1]
  if (!payload) return null
  try {
    const value: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    )
    return typeof value === "object" && value !== null
      ? (value as TokenClaims)
      : null
  } catch {
    return null
  }
}

const text = (value: unknown) =>
  typeof value === "string" && value.length > 0 ? value : null

// The pasted auth.json. Null when it is not a ChatGPT sign-in: an API-key
// login, another file, or a cut-off paste.
export function parseCodexAuthJson(pasted: string): ChatgptTokens | null {
  let value: unknown
  try {
    value = JSON.parse(pasted.trim())
  } catch {
    return null
  }
  if (typeof value !== "object" || value === null) return null
  const tokens = (value as { tokens?: unknown }).tokens
  if (typeof tokens !== "object" || tokens === null) return null
  const { access_token, refresh_token, id_token } = tokens as Record<
    string,
    unknown
  >
  const accessToken = text(access_token)
  const refreshToken = text(refresh_token)
  if (!accessToken || !refreshToken) return null
  return { accessToken, refreshToken, idToken: text(id_token) }
}

// The row's identity, from the tokens' claims. Null without an account id,
// which every Codex request needs.
export function chatgptTokenDetails(tokens: ChatgptTokens) {
  const access = jwtClaims(tokens.accessToken)
  const id = jwtClaims(tokens.idToken)
  const auth =
    access?.["https://api.openai.com/auth"] ??
    id?.["https://api.openai.com/auth"]
  const accountId = text(auth?.chatgpt_account_id)
  if (!accountId) return null
  const email =
    text(access?.["https://api.openai.com/profile"]?.email) ?? text(id?.email)
  const exp = typeof access?.exp === "number" ? access.exp * 1000 : null
  return {
    externalId: accountId,
    login:
      email ?? createHash("sha256").update(accountId).digest("hex").slice(0, 8),
    name: text(auth?.chatgpt_plan_type),
    email,
    accessTokenExpiresAt: exp ? new Date(exp) : null,
  }
}

// One refresh with the Codex CLI's client, as Codex itself sends it.
// "rejected": the refresh token is spent or revoked.
export async function refreshChatgptTokens(
  refreshToken: string
): Promise<ChatgptTokens | "rejected" | "unreachable"> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CODEX_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: "openid profile email",
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null)
  if (!res) return "unreachable"
  if (res.status === 400 || res.status === 401) return "rejected"
  if (!res.ok) return "unreachable"
  const body = (await res.json().catch(() => null)) as {
    access_token?: unknown
    refresh_token?: unknown
    id_token?: unknown
  } | null
  const accessToken = text(body?.access_token)
  if (!accessToken) return "unreachable"
  return {
    accessToken,
    refreshToken: text(body?.refresh_token) ?? refreshToken,
    idToken: text(body?.id_token),
  }
}

const chatgptAccount = (userId: string) =>
  and(
    eq(schema.personalAccount.userId, userId),
    eq(schema.personalAccount.provider, "chatgpt")
  )

// A person's own ChatGPT sign-in (Settings → Linked accounts), for Codex
// turns they start themselves, never anyone else's. Refreshed when less than
// the margin is left; the row lock keeps two turns from spending the same
// refresh token. Null when none is connected.
export async function chatgptCredential(
  userId: string
): Promise<ChatgptCredential | null> {
  assertHostedHarness("codex")
  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!key) return null
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        externalId: schema.personalAccount.externalId,
        accessToken: schema.personalAccount.accessToken,
        accessTokenExpiresAt: schema.personalAccount.accessTokenExpiresAt,
        refreshToken: schema.personalAccount.refreshToken,
      })
      .from(schema.personalAccount)
      .where(chatgptAccount(userId))
      .limit(1)
      .for("update")
    if (!row) return null
    const current = {
      accessToken: decryptSecret(row.accessToken, key),
      accountId: row.externalId,
    }
    const left = (row.accessTokenExpiresAt?.getTime() ?? 0) - Date.now()
    if (left > REFRESH_MARGIN_MS) return current
    if (!row.refreshToken) throw new ChatgptSignInError()
    const refreshed = await refreshChatgptTokens(
      decryptSecret(row.refreshToken, key)
    )
    if (refreshed === "rejected") throw new ChatgptSignInError()
    if (refreshed === "unreachable") {
      if (left > 0) return current
      throw new Error("Couldn't reach OpenAI to refresh the ChatGPT sign-in")
    }
    const details = chatgptTokenDetails(refreshed)
    await tx
      .update(schema.personalAccount)
      .set({
        accessToken: encryptSecret(refreshed.accessToken, key),
        refreshToken: encryptSecret(refreshed.refreshToken, key),
        accessTokenExpiresAt: details?.accessTokenExpiresAt ?? null,
      })
      .where(chatgptAccount(userId))
    return { ...current, accessToken: refreshed.accessToken }
  })
}

// The models the person's Codex reported on their last turn (their plan
// decides the list), for the composer's picker.
export async function chatgptModels(
  userId: string
): Promise<ReportedHarnessModel[] | null> {
  const [account] = await db
    .select({ models: schema.personalAccount.models })
    .from(schema.personalAccount)
    .where(chatgptAccount(userId))
    .limit(1)
  return account?.models ?? null
}

export async function saveChatgptModels(
  userId: string,
  models: ReportedHarnessModel[]
): Promise<void> {
  await db
    .update(schema.personalAccount)
    .set({ models })
    .where(chatgptAccount(userId))
}
