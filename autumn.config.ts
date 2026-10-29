import { feature, item, plan } from "atmn"

// Source of truth for Lor pricing — push with `npx atmn push` (sandbox first).
// One credit pool (1 credit = $0.01) that AI, sandbox and later browser time
// draw from. Code tracks the underlying features; Autumn prices them here.

// AI, already priced by Lor (Gateway provider prices, packages/billing
// rates.ts) and tracked as fractional credits.
export const aiUsage = feature({
  id: "ai_usage",
  name: "AI",
  type: "metered",
  consumable: true,
})

// Sandbox running time in GB of RAM × hours, from the provider's billing
// data. Code sandbox (8 GB): 10 credits an hour; chat sandbox (4 GB): 5.
export const sandboxUsage = feature({
  id: "sandbox_gb_hours",
  name: "Sandbox time",
  type: "metered",
  consumable: true,
})

export const credits = feature({
  // Must match CREDITS_FEATURE_ID in packages/billing/src/constants.ts.
  id: "lor_credits",
  name: "Lor credits",
  type: "credit_system",
  creditSchema: [
    { meteredFeatureId: aiUsage.id, creditCost: 1 },
    { meteredFeatureId: sandboxUsage.id, creditCost: 1.25 },
  ],
})

// Strategy A: one prepaid monthly item drives both price and grant.
// quantity = seats × 2000 (total credits), billed at $20 per 2000-credit seat
// block. The monthly grant resets at cycle end (no rollover — purchased
// top-ups are the rollover balance, and Autumn burns shorter intervals first).
export const pro = plan({
  id: "pro",
  name: "Lor Pro",
  items: [
    item({
      featureId: credits.id,
      // Monthly prepaid billing implies the monthly reset — the grant
      // expires at cycle end (top-ups are the never-expiring balance).
      // Proration is left at the server default (prorate immediately on
      // seat changes); the CLI's proration enums lag the API, so tune it
      // in the dashboard if needed.
      price: {
        amount: 20,
        billingUnits: 2000,
        billingMethod: "prepaid",
        interval: "month",
      },
    }),
  ],
})

// Manual top-ups: one add-on, any whole-dollar amount ($1 = 100 credits, the
// billing unit; range in packages/billing constants). One-off prepaid → never
// expires.
export const topup = plan({
  id: "topup",
  name: "Credit top-up",
  addOn: true,
  items: [
    item({
      featureId: credits.id,
      // one_off = one-time charge and a lifetime balance. Autumn burns
      // shorter intervals first, so the monthly grant is always spent
      // before these.
      price: {
        amount: 1,
        billingUnits: 100,
        billingMethod: "prepaid",
        interval: "one_off",
      },
    }),
  ],
})
