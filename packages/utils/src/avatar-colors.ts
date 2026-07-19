export const AVATAR_COLORS = [
  "crimson",
  "orange",
  "amber",
  "olive",
  "emerald",
  "teal",
  "cyan",
  "blue",
  "indigo",
  "violet",
  "magenta",
  "rose",
] as const

export type AvatarColor = (typeof AVATAR_COLORS)[number]

export type AvatarColorStyle = {
  backgroundColor: string
  foregroundColor: string
}

export const AVATAR_COLOR_STYLES: Record<AvatarColor, AvatarColorStyle> = {
  crimson: { backgroundColor: "#B4233C", foregroundColor: "#FFFFFF" },
  orange: { backgroundColor: "#A34A10", foregroundColor: "#FFFFFF" },
  amber: { backgroundColor: "#875900", foregroundColor: "#FFFFFF" },
  olive: { backgroundColor: "#5F6B12", foregroundColor: "#FFFFFF" },
  emerald: { backgroundColor: "#19734B", foregroundColor: "#FFFFFF" },
  teal: { backgroundColor: "#0F766E", foregroundColor: "#FFFFFF" },
  cyan: { backgroundColor: "#0E7188", foregroundColor: "#FFFFFF" },
  blue: { backgroundColor: "#2563A8", foregroundColor: "#FFFFFF" },
  indigo: { backgroundColor: "#4F46A5", foregroundColor: "#FFFFFF" },
  violet: { backgroundColor: "#6D3EB5", foregroundColor: "#FFFFFF" },
  magenta: { backgroundColor: "#962B76", foregroundColor: "#FFFFFF" },
  rose: { backgroundColor: "#A8325A", foregroundColor: "#FFFFFF" },
}

export function isAvatarColor(value: unknown): value is AvatarColor {
  return (
    typeof value === "string" &&
    (AVATAR_COLORS as readonly string[]).includes(value)
  )
}

/** Stable 32-bit hash for consistent assignments across runtimes. */
function hashSeed(seed: string): number {
  let hash = 2_166_136_261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}

/**
 * Selects from the least-used colors in a workspace, using the seed only to
 * break ties. The first palette cycle is unique and later cycles stay even.
 */
export function pickWorkspaceAvatarColor(
  usedColors: readonly (string | null | undefined)[],
  seed: string
): AvatarColor {
  const counts = new Map<AvatarColor, number>(
    AVATAR_COLORS.map((color) => [color, 0])
  )

  for (const color of usedColors) {
    if (isAvatarColor(color)) {
      counts.set(color, (counts.get(color) ?? 0) + 1)
    }
  }

  const minimum = Math.min(...counts.values())
  const candidates = AVATAR_COLORS.filter(
    (color) => counts.get(color) === minimum
  )
  return candidates[hashSeed(seed) % candidates.length] ?? AVATAR_COLORS[0]
}

/** Deterministic fallback for surfaces that have not loaded membership data. */
export function avatarColorFromSeed(seed: string): AvatarColor {
  return (
    AVATAR_COLORS[hashSeed(seed) % AVATAR_COLORS.length] ?? AVATAR_COLORS[0]
  )
}

export function getAvatarColorStyle(
  color: string | null | undefined,
  fallbackSeed: string
): AvatarColorStyle {
  const resolved = isAvatarColor(color)
    ? color
    : avatarColorFromSeed(fallbackSeed)
  return AVATAR_COLOR_STYLES[resolved]
}

export function getAvatarInitials(name: string | null | undefined): string {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? []
  if (parts.length === 0) return "?"

  const first = parts[0] ?? ""
  const last = parts.at(-1) ?? first
  const initials =
    parts.length === 1 ? first.slice(0, 2) : `${first[0] ?? ""}${last[0] ?? ""}`

  return initials.toUpperCase() || "?"
}
