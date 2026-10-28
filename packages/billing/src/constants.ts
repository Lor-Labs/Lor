// Ids must match autumn.config.ts (pushed with `atmn push`).
// The credit pool (an Autumn credit system): balances, grants and plans use
// it. Usage is tracked on the underlying features, priced in autumn.config.ts.
export const CREDITS_FEATURE_ID = "credits"
export const AI_USAGE_FEATURE_ID = "ai_usage"
export const SANDBOX_USAGE_FEATURE_ID = "sandbox_gb_hours"
export const PRO_PLAN_ID = "pro"
export const TOPUP_PLAN_ID = "topup"

export const TOPUP_SIZES = {
  small: 2_500,
  medium: 10_000,
  large: 50_000,
} as const
export type TopupSize = keyof typeof TOPUP_SIZES

export const SEAT_PRICE_USD = 20
export const CREDITS_PER_SEAT = 2_000
export const CREDIT_USD = 0.01
export const PROMO_CREDITS = 2_000
