import type { ChannelSearchResult } from "./api-types"

export function mergeChannelSearchResults(
  current: ChannelSearchResult[],
  incoming: ChannelSearchResult[]
) {
  const seen = new Set<string>()
  const merged: ChannelSearchResult[] = []

  for (const result of [...current, ...incoming]) {
    if (seen.has(result.id)) continue
    seen.add(result.id)
    merged.push(result)
  }

  return merged
}
