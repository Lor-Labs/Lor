// Only allow same-app paths (no "//host" or absolute URLs) to prevent open redirects
export function sanitizeRedirect(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  if (!value.startsWith("/") || value.startsWith("//")) return undefined
  return value
}
