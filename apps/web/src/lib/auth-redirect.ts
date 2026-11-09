import { features } from "@repo/utils/features"

// Pages that are themselves part of signing in: a redirect back to one is
// unwrapped to its own redirect, so links never nest
// (/login?redirect=/login?redirect=…).
const AUTH_PAGE =
  /^\/(?:login|signup|check-email|forgot-password|reset-password)(?:[/?#]|$)/
const MAX_UNWRAP = 20

function unwrapAuthPages(value: string): string | undefined {
  let current: string | undefined = value
  for (let i = 0; current && i < MAX_UNWRAP && AUTH_PAGE.test(current); i++) {
    current =
      new URL(current, "http://lor.local").searchParams.get("redirect") ??
      undefined
  }
  return current && !AUTH_PAGE.test(current) ? current : undefined
}

// Only allow same-app paths (no "//host" or absolute URLs) to prevent open redirects
export function sanitizeRedirect(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined
  const value = unwrapAuthPages(raw)
  if (!value) return undefined
  if (!value.startsWith("/") || value.startsWith("//")) return undefined
  // Old login and verification links should land in a workspace while DMs are hidden.
  if (!features.directMessages && /^\/dms(?:\/|[?#]|$)/.test(value)) return "/"
  return value
}
