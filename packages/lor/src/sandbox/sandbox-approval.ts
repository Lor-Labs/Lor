import type { PiBuiltinToolApproval } from "@ai-sdk/harness-pi"
import type { TurnSandboxMode } from "@repo/db/schema"

// Approval for Pi's sandbox tools under the turn's frozen sandbox mode, through
// the patched adapter callback (reference/planned/pi-harness-runbook.md §4.6).
// Read-only tools never ask. "ask" pauses the turn like any approval gate.
// Until the rules (1.3f-2) and the classifier (1.3f-3) land, auto asks like
// manual, and autonomous runs (Loop, Act) allow every call as before.
export function sandboxToolApproval(
  mode: TurnSandboxMode
): PiBuiltinToolApproval {
  return ({ kind }) =>
    kind === "readonly" || mode === "bypass" || mode === "autonomous"
      ? "allow"
      : "ask"
}

const MAX_COMMAND_CHARS = 500

// The approval card's line for a sandbox call.
export function sandboxAskDescription(
  toolName: string,
  input: unknown
): string {
  const args = (input && typeof input === "object" ? input : {}) as Record<
    string,
    unknown
  >
  const path = typeof args.file_path === "string" ? args.file_path : null
  if (toolName === "bash" && typeof args.command === "string") {
    const command =
      args.command.length > MAX_COMMAND_CHARS
        ? `${args.command.slice(0, MAX_COMMAND_CHARS)}…`
        : args.command
    return `Run a command: ${command}`
  }
  if (toolName === "write" && path) return `Write ${path}`
  if (toolName === "edit" && path) return `Edit ${path}`
  return `Use ${toolName} in the sandbox`
}
