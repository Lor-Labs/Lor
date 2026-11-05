// A unified diff's hunks, shared by the Changes panel's hunk staging (the
// API's git apply) and the web diff view's per-hunk controls.

export type HunkRange = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
}

export type PatchHunk = HunkRange & {
  // The body after the @@ line, "\ No newline at end of file" included.
  lines: string[]
}

// Each hunk of a combined (HEAD to work folder) diff: all in the index, none,
// or some.
export type HunkStage = "staged" | "unstaged" | "partial"

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

// The file header is everything before the first @@.
export function parsePatch(patch: string): {
  header: string
  hunks: PatchHunk[]
} {
  const lines = patch.split("\n")
  if (lines.at(-1) === "") lines.pop()
  const header: string[] = []
  const hunks: PatchHunk[] = []
  for (const line of lines) {
    const match = HUNK_HEADER.exec(line)
    if (match) {
      hunks.push({
        oldStart: Number(match[1]),
        oldLines: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]),
        newLines: match[4] === undefined ? 1 : Number(match[4]),
        lines: [],
      })
    } else if (hunks.length > 0) {
      hunks.at(-1)?.lines.push(line)
    } else {
      header.push(line)
    }
  }
  return {
    header: header.length > 0 ? `${header.join("\n")}\n` : "",
    hunks,
  }
}

// One side's lines; a zero-line side is the gap after `start`.
function span(start: number, lines: number): [number, number] {
  return lines === 0 ? [start + 0.5, start + 0.5] : [start, start + lines - 1]
}

// A -U0 hunk (one side) falls inside a context hunk. Widened by half a line
// so an insertion at the file's end still counts; context keeps neighbors
// apart.
export function insideHunk(
  zero: [start: number, lines: number],
  hunk: [start: number, lines: number]
) {
  const [lo, hi] = span(...zero)
  const [start, end] = span(...hunk)
  return lo <= end + 0.5 && start - 0.5 <= hi
}

// Staged parts match HEAD's side of the staged (-U0) diff, unstaged ones the
// work folder's side of the unstaged diff.
export function hunkStages(
  combined: HunkRange[],
  staged: HunkRange[],
  unstaged: HunkRange[]
): HunkStage[] {
  return combined.map((hunk) => {
    const inIndex = staged.some((part) =>
      insideHunk([part.oldStart, part.oldLines], [hunk.oldStart, hunk.oldLines])
    )
    const outside = unstaged.some((part) =>
      insideHunk([part.newStart, part.newLines], [hunk.newStart, hunk.newLines])
    )
    if (inIndex && outside) return "partial"
    return inIndex ? "staged" : "unstaged"
  })
}

// A subset of a -U0 diff's hunks as one patch for git apply, renumbered so
// each hunk's position hint holds once the earlier picked ones apply.
// Forward keeps the old side (the index when staging); reverse keeps the new
// side (the index when unstaging with --reverse).
export function subsetPatch(
  header: string,
  picked: PatchHunk[],
  direction: "forward" | "reverse"
) {
  let delta = 0
  const body = picked.map((hunk) => {
    let { oldStart, newStart } = hunk
    if (direction === "forward") {
      const oldAt = hunk.oldLines === 0 ? oldStart + 1 : oldStart
      newStart = hunk.newLines === 0 ? oldAt + delta - 1 : oldAt + delta
    } else {
      const newAt = hunk.newLines === 0 ? newStart + 1 : newStart
      oldStart = hunk.oldLines === 0 ? newAt - delta - 1 : newAt - delta
    }
    delta += hunk.newLines - hunk.oldLines
    const lines = hunk.lines.map((line) => `${line}\n`).join("")
    return `@@ -${oldStart},${hunk.oldLines} +${newStart},${hunk.newLines} @@\n${lines}`
  })
  return header + body.join("")
}

// Where a hunk's controls go in a diff view: after its last changed line.
export function lastChangedLine(
  hunk: PatchHunk
): { side: "deletions" | "additions"; lineNumber: number } | null {
  let oldLine = hunk.oldStart - 1
  let newLine = hunk.newStart - 1
  let last: ReturnType<typeof lastChangedLine> = null
  for (const line of hunk.lines) {
    if (line.startsWith("+")) {
      newLine += 1
      last = { side: "additions", lineNumber: newLine }
    } else if (line.startsWith("-")) {
      oldLine += 1
      last = { side: "deletions", lineNumber: oldLine }
    } else if (line.startsWith(" ")) {
      oldLine += 1
      newLine += 1
    }
  }
  return last
}
