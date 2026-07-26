import { feature, item, plan } from "atmn"

// Source of truth for Lor pricing — push with `npx atmn push` (sandbox first).
// The worker computes credit debits itself (token usage × model_rate),
// so `credits` is a single metered feature, not an Autumn credit_system.
export const credits = feature({
  id: "credits",
  name: "Merlin credits",
  type: "metered",
  consumable: true,
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
      price: {
        amount: 20,
        billingUnits: 2000,
        billingMethod: "prepaid",
        interval: "month",
      },
      reset: { interval: "month" },
      proration: {
        onIncrease: "prorate",
        onDecrease: "no_action",
      },
    }),
  ],
})

// Manual top-ups: one add-on, quantity chosen from UI presets (2,500 / 10,000 /
// 50,000 — all multiples of billingUnits). One-off prepaid → never expires.
export const topup = plan({
  id: "topup",
  name: "Credit top-up",
  addOn: true,
  items: [
    item({
      featureId: credits.id,
      price: {
        amount: 25,
        billingUnits: 2500,
        billingMethod: "prepaid",
      },
    }),
  ],
})
