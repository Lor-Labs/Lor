// A place (a Discord channel agents are in) shows its Discord name with the #,
// as Discord does; the name itself is synced from Discord and stored bare.
export function chatDisplayName(
  name: string | null | undefined,
  place: boolean,
  fallback = "Chat"
) {
  if (place) return `#${name ?? "channel"}`
  return name ?? fallback
}
