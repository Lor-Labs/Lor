import { useRef } from "react"

// Eases a row in when it arrives live. Pair with `appended.has(id)`.
export const ARRIVE_IN =
  "fade-in-0 slide-in-from-bottom-1 animate-in duration-200 ease-out motion-reduce:animate-none"

/**
 * Ids appended to the end of a list after it first rendered, so rows that
 * arrive live can ease in. Older pages (prepended), a replaced list (channel
 * switch, jump to a message) and the first load all count as history. Pass
 * `live={false}` while the list isn't at its newest end, so a page loaded by
 * scrolling down doesn't animate either.
 */
export function useAppendedIds(
  ids: readonly string[],
  live = true
): ReadonlySet<string> {
  const appended = useRef<Set<string>>(new Set())
  const lastId = useRef<string | undefined>(undefined)
  const wasLive = useRef(live)

  const previousLast = lastId.current
  if (previousLast !== undefined && ids[ids.length - 1] !== previousLast) {
    const at = ids.lastIndexOf(previousLast)
    if (at === -1) appended.current = new Set()
    else if (wasLive.current) {
      for (const id of ids.slice(at + 1)) appended.current.add(id)
    }
  }
  lastId.current = ids[ids.length - 1]
  wasLive.current = live
  return appended.current
}

/**
 * Ids that joined an unordered list (sidebar channels, DMs) after it first
 * rendered. A list that shares no id with what was seen (first load, a
 * workspace switch) is history, not arrivals.
 */
export function useNewIds(ids: readonly string[]): ReadonlySet<string> {
  const seen = useRef<Set<string> | null>(null)
  const fresh = useRef<Set<string>>(new Set())

  if (seen.current === null) {
    seen.current = new Set(ids)
    return fresh.current
  }
  const known = seen.current
  const unseen = ids.filter((id) => !known.has(id))
  if (unseen.length > 0) {
    if (ids.some((id) => known.has(id))) {
      for (const id of unseen) fresh.current.add(id)
    } else {
      fresh.current = new Set()
    }
    for (const id of unseen) known.add(id)
  }
  return fresh.current
}
