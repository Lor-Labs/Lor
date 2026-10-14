import { desc, eq } from "drizzle-orm"
import { db } from "../index"
import { modelRate } from "../schemas/model-rates"

const INITIAL_EFFECTIVE_FROM = new Date("2026-07-01T00:00:00Z")

// $/Mtok list prices — CONFIRM against the AI Gateway dashboard before launch.
// "*" is the catch-all for gateway-fallback models, priced at the most
// expensive tier so unknown models never under-bill.
const RATES = [
  { model: "moonshotai/kimi-k3", input: 3, cached: 0.3, output: 15 },
  // Inkling has multiple Gateway providers with slightly different input and
  // cache prices. Use the highest route price so provider failover never
  // under-bills.
  {
    model: "thinkingmachines/inkling",
    input: 1.2,
    cached: 0.2,
    output: 4.05,
  },
  // GLM 5.3 Flash (small-model default): priced at the standard Gateway route
  // ($0.15/$0.50, cache read $0.03). The Modal route lists higher
  // ($0.45/$1.50/$0.09) — accepted under-billing risk if failover lands there.
  {
    model: "zai/glm-5.3-flash",
    input: 0.15,
    cached: 0.03,
    output: 0.5,
  },
  // MiMo V2.6 Pro (main-model trial): highest route price, so failover never
  // under-bills. DeepInfra, the pinned route, is $0.43/$0.0036/$0.87.
  {
    model: "xiaomi/mimo-v2.6-pro",
    input: 0.435,
    cached: 0.004,
    output: 0.87,
  },
  {
    model: "alibaba/qwen3-embedding-4b",
    input: 0.02,
    cached: 0.02,
    output: 0,
  },
  { model: "*", input: 3, cached: 0.3, output: 15 },
]

// Idempotent and append-only: first run inserts at a fixed effectiveFrom;
// when a list price changes, re-running appends a new row effective now —
// existing rows are never touched, so historical spend stays reconstructible.
// conversionRate is managed directly in the DB (defaults to 1 here) and is
// carried forward from the latest row on price changes.
export async function seedModelRates() {
  for (const r of RATES) {
    const values = {
      inputUsdPerMtok: String(r.input),
      cachedInputUsdPerMtok: String(r.cached),
      outputUsdPerMtok: String(r.output),
    }
    const latest = await db
      .select()
      .from(modelRate)
      .where(eq(modelRate.model, r.model))
      .orderBy(desc(modelRate.effectiveFrom))
      .limit(1)
      .then((rows) => rows[0])
    if (!latest) {
      await db
        .insert(modelRate)
        .values({
          model: r.model,
          ...values,
          effectiveFrom: INITIAL_EFFECTIVE_FROM,
        })
        .onConflictDoNothing({
          target: [modelRate.model, modelRate.effectiveFrom],
        })
      continue
    }
    const unchanged =
      Number(latest.inputUsdPerMtok) === r.input &&
      Number(latest.cachedInputUsdPerMtok) === r.cached &&
      Number(latest.outputUsdPerMtok) === r.output
    if (unchanged) continue
    await db.insert(modelRate).values({
      model: r.model,
      ...values,
      conversionRate: latest.conversionRate,
      effectiveFrom: new Date(),
    })
  }
}
