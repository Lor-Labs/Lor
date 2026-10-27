import { features } from "@repo/utils/features"

// Only allow same-app paths (no "//host" or absolute URLs) to prevent open redirects
export function sanitizeRedirect(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  if (!value.startsWith("/") || value.startsWith("//")) return undefined
  // Old login and verification links should land in a workspace while DMs are hidden.
  if (!features.directMessages && /^\/dms(?:\/|[?#]|$)/.test(value)) return "/"
  return value
}
