import { env } from "@repo/env/server"
import { createLogger } from "@repo/logger"
import { type CreditRate, computeCostUsd, type TokenCounts } from "./credits"

const logger = createLogger("billing")

// Prices from the AI Gateway's own list of the providers that serve a model
// (GET /v1/models/{model}/endpoints, public), so no price is kept here. A
// request is priced at the provider that would charge it most at that time:
// Lor sets a preferred provider order, not a fixed one, so a fallback route
// never under-bills.
const ENDPOINTS_URL = "https://ai-gateway.vercel.sh/v1/models"
const PRICES_TTL_MS = 60 * 60 * 1000
const RETRY_MS = 60 * 1000
const FETCH_TIMEOUT_MS = 10_000
const MTOK = 1_000_000

// A model the Gateway doesn't list, or one asked for before its prices first
// load.
const UNKNOWN_MODEL_USD_PER_MTOK = { input: 3, cachedInput: 0.3, output: 15 }

// USD per token, by the request's input tokens (long-context tiers).
type TieredPrice = {
  base: number
  tiers: { usdPerToken: number; min: number; max: number }[]
}

// Minutes from 00:00 UTC; days 0-6 from Sunday, null for every day.
type PeakWindow = { start: number; end: number; days: number[] | null }

type ProviderPrice = {
  input: TieredPrice
  output: TieredPrice
  // Null: the provider doesn't cache; cached tokens cost input.
  cachedInput: TieredPrice | null
  peak: { multiplier: number; windows: PeakWindow[] } | null
}

type Raw = Record<string, unknown>

const asRecord = (value: unknown): Raw | null =>
  value && typeof value === "object" ? (value as Raw) : null

function amount(value: unknown): number | null {
  const n =
    typeof value === "string" || typeof value === "number"
      ? Number(value)
      : Number.NaN
  return Number.isFinite(n) && n >= 0 ? n : null
}

function tieredPrice(base: unknown, tiers: unknown): TieredPrice | null {
  const usd = amount(base)
  if (usd === null) return null
  return {
    base: usd,
    tiers: (Array.isArray(tiers) ? tiers : []).flatMap((value) => {
      const tier = asRecord(value)
      const cost = amount(tier?.cost)
      return tier && cost !== null
        ? [
            {
              usdPerToken: cost,
              min: amount(tier.min) ?? 0,
              max: amount(tier.max) ?? Number.POSITIVE_INFINITY,
            },
          ]
        : []
    }),
  }
}

function peakPricing(value: unknown): ProviderPrice["peak"] {
  const peak = asRecord(value)
  const multiplier = amount(peak?.multiplier)
  if (!peak || multiplier === null || !Array.isArray(peak.windows)) return null
  const windows = peak.windows.flatMap((value) => {
    const window = asRecord(value)
    const start = amount(window?.start_minute_utc)
    const end = amount(window?.end_minute_utc)
    if (!window || start === null || end === null) return []
    const days = Array.isArray(window.days_of_week)
      ? window.days_of_week.flatMap((day) => {
          const n = amount(day)
          // Sunday may come as 7.
          return n === null ? [] : [n % 7]
        })
      : null
    return [{ start, end, days }]
  })
  return windows.length > 0 ? { multiplier, windows } : null
}

function providerPrice(value: unknown): ProviderPrice | null {
  const pricing = asRecord(value)
  if (!pricing) return null
  const input = tieredPrice(pricing.prompt, pricing.prompt_tiers)
  const output = tieredPrice(pricing.completion, pricing.completion_tiers)
  if (!input || !output) return null
  return {
    input,
    output,
    cachedInput: tieredPrice(
      pricing.input_cache_read,
      pricing.input_cache_read_tiers
    ),
    peak: peakPricing(pricing.peak_pricing),
  }
}

// Null: not loaded, and the last try failed. Empty: the Gateway doesn't
// list the model.
const prices = new Map<
  string,
  { providers: ProviderPrice[] | null; expiresAt: number }
>()
const loading = new Map<string, Promise<void>>()
const unknownWarned = new Set<string>()

async function loadPrices(model: string): Promise<void> {
  try {
    const path = model.split("/").map(encodeURIComponent).join("/")
    const res = await fetch(`${ENDPOINTS_URL}/${path}/endpoints`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (res.status === 404) {
      prices.set(model, {
        providers: [],
        expiresAt: Date.now() + PRICES_TTL_MS,
      })
      return
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = asRecord(await res.json())
    const endpoints = asRecord(body?.data)?.endpoints
    const providers = (Array.isArray(endpoints) ? endpoints : []).flatMap(
      (endpoint) => {
        const price = providerPrice(asRecord(endpoint)?.pricing)
        return price ? [price] : []
      }
    )
    prices.set(model, { providers, expiresAt: Date.now() + PRICES_TTL_MS })
  } catch (err) {
    // A stale list keeps pricing until a retry succeeds.
    prices.set(model, {
      providers: prices.get(model)?.providers ?? null,
      expiresAt: Date.now() + RETRY_MS,
    })
    logger.warn({ err, model }, "AI Gateway price list failed to load")
  }
}

// A stale list prices at once while the refresh runs.
async function providersFor(model: string): Promise<ProviderPrice[] | null> {
  const cached = prices.get(model)
  if (!cached || cached.expiresAt <= Date.now()) {
    let pending = loading.get(model)
    if (!pending) {
      pending = loadPrices(model).finally(() => loading.delete(model))
      loading.set(model, pending)
    }
    if (!cached?.providers) await pending
  }
  return prices.get(model)?.providers ?? null
}

function inWindow(window: PeakWindow, at: Date): boolean {
  if (window.days && !window.days.includes(at.getUTCDay())) return false
  const minute = at.getUTCHours() * 60 + at.getUTCMinutes()
  return window.start <= window.end
    ? minute >= window.start && minute < window.end
    : minute >= window.start || minute < window.end
}

function perMtok(price: TieredPrice, inputTokens: number, factor: number) {
  const tier = price.tiers.find(
    (t) => inputTokens >= t.min && inputTokens < t.max
  )
  return (tier?.usdPerToken ?? price.base) * factor * MTOK
}

function providerRate(
  provider: ProviderPrice,
  inputTokens: number,
  at: Date
): CreditRate {
  const factor = provider.peak?.windows.some((w) => inWindow(w, at))
    ? provider.peak.multiplier
    : 1
  return {
    inputUsdPerMtok: perMtok(provider.input, inputTokens, factor),
    cachedInputUsdPerMtok: perMtok(
      provider.cachedInput ?? provider.input,
      inputTokens,
      factor
    ),
    outputUsdPerMtok: perMtok(provider.output, inputTokens, factor),
    conversionRate: env.CREDIT_CONVERSION_RATE,
  }
}

// The rate for `tokens` to `model`: the provider that would charge them
// most, with any peak-hour multiplier at `at`. Long-context tiers go by one
// request's input, so only a single request passes `requestInputTokens`;
// a total over many (a turn's debit) takes the base tier.
export async function getRate(
  model: string,
  tokens: TokenCounts = {},
  options: { requestInputTokens?: number; at?: Date } = {}
): Promise<CreditRate> {
  const providers = await providersFor(model)
  const at = options.at ?? new Date()
  const rates = (providers ?? []).map((provider) =>
    providerRate(provider, options.requestInputTokens ?? 0, at)
  )
  const [first, ...rest] = rates
  if (!first) {
    if (!unknownWarned.has(model)) {
      unknownWarned.add(model)
      logger.warn({ model }, "No AI Gateway price; billing the fallback rate")
    }
    return {
      inputUsdPerMtok: UNKNOWN_MODEL_USD_PER_MTOK.input,
      cachedInputUsdPerMtok: UNKNOWN_MODEL_USD_PER_MTOK.cachedInput,
      outputUsdPerMtok: UNKNOWN_MODEL_USD_PER_MTOK.output,
      conversionRate: env.CREDIT_CONVERSION_RATE,
    }
  }
  return rest.reduce(
    (most, rate) =>
      computeCostUsd(tokens, rate) > computeCostUsd(tokens, most) ? rate : most,
    first
  )
}
