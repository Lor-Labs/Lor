import { createHash } from "node:crypto"
import type { HarnessHead } from "./harness-state"

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

export function headOf(text: string, logFileName: string): HarnessHead | null {
  const lines = text.split("\n").filter((line) => line.trim() !== "")
  if (lines.length < 2) return null
  const header = JSON.parse(lines[0] ?? "") as { id?: unknown }
  const last = JSON.parse(lines[lines.length - 1] ?? "") as { id?: unknown }
  if (typeof header.id !== "string" || typeof last.id !== "string") return null
  return {
    harnessSessionId: header.id,
    logFileName,
    entryCount: lines.length - 1,
    headEntryId: last.id,
    byteLength: Buffer.byteLength(text, "utf8"),
    sha256: sha256(text),
  }
}

export type PiRewind =
  | { kind: "ok"; appended: string; head: HarnessHead }
  // The entry is on a branch an earlier rewind left.
  | { kind: "off_branch" }
  // Nothing after the entry on the current branch.
  | { kind: "current" }
  // Saved by an older Pi; its next turn converts it first.
  | { kind: "old_format" }

// Rewind: what Pi's own tree navigation writes when it makes no summary
// (strict rewind): a label entry under `entryId`. Pi takes a log's last entry
// as its position, so the next turn continues from that entry. Nothing is
// removed; the later entries stay a branch of the tree.
export async function rewindPiLog(
  log: string,
  entryId: string,
  saved: { logFileName: string; formatVersion: number }
): Promise<PiRewind> {
  const { CURRENT_SESSION_VERSION, parseSessionEntries, SessionManager } =
    await import("@earendil-works/pi-coding-agent")
  if (saved.formatVersion !== CURRENT_SESSION_VERSION) {
    return { kind: "old_format" }
  }
  const manager = SessionManager.inMemory(
    "/",
    undefined,
    parseSessionEntries(log)
  )
  const path = manager.getBranch()
  const index = path.findIndex((entry) => entry.id === entryId)
  if (index < 0) return { kind: "off_branch" }
  if (path.slice(index + 1).every((entry) => entry.type === "label")) {
    return { kind: "current" }
  }
  manager.branch(entryId)
  manager.appendLabelChange(entryId, "rewind")
  const appended = `${JSON.stringify(manager.getEntries().at(-1))}\n`
  const head = headOf(log + appended, saved.logFileName)
  if (!head) throw new Error("Pi's rewound log has no entries")
  return { kind: "ok", appended, head }
}

// A fork's Pi log: Pi's own branched session (createBranchedSession), the
// path from the root to `entryId` under a new header whose cwd is the fork's
// work folder. Pi loads on first use, so the API only pays for it on a fork.
export async function branchPiLog(
  log: string,
  entryId: string,
  cwd: string
): Promise<{ log: string; head: HarnessHead; formatVersion: number }> {
  const { CURRENT_SESSION_VERSION, parseSessionEntries, SessionManager } =
    await import("@earendil-works/pi-coding-agent")
  const manager = SessionManager.inMemory(
    cwd,
    undefined,
    parseSessionEntries(log)
  )
  manager.createBranchedSession(entryId)
  const header = manager.getHeader()
  if (!header) throw new Error("Pi's branched session has no header")
  const text = [header, ...manager.getEntries()]
    .map((entry) => `${JSON.stringify(entry)}\n`)
    .join("")
  // Pi's own file name: <timestamp>_<session id>.jsonl.
  const head = headOf(
    text,
    `${header.timestamp.replace(/[:.]/g, "-")}_${header.id}.jsonl`
  )
  if (!head) throw new Error("Pi's branched session has no entries")
  return { log: text, head, formatVersion: CURRENT_SESSION_VERSION }
}
