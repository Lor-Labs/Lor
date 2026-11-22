import { and, db, eq, schema } from "@repo/db"
import { harnessAccountOwner } from "@repo/db/queries/personal-accounts"
import type { HarnessAccountScope } from "@repo/db/schema"
import { env } from "@repo/env/server"
import {
  chatgptTokenDetails,
  parseCodexAuthJson,
  refreshChatgptTokens,
} from "@repo/lor/chatgpt-account"
import { encryptSecret } from "@repo/utils/crypto"
import { features } from "@repo/utils/features"
import { HTTPException } from "hono/http-exception"
import {
  claudeTokenDetails,
  normalizeClaudeToken,
  verifyClaudeToken,
} from "./claude-account"

export async function connectHarnessAccount(
  scope: HarnessAccountScope,
  provider: "claude" | "chatgpt",
  input: { credential: string; label?: string }
) {
  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!key)
    throw new HTTPException(400, {
      message: "Account linking is not available on this server.",
    })
  if (
    provider === "claude" ? !features.claudeCodeHarness : !features.codexHarness
  )
    throw new HTTPException(400, {
      message: "This harness is temporarily unavailable.",
    })
  const values = await (async () => {
    if (provider === "claude") {
      const token = normalizeClaudeToken(input.credential)
      if (!token)
        throw new HTTPException(400, {
          message: "Paste the complete token from claude setup-token.",
        })
      const verified = await verifyClaudeToken(token)
      if (verified !== "ok")
        throw new HTTPException(400, {
          message:
            verified === "rejected"
              ? "Anthropic rejected that token. Run claude setup-token again."
              : "Couldn't reach Anthropic to verify the token. Try again.",
        })
      return {
        ...claudeTokenDetails(token),
        accessToken: encryptSecret(token, key),
        refreshToken: null,
        name: null,
        email: null,
      }
    }
    const pasted = parseCodexAuthJson(input.credential)
    if (!pasted)
      throw new HTTPException(400, {
        message: "Paste the whole auth.json saved by codex login with ChatGPT.",
      })
    const tokens = await refreshChatgptTokens(pasted.refreshToken)
    if (typeof tokens === "string")
      throw new HTTPException(400, {
        message:
          tokens === "rejected"
            ? "OpenAI rejected that sign-in. Run the login command again."
            : "Couldn't reach OpenAI to verify the sign-in. Try again.",
      })
    const details = chatgptTokenDetails(tokens)
    if (!details)
      throw new HTTPException(400, {
        message: "This sign-in has no ChatGPT account.",
      })
    return {
      ...details,
      accessToken: encryptSecret(tokens.accessToken, key),
      refreshToken: encryptSecret(tokens.refreshToken, key),
    }
  })()
  const updates = {
    ...values,
    ...(input.label !== undefined ? { label: input.label.trim() || null } : {}),
    models: null,
    unavailableUntil: null,
  }
  const [row] = await db
    .insert(schema.personalAccount)
    .values({
      userId: scope.userId,
      workspaceId: scope.userId ? null : scope.workspaceId,
      provider,
      ...updates,
    })
    .onConflictDoUpdate({
      target: scope.userId
        ? [
            schema.personalAccount.userId,
            schema.personalAccount.provider,
            schema.personalAccount.externalId,
          ]
        : [
            schema.personalAccount.workspaceId,
            schema.personalAccount.provider,
            schema.personalAccount.externalId,
          ],
      set: updates,
    })
    .returning()
  if (!row) throw new Error("Account save returned no row")
  return row
}

export async function disconnectHarnessAccount(
  scope: HarnessAccountScope,
  provider: "claude" | "chatgpt",
  accountId?: string
) {
  const where = and(
    harnessAccountOwner(scope),
    eq(schema.personalAccount.provider, provider),
    ...(accountId ? [eq(schema.personalAccount.id, accountId)] : [])
  )
  // Older clients can disconnect their only account, but cannot delete a pool.
  if (!accountId) {
    const rows = await db
      .select({ id: schema.personalAccount.id })
      .from(schema.personalAccount)
      .where(where)
      .limit(2)
    if (rows.length > 1)
      throw new HTTPException(400, {
        message: "Choose which account to disconnect.",
      })
  }
  await db.delete(schema.personalAccount).where(where)
}
