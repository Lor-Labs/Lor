import { createHash } from "node:crypto"
import type { HarnessHead } from "./harness-state"
import { sessionWorkFolder } from "./work-dir"

// Rewind and fork for Claude Code's conversation file (code-sessions-runbook.md
// chunk 7e). The file is a tree: each entry names its parent (`parentUuid`),
// and Claude Code resumes from an entry with the SDK's `resumeSessionAt`,
// appending the next turn as a branch there. No adapter code here, so the API
// can branch without loading it.

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

type Entry = { uuid?: unknown; parentUuid?: unknown }

function entries(text: string): Entry[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Entry]
      } catch {
        return []
      }
    })
}

// The last entry on the conversation chain; a turn ends with metadata lines
// (last-prompt, cost-state) that carry none. 7e spike: a turn's last entry is
// its final assistant message.
export function lastEntryUuid(text: string): string | null {
  const all = entries(text)
  for (let i = all.length - 1; i >= 0; i--) {
    const uuid = all[i]?.uuid
    if (typeof uuid === "string") return uuid
  }
  return null
}

// `headEntryId` is the entry Claude Code resumes from: the file's last entry,
// or after a rewind an earlier one. `logFileName` is the file's path under
// ~/.claude, so a restore needs no knowledge of how Claude Code names
// project folders.
export function claudeHeadOf(
  text: string,
  logFileName: string,
  claudeSessionId: string,
  headEntryId?: string
): HarnessHead | null {
  const lines = text.split("\n").filter((line) => line.trim() !== "")
  if (lines.length === 0) return null
  return {
    harnessSessionId: claudeSessionId,
    logFileName,
    entryCount: lines.length,
    headEntryId: headEntryId ?? lastEntryUuid(text) ?? String(lines.length),
    byteLength: Buffer.byteLength(text, "utf8"),
    sha256: sha256(text),
  }
}

// The entry the next turn resumes from after a rewind, or null: only an entry
// in the file other than its last one.
export function pendingRewind(head: HarnessHead, log: string): string | null {
  const last = lastEntryUuid(log)
  if (!last || head.headEntryId === last) return null
  return entries(log).some((entry) => entry.uuid === head.headEntryId)
    ? head.headEntryId
    : null
}

export type ClaudeRewind =
  // Nothing is appended to the file, unlike Pi's label entry.
  | { kind: "ok"; head: HarnessHead; appended: null }
  // The entry is on a branch an earlier rewind left.
  | { kind: "off_branch" }
  // The session already resumes from that entry.
  | { kind: "current" }

// Rewind: the saved file is unchanged; the head moves to the turn's last
// entry, and the next turn resumes there (resumeSessionAt). The later turns
// stay a branch of the file, so they can still be forked.
export function rewindClaudeLog(
  log: string,
  entryUuid: string,
  head: HarnessHead
): ClaudeRewind {
  if (head.headEntryId === entryUuid) return { kind: "current" }
  const parents = new Map(
    entries(log).flatMap((entry) =>
      typeof entry.uuid === "string"
        ? [[entry.uuid, entry.parentUuid] as const]
        : []
    )
  )
  // Only an ancestor of the current head is on the session's branch.
  let cursor: unknown = parents.get(head.headEntryId)
  while (typeof cursor === "string") {
    if (cursor === entryUuid) {
      return {
        kind: "ok",
        head: { ...head, headEntryId: entryUuid },
        appended: null,
      }
    }
    cursor = parents.get(cursor)
  }
  return { kind: "off_branch" }
}

// A fork's file: the source file up to the end of the turn (its save's last
// byte), under the fork's own project folder. Claude Code finds a
// conversation by its work folder, which differs per session; entries keep
// the source's cwd, which resuming ignores (7e spike).
export function branchClaudeLog(input: {
  log: string
  endOffset: number
  head: HarnessHead
  sourceSessionId: string
  forkSessionId: string
}): { log: string; head: HarnessHead } | null {
  const text = Buffer.from(input.log, "utf8")
    .subarray(0, input.endOffset)
    .toString("utf8")
  const logFileName = input.head.logFileName.replace(
    sessionWorkFolder(input.sourceSessionId),
    sessionWorkFolder(input.forkSessionId)
  )
  if (logFileName === input.head.logFileName) return null
  const head = claudeHeadOf(text, logFileName, input.head.harnessSessionId)
  return head ? { log: text, head } : null
}
