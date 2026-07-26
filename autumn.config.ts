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
      // Monthly prepaid billing implies the monthly reset — the grant
      // expires at cycle end (top-ups are the never-expiring balance).
      price: {
        amount: 20,
        billingUnits: 2000,
        billingMethod: "prepaid",
        interval: "month",
      },
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
      // one_off reset = lifetime balance; interval-less price = one-time
      // charge. Autumn burns shorter intervals first, so the monthly grant
      // is always spent before these.
      reset: { interval: "one_off" },
      price: {
        amount: 25,
        billingUnits: 2500,
        billingMethod: "prepaid",
      },
    }),
  ],
})
