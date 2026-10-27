import { createHash } from "node:crypto"
import type { HarnessHead } from "./harness-state"

// Rewind and fork for Codex's rollout (code-sessions-runbook.md chunk 8e).
// The rollout is append-only. A rewind appends Codex's own rollback event,
// which drops the newest N user turns when the thread resumes (Codex 0.160.1,
// rollout_reconstruction.rs); the later turns stay in the file, so they can
// still be forked. A fork is the file up to the turn's end. No adapter code
// here, so the API can branch without loading it.

// `headEntryId` is the line count: Codex's lines carry no ids.
export function codexHeadOf(
  text: string,
  logFileName: string,
  threadId: string
): HarnessHead | null {
  const lines = text.split("\n").filter((line) => line.trim() !== "")
  if (lines.length === 0) return null
  return {
    harnessSessionId: threadId,
    logFileName,
    entryCount: lines.length,
    headEntryId: String(lines.length),
    byteLength: Buffer.byteLength(text, "utf8"),
    sha256: createHash("sha256").update(text, "utf8").digest("hex"),
  }
}

type RolloutLine = {
  ordinal?: unknown
  type?: unknown
  payload?: { type?: unknown; num_turns?: unknown; item?: { type?: unknown } }
}

// Byte offsets where user turns start, as Codex counts them for a rollback
// (a person's message or another agent's), and the ones still in the thread
// after its rollbacks; plus where compactions are and the last line's
// ordinal. Codex's paginated rollout (its default) records a person's
// message as an item_completed UserMessage, the older one as user_message.
function userTurns(log: string) {
  const all: number[] = []
  const live: number[] = []
  const compactions: number[] = []
  let ordinal: number | null = null
  let offset = 0
  for (const line of log.split("\n")) {
    const start = offset
    offset += Buffer.byteLength(line, "utf8") + 1
    if (!line.trim()) continue
    let entry: RolloutLine
    try {
      entry = JSON.parse(line) as RolloutLine
    } catch {
      continue
    }
    ordinal = typeof entry.ordinal === "number" ? entry.ordinal : null
    const event = entry.type === "event_msg" ? entry.payload : null
    if (
      event?.type === "user_message" ||
      (event?.type === "item_completed" &&
        event.item?.type === "UserMessage") ||
      entry.type === "inter_agent_communication"
    ) {
      all.push(start)
      live.push(start)
    } else if (event?.type === "thread_rolled_back") {
      const dropped = event.num_turns
      if (typeof dropped === "number" && dropped > 0) {
        live.splice(Math.max(0, live.length - dropped))
      }
    } else if (entry.type === "compacted") {
      compactions.push(start)
    }
  }
  return { all, live, compactions, ordinal }
}

export type CodexRewind =
  | { kind: "ok"; head: HarnessHead; appended: string }
  // An earlier rewind dropped the turn.
  | { kind: "off_branch" }
  // No turn after it is still in the thread.
  | { kind: "current" }
  // Codex compacted after the turn: the summary would keep the later turns.
  | { kind: "compacted" }

// Rewind to the turn that ends at `endOffset` (its run's last saved byte):
// drop every user turn after it that is still in the thread.
export function rewindCodexLog(
  log: string,
  endOffset: number,
  head: HarnessHead
): CodexRewind {
  const turns = userTurns(log)
  const own = turns.all.filter((start) => start < endOffset).at(-1)
  if (own === undefined || !turns.live.includes(own)) {
    return { kind: "off_branch" }
  }
  const later = turns.live.filter((start) => start >= endOffset).length
  if (later === 0) return { kind: "current" }
  if (turns.compactions.some((start) => start >= endOffset)) {
    return { kind: "compacted" }
  }
  // A paginated rollout's last line must carry an ordinal: Codex resumes the
  // count from it.
  const marker = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...(turns.ordinal !== null ? { ordinal: turns.ordinal + 1 } : {}),
    type: "event_msg",
    payload: { type: "thread_rolled_back", num_turns: later },
  })
  const appended = `${log.endsWith("\n") ? "" : "\n"}${marker}\n`
  const next = codexHeadOf(
    log + appended,
    head.logFileName,
    head.harnessSessionId
  )
  if (!next) return { kind: "off_branch" }
  return { kind: "ok", head: next, appended }
}

// A fork's rollout: the file up to the turn's end, with the same thread id
// and path; the fork's own sandbox holds it, and the adapter resumes it in
// the fork's work folder.
export function branchCodexLog(
  log: string,
  endOffset: number,
  head: HarnessHead
): { log: string; head: HarnessHead } | null {
  const text = Buffer.from(log, "utf8").subarray(0, endOffset).toString("utf8")
  const next = codexHeadOf(text, head.logFileName, head.harnessSessionId)
  return next ? { log: text, head: next } : null
}
