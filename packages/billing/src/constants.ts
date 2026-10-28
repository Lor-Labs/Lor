// Ids must match autumn.config.ts (pushed with `atmn push`).
// The credit pool (an Autumn credit system): balances, grants and plans use
// it. Usage is tracked on the underlying features, priced in autumn.config.ts.
// `lor_credits`, not `credits`: the July sandbox push left an archived metered
// `credits` feature that Autumn will not turn into a credit system.
export const CREDITS_FEATURE_ID = "lor_credits"
export const AI_USAGE_FEATURE_ID = "ai_usage"
export const SANDBOX_USAGE_FEATURE_ID = "sandbox_gb_hours"
export const PRO_PLAN_ID = "pro"
export const TOPUP_PLAN_ID = "topup"

// Top-ups are any whole-dollar amount from the minimum ($1 = 100 credits,
// the topup plan's billing unit). No maximum.
export const TOPUP_MIN_USD = 5
export const CREDITS_PER_USD = 100

export const SEAT_PRICE_USD = 20
export const CREDITS_PER_SEAT = 2_000
export const CREDIT_USD = 0.01
export const PROMO_CREDITS = 2_000
