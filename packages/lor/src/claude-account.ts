import { and, db, eq, isNull, schema } from "@repo/db"
import type { ReportedHarnessModel } from "@repo/db/schema"
import { env } from "@repo/env/server"
import { decryptSecret } from "@repo/utils/crypto"
import { logger } from "./logger"

const claudeAccount = (userId: string) =>
  and(
    eq(schema.personalAccount.userId, userId),
    eq(schema.personalAccount.provider, "claude")
  )

// The models for the composer's picker: the person's Claude Code's own list
// from their last turn, or the starting list from Anthropic before one.
export async function claudeModels(
  userId: string
): Promise<ReportedHarnessModel[] | null> {
  const [account] = await db
    .select({ models: schema.personalAccount.models })
    .from(schema.personalAccount)
    .where(claudeAccount(userId))
    .limit(1)
  return account?.models ?? null
}

export async function saveClaudeModels(
  userId: string,
  models: ReportedHarnessModel[]
): Promise<void> {
  await db
    .update(schema.personalAccount)
    .set({ models })
    .where(claudeAccount(userId))
}

// Effort levels as Anthropic's models API names them, lowest first.
const ANTHROPIC_EFFORTS = ["low", "medium", "high", "xhigh", "max"]

type AnthropicModel = {
  id: string
  display_name: string
  line: string | null
  lifecycle: string
  capabilities: {
    effort?: { supported: boolean } & Record<string, unknown>
  } | null
}

// Before the person's first Claude Code turn, so the picker has effort
// levels from the start: the newest active model of each line (Opus,
// Sonnet…) from Anthropic's models API, read with their own token. The full
// id, not Claude Code's alias, which can run an older model with other
// levels. It has no fast mode field; Claude Code's list replaces this one,
// fast mode included, when the first turn reports it. Saved only while no
// turn has reported, so it never overwrites Claude Code's list.
export async function startingClaudeModels(
  userId: string
): Promise<ReportedHarnessModel[] | null> {
  try {
    const token = await claudeSubscriptionToken(userId)
    if (!token) return null
    const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        "anthropic-version": "2023-06-01",
      },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`Anthropic models list: HTTP ${res.status}`)
    const { data } = (await res.json()) as { data: AnthropicModel[] }
    // Newest first, so the first of each line is its newest.
    const newest = new Map<string, AnthropicModel>()
    for (const model of data) {
      if (model.line && model.lifecycle === "active" && !newest.has(model.line))
        newest.set(model.line, model)
    }
    const models = [...newest.values()]
      .sort((a, b) => Number(b.line === "opus") - Number(a.line === "opus"))
      .map((model) => {
        const effort = model.capabilities?.effort
        const supported = (level: string) =>
          (effort?.[level] as { supported?: boolean } | null | undefined)
            ?.supported === true
        return {
          value: model.id,
          displayName: model.display_name,
          supportedEffortLevels: effort?.supported
            ? ANTHROPIC_EFFORTS.filter(supported)
            : [],
          supportsFastMode: false,
        }
      })
    if (models.length === 0) return null
    await db
      .update(schema.personalAccount)
      .set({ models })
      .where(and(claudeAccount(userId), isNull(schema.personalAccount.models)))
    return models
  } catch (err) {
    logger.warn({ err }, "Claude starting model list failed")
    return null
  }
}

// A person's own Claude subscription token (Settings → Linked accounts), for
// Claude Code turns they start themselves, never anyone else's
// (code-sessions-runbook.md chunk 7). Null when none is connected.
export async function claudeSubscriptionToken(
  userId: string
): Promise<string | null> {
  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!key) return null
  const [account] = await db
    .select({ accessToken: schema.personalAccount.accessToken })
    .from(schema.personalAccount)
    .where(claudeAccount(userId))
    .limit(1)
  return account ? decryptSecret(account.accessToken, key) : null
}
