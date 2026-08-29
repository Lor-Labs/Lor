// Pure windowing for read_thread: which slice of the thread's chronological
// id index to return. Split from readThread so the boundary math is testable
// without a database.

export type ThreadPage = { before?: string; after?: string }

export type ThreadWindow = {
  start: number
  end: number
  // Thread messages between the always-included root and the window's first
  // message, and after its last — reported to the model, never silent.
  omittedBefore: number
  omittedAfter: number
}

export function chooseThreadWindow(
  ids: string[],
  anchorId: string,
  page: ThreadPage,
  windowSize: number
): ThreadWindow | null {
  const anchorIndex = ids.indexOf(anchorId)
  if (anchorIndex < 0) return null
  let start: number
  let end: number
  if (page.before) {
    // Strictly older than the cursor, tail-aligned against it.
    end = anchorIndex
    start = Math.max(0, end - windowSize)
  } else if (page.after) {
    // Strictly newer than the cursor.
    start = anchorIndex + 1
    end = Math.min(ids.length, start + windowSize)
  } else {
    // Centred on the requested message — what the model asked about — not the
    // thread start. When the anchor sits near an edge, the window slides to
    // stay full rather than shrinking.
    start = Math.max(0, anchorIndex - Math.floor(windowSize / 2))
    end = Math.min(ids.length, start + windowSize)
    start = Math.max(0, Math.min(start, end - windowSize))
  }
  return {
    start,
    end,
    omittedBefore: Math.max(0, start - 1),
    omittedAfter: ids.length - end,
  }
}
