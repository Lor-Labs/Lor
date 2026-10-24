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
