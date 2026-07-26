import { and, db, desc, eq, lte, schema } from "@repo/db"
import type { CreditRate } from "./credits"

const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map<string, { rate: CreditRate | null; expiresAt: number }>()

function toRate(row: typeof schema.modelRate.$inferSelect): CreditRate {
  return {
    inputUsdPerMtok: Number(row.inputUsdPerMtok),
    cachedInputUsdPerMtok: Number(row.cachedInputUsdPerMtok),
    outputUsdPerMtok: Number(row.outputUsdPerMtok),
    conversionRate: Number(row.conversionRate),
  }
}

async function lookup(model: string): Promise<CreditRate | null> {
  const rows = await db
    .select()
    .from(schema.modelRate)
    .where(
      and(
        eq(schema.modelRate.model, model),
        lte(schema.modelRate.effectiveFrom, new Date())
      )
    )
    .orderBy(desc(schema.modelRate.effectiveFrom))
    .limit(1)
  return rows[0] ? toRate(rows[0]) : null
}

// Newest effective row for the exact slug, falling back to the "*" catch-all
// (the gateway fallback can serve a model we never seeded).
export async function getRate(model: string): Promise<CreditRate | null> {
  const hit = cache.get(model)
  if (hit && hit.expiresAt > Date.now()) return hit.rate
  const rate =
    (await lookup(model)) ?? (model === "*" ? null : await lookup("*"))
  cache.set(model, { rate, expiresAt: Date.now() + CACHE_TTL_MS })
  return rate
}
