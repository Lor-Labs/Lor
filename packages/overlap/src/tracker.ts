import {
  alertKey,
  findOverlaps,
  isStale,
  type Overlap,
  type SessionReport,
} from "./detect"
import type { OverlapStore } from "./store"

export type OverlapTrackerOptions = {
  store: OverlapStore
  // A session's edits stop counting this long after its last report.
  staleAfterMs?: number
  // The same pair and file alerts again only after this long.
  alertCooldownMs?: number
  ignoreSameOwner?: boolean
  now?: () => number
}

export type OverlapTracker = ReturnType<typeof createOverlapTracker>

export function createOverlapTracker({
  store,
  staleAfterMs = 30 * 60_000,
  alertCooldownMs = 6 * 60 * 60_000,
  ignoreSameOwner = true,
  now = Date.now,
}: OverlapTrackerOptions) {
  return {
    // Record a session's current uncommitted files and return overlaps that
    // haven't alerted yet, one entry per other session.
    async report(input: Omit<SessionReport, "at">): Promise<Overlap[]> {
      const report: SessionReport = { ...input, at: now() }
      if (report.files.length === 0) {
        await store.remove(report.scope, report.sessionId)
        return []
      }
      await store.put(report, staleAfterMs)

      const others: SessionReport[] = []
      for (const other of await store.list(report.scope)) {
        if (isStale(other, report.at, staleAfterMs)) {
          await store.remove(other.scope, other.sessionId)
        } else {
          others.push(other)
        }
      }

      const fresh: Overlap[] = []
      for (const overlap of findOverlaps(report, others, { ignoreSameOwner })) {
        const paths: string[] = []
        for (const path of overlap.paths) {
          const key = alertKey(
            overlap.scope,
            overlap.mine.sessionId,
            overlap.theirs.sessionId,
            path
          )
          if (await store.claim(key, alertCooldownMs)) paths.push(path)
        }
        if (paths.length > 0) fresh.push({ ...overlap, paths })
      }
      return fresh
    },

    // The session committed, was archived, or its sandbox closed for good.
    clear(scope: string, sessionId: string) {
      return store.remove(scope, sessionId)
    },
  }
}
