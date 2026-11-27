import { and, db, eq, schema, sql } from "@repo/db"
import {
  harnessAccountOwner,
  resolveHarnessAccount,
} from "@repo/db/queries/personal-accounts"
import type { HarnessAccountRoute } from "@repo/db/schema"
import { chatgptCredential } from "./chatgpt-account"
import { claudeSubscriptionToken } from "./claude-account"
import { logger } from "./logger"

export type HarnessCredential =
  | { provider: "claude"; token: string }
  | { provider: "chatgpt"; accessToken: string; accountId: string }

export async function loadHarnessCredential(
  route: HarnessAccountRoute
): Promise<HarnessCredential> {
  if (route.source !== "subscription" || !route.accountId)
    throw new Error("A linked account is required")
  if (route.provider === "claude") {
    const token = await claudeSubscriptionToken(
      route.userId,
      route.accountId,
      route.workspaceId
    )
    if (!token) throw new Error("The Claude account was disconnected")
    return { provider: "claude", token }
  }
  const credential = await chatgptCredential(
    route.userId,
    route.accountId,
    route.workspaceId
  )
  if (!credential) throw new Error("The ChatGPT account was disconnected")
  return { provider: "chatgpt", ...credential }
}

// Only provider quota/rate-limit failures rotate accounts. Tool errors,
// transport failures and invalid credentials keep their original error.
export function harnessQuotaReset(error: unknown): Date | null {
  const visited = new Set<unknown>()
  const inspect = (
    value: unknown,
    depth: number
  ): { limited: boolean; reset?: number } => {
    if (depth > 5 || value == null || visited.has(value))
      return { limited: false }
    visited.add(value)
    if (typeof value === "string") {
      try {
        const parsed: unknown = JSON.parse(value)
        if (parsed && typeof parsed === "object")
          return inspect(parsed, depth + 1)
      } catch {}
      // Native CLIs use human-readable limits, including Claude's "5-hour"
      // window and Codex's typographic apostrophe, instead of an error code.
      return {
        limited:
          /usage_limit_reached|insufficient_quota|rate_limit_exceeded|rate_limit_error|you(?:['’]ve| have) (?:hit|reached) your (?:(?:usage|weekly|daily|subscription|\d+[ -]hour) )?limits?\b|(?:usage|weekly|daily|subscription) limit (?:reached|exceeded)|credit balance is too low/i.test(
            value
          ),
      }
    }
    if (typeof value !== "object") return { limited: false }
    const row = value as Record<string, unknown>
    const nested = [
      row.code,
      row.type,
      row.message,
      row.error,
      row.cause,
      row.responseBody,
    ].map((v) => inspect(v, depth + 1))
    const resetSeconds =
      typeof row.resets_at === "number"
        ? row.resets_at
        : typeof row.reset_at === "number"
          ? row.reset_at
          : null
    const retrySeconds =
      typeof row.retry_after === "number" ? row.retry_after : null
    return {
      limited:
        row.status === 429 ||
        row.statusCode === 429 ||
        nested.some((v) => v.limited),
      reset: resetSeconds
        ? resetSeconds * 1000
        : retrySeconds
          ? Date.now() + retrySeconds * 1000
          : nested.find((v) => v.reset)?.reset,
    }
  }
  const result = inspect(error, 0)
  if (!result.limited) return null
  // Unknown limits are probed again after five minutes; known provider resets
  // take precedence. An exhausted row is shared across concurrent runs.
  return new Date(
    Math.max(Date.now() + 1000, result.reset ?? Date.now() + 5 * 60_000)
  )
}

export async function nextHarnessAccount(
  route: HarnessAccountRoute,
  error: unknown,
  attempted: string[]
) {
  const reset = harnessQuotaReset(error)
  if (!reset || !route.accountId || route.source !== "subscription") return null
  // A shorter fallback never replaces a later known reset. A failed write
  // returns no account so the caller keeps the provider's error.
  try {
    await db
      .update(schema.personalAccount)
      .set({
        unavailableUntil: sql`greatest(${schema.personalAccount.unavailableUntil}, ${reset.toISOString()}::timestamptz)`,
      })
      .where(
        and(
          harnessAccountOwner(route),
          eq(schema.personalAccount.id, route.accountId),
          eq(schema.personalAccount.provider, route.provider)
        )
      )
  } catch (err) {
    logger.error(
      { err, accountId: route.accountId },
      "Saving the account's quota cooldown failed"
    )
    return null
  }
  try {
    return await resolveHarnessAccount(route, route.provider, {
      pinned: route,
      exclude: attempted,
    })
  } catch {
    return null
  }
}
