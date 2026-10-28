// Ids must match autumn.config.ts (pushed with `atmn push`).
export const CREDITS_FEATURE_ID = "credits"
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
// Published sandbox rate: dev box (8 GB) 10 credits/hour, chat box (4 GB) 5.
export const SANDBOX_CREDITS_PER_GB_HOUR = 1.25
