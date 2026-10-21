import type {
  PiBuiltinToolApproval,
  PiBuiltinToolDecision,
} from "@ai-sdk/harness-pi"
import type { TurnSandboxMode } from "@repo/db/schema"
import {
  checkCommand,
  checkFileWrite,
  type PolicyContext,
  type SandboxCheck,
} from "./command-policy"

// Approval for Pi's sandbox tools under the turn's frozen sandbox mode, through
// the patched adapter callback (reference/planned/pi-harness-runbook.md §4.6):
//
// | Check    | Manual | Auto | Bypass | Loop / Act |
// | hard     | deny   | deny | deny   | deny       |
// | safe     | allow  | allow| allow  | allow      |
// | routine  | ask    | allow| allow  | allow      |
// | flagged  | ask    | ask  | allow  | refuse     |
//
// Flagged calls go to the classifier in 1.3f-3. "ask" pauses the turn like
// any approval gate. Read-only tools never ask.

type SandboxOutcome = "allow" | "ask" | "deny"

export type SandboxApproval = {
  decide: PiBuiltinToolApproval
  // Why a call was asked about, for its approval card.
  askReason: (toolCallId: string) => string | undefined
}

// Claude Code's breaker: after this many refusals the model is told to stop.
const MAX_CONSECUTIVE_DENIALS = 3
const MAX_TOTAL_DENIALS = 20

function outcomeFor(
  mode: TurnSandboxMode,
  check: SandboxCheck
): SandboxOutcome {
  if (check.kind === "hard") return "deny"
  if (check.kind === "safe" || mode === "bypass") return "allow"
  if (check.kind === "routine") return mode === "manual" ? "ask" : "allow"
  return mode === "autonomous" ? "deny" : "ask"
}

function denialText(check: SandboxCheck, stop: boolean): string {
  const reason = "reason" in check ? check.reason : "is not allowed"
  const base =
    check.kind === "hard"
      ? `Blocked: this ${reason}, which Lor never runs in its sandbox. Don't retry it or a variant.`
      : `This command was blocked as potentially dangerous: it ${reason}. Don't retry it or a variant. Find a safer way, or finish and report what you couldn't do.`
  return stop
    ? `${base} Several calls were blocked in this turn: stop now, finish, and report what you could not do.`
    : base
}

function stringArg(input: unknown, key: string): string {
  const value =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)[key]
      : undefined
  return typeof value === "string" ? value : ""
}

export function sandboxToolApproval(input: {
  mode: TurnSandboxMode
  policy: PolicyContext
}): SandboxApproval {
  const askReasons = new Map<string, string>()
  let consecutiveDenials = 0
  let totalDenials = 0

  const decide = async (call: Parameters<PiBuiltinToolApproval>[0]) => {
    if (call.kind === "readonly") return "allow" as const
    const subject =
      call.toolName === "bash"
        ? stringArg(call.input, "command")
        : stringArg(call.input, "file_path")
    const check =
      call.toolName === "bash"
        ? await checkCommand(subject, input.policy)
        : checkFileWrite(subject, input.policy)
    const outcome = outcomeFor(input.mode, check)
    const reason = "reason" in check ? check.reason : null
    if (outcome !== "deny") consecutiveDenials = 0
    if (outcome === "allow") return "allow" as const
    if (outcome === "ask") {
      if (reason) askReasons.set(call.toolCallId, reason)
      return "ask" as const
    }
    consecutiveDenials++
    totalDenials++
    return {
      type: "deny" as const,
      reason: denialText(
        check,
        consecutiveDenials >= MAX_CONSECUTIVE_DENIALS ||
          totalDenials >= MAX_TOTAL_DENIALS
      ),
    }
  }

  return {
    decide: (call): Promise<PiBuiltinToolDecision> => decide(call),
    askReason: (toolCallId) => askReasons.get(toolCallId),
  }
}

const MAX_DESCRIPTION_COMMAND_CHARS = 500

// The approval card's line for a sandbox call, with the reason it was flagged.
export function sandboxAskDescription(
  toolName: string,
  input: unknown,
  reason: string | undefined
): string {
  const path = stringArg(input, "file_path")
  const command = stringArg(input, "command")
  const call =
    toolName === "bash" && command
      ? `Run a command: ${
          command.length > MAX_DESCRIPTION_COMMAND_CHARS
            ? `${command.slice(0, MAX_DESCRIPTION_COMMAND_CHARS)}…`
            : command
        }`
      : toolName === "write" && path
        ? `Write ${path}`
        : toolName === "edit" && path
          ? `Edit ${path}`
          : `Use ${toolName} in the sandbox`
  return reason ? `${call} (${reason})` : call
}
