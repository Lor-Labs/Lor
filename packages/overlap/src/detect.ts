// Live overlap detection core: pure functions, no I/O and no Lor imports, so
// the same logic runs inside Lor's worker and in the standalone watcher.

// What one session is editing right now (uncommitted files).
export type SessionReport = {
  sessionId: string
  // The person the session belongs to. Two sessions by the same owner don't
  // alert by default.
  ownerId: string
  // Only sessions in the same scope can overlap, e.g. workspace + repository.
  scope: string
  // Repo-relative paths with uncommitted changes.
  files: string[]
  // Epoch ms of this report.
  at: number
}

export type SessionRef = Pick<SessionReport, "sessionId" | "ownerId">

// Two sessions with uncommitted edits to the same files.
export type Overlap = {
  scope: string
  mine: SessionRef
  theirs: SessionRef
  paths: string[]
}

export type FindOverlapsOptions = {
  ignoreSameOwner?: boolean
}

export function findOverlaps(
  report: SessionReport,
  others: SessionReport[],
  { ignoreSameOwner = true }: FindOverlapsOptions = {}
): Overlap[] {
  const mine = new Set(report.files)
  const overlaps: Overlap[] = []
  for (const other of others) {
    if (other.sessionId === report.sessionId) continue
    if (other.scope !== report.scope) continue
    if (ignoreSameOwner && other.ownerId === report.ownerId) continue
    const paths = other.files.filter((path) => mine.has(path)).sort()
    if (paths.length === 0) continue
    overlaps.push({
      scope: report.scope,
      mine: { sessionId: report.sessionId, ownerId: report.ownerId },
      theirs: { sessionId: other.sessionId, ownerId: other.ownerId },
      paths,
    })
  }
  return overlaps
}

// A report older than this no longer counts: its sandbox closed, its edits
// were committed outside a turn, or the session was abandoned.
export function isStale(
  report: SessionReport,
  now: number,
  staleAfterMs: number
) {
  return now - report.at > staleAfterMs
}

// One alert per session pair and file, regardless of which side reported.
export function alertKey(scope: string, a: string, b: string, path: string) {
  const [first, second] = a < b ? [a, b] : [b, a]
  return JSON.stringify([scope, first, second, path])
}
