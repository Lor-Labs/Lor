// Saved harness state and the store port the session core uses.
// Lor implements the store (worker); the core never imports @repo/db.
// See reference/planned/pi-harness-runbook.md §4.3 and §6.

export type HarnessKind = "pi" | "claude_code"

// A Lor session or a voice call.
export type HarnessOwner = { sessionId: string } | { voiceSessionId: string }

export type HarnessBinding = {
  kind: HarnessKind
  adapterVersion: string
  // Pi's session file format version (CURRENT_SESSION_VERSION).
  formatVersion: number
}

export type HarnessHead = {
  // Pi's own header id and file name.
  harnessSessionId: string
  logFileName: string
  entryCount: number
  headEntryId: string
  byteLength: number
  sha256: string
}

export type SavedHarnessState = {
  binding: HarnessBinding
  head: HarnessHead
  // The full harness log (UTF-8 JSONL).
  log: string
  // Verbatim harness continue-turn state while approvals are pending.
  continuation: unknown | null
}

export type SaveHarnessStateInput = {
  owner: HarnessOwner
  workspaceId: string
  // The claiming run and its attempt: a lost lease cannot advance the head.
  claim: { runId: string; attempt: number }
  binding: HarnessBinding
  // null on the conversation's first save.
  expected: HarnessHead | null
  head: HarnessHead
  // Normally the bytes after expected.byteLength. "replace" stores the whole
  // log, after Pi converted an older format and rewrote earlier lines.
  log: { kind: "append"; text: string } | { kind: "replace"; text: string }
  continuation: unknown | null
}

export interface HarnessStateStore {
  load(
    owner: HarnessOwner,
    workspaceId: string
  ): Promise<SavedHarnessState | null>
  // One transaction; throws SessionCoreError on a lease or head conflict.
  save(input: SaveHarnessStateInput): Promise<void>
}

export type SessionCoreErrorCode =
  | "lease_lost"
  | "head_conflict"
  | "corrupt_state"
  | "incompatible_state"

export class SessionCoreError extends Error {
  constructor(
    readonly code: SessionCoreErrorCode,
    message: string
  ) {
    super(message)
    this.name = "SessionCoreError"
  }
}

export type Compatibility = {
  // Pi converts an older file format when it opens the log; the next save then
  // replaces the stored log with the converted one.
  convertsFormat: boolean
  // A pending continuation is adapter-specific. "expire" (written by another
  // adapter version): the core expires the pending approvals with a notice
  // and continues from the saved log, where those calls read as not run.
  continuation: "none" | "resume" | "expire"
}

// Upgrades keep working. Only a different harness, or a file format newer than
// this Pi (a downgrade), is refused.
export function checkCompatibility(
  saved: SavedHarnessState,
  current: HarnessBinding
): Compatibility {
  if (saved.binding.kind !== current.kind) {
    throw new SessionCoreError(
      "incompatible_state",
      `This conversation runs on ${saved.binding.kind}, not ${current.kind}`
    )
  }
  if (saved.binding.formatVersion > current.formatVersion) {
    throw new SessionCoreError(
      "incompatible_state",
      `Saved session format ${saved.binding.formatVersion} is newer than this Pi (${current.formatVersion})`
    )
  }
  return {
    convertsFormat: saved.binding.formatVersion < current.formatVersion,
    continuation:
      saved.continuation === null
        ? "none"
        : saved.binding.adapterVersion === current.adapterVersion
          ? "resume"
          : "expire",
  }
}
