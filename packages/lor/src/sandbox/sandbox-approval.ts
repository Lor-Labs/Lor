import { createHash } from "node:crypto"
import type {
  PiBuiltinToolApproval,
  PiBuiltinToolDecision,
} from "@ai-sdk/harness-pi"
import type { SandboxTurnContext, TurnSandboxMode } from "@repo/db/schema"
import type { Experimental_SandboxSession as SandboxSession } from "ai"
import type {
  ClassifierInput,
  ClassifierVerdict,
  SandboxClassifier,
} from "./classifier"
import {
  CLASSIFIER_TEXT_LIMIT,
  callSubject,
  classifierFacts,
  stringArg,
} from "./classifier-context"
import {
  checkCommand,
  checkFileWrite,
  type PolicyContext,
  type SandboxCheck,
} from "./command-policy"
import type { ParsedShell } from "./shell-parse"

// Approval for Pi's sandbox tools under the turn's frozen sandbox mode, through
// the patched adapter callback (reference/planned/pi-harness-runbook.md §4.6):
//
// | Check    | Manual | Auto | Bypass | Loop / Act |
// | hard     | deny   | deny | deny   | deny       |
// | safe     | allow  | allow| allow  | allow      |
// | routine  | ask    | allow| allow  | allow      |
// | flagged  | ask    | Jev  | allow  | Jev        |
//
// Flagged calls reach Jev only in Auto and autonomous. "ask" pauses the turn like
// any approval gate. Read-only tools never ask.

export type SandboxOutcome = "allow" | "ask" | "deny"

export type SandboxApproval = {
  decide: PiBuiltinToolApproval
  // Why a call was asked about, for its approval card.
  askReason: (toolCallId: string) => string | undefined
  snapshot: () => SandboxTurnContext
  observe: (toolName: string, input: unknown) => void
}

// Claude Code's breaker: after this many refusals the model is told to stop.
const MAX_CONSECUTIVE_DENIALS = 3
const MAX_TOTAL_DENIALS = 20

export function outcomeFor(
  mode: TurnSandboxMode,
  check: SandboxCheck
): SandboxOutcome {
  if (check.kind === "hard") return "deny"
  if (check.kind === "safe" || mode === "bypass") return "allow"
  if (check.kind === "routine") return mode === "manual" ? "ask" : "allow"
  return mode === "autonomous" ? "deny" : "ask"
}

function denialText(
  check: SandboxCheck,
  reason: string,
  stop: boolean
): string {
  const base =
    check.kind === "hard"
      ? `Blocked: this ${reason}, which Lor never runs in its sandbox. Don't retry it or a variant.`
      : `This command was blocked as potentially dangerous: it ${reason}. Don't retry it or a variant. Find a safer way, or finish and report what you couldn't do.`
  return stop
    ? `${base} Several calls were blocked in this turn: stop now, finish, and report what you could not do.`
    : base
}

export function sandboxToolApproval(input: {
  mode: TurnSandboxMode
  policy: PolicyContext
  context?: SandboxTurnContext
  classifier?: SandboxClassifier
  // Only fixed evidence reads use it (classifierFacts).
  sandbox?: Pick<SandboxSession, "run">
  signal?: AbortSignal
}): SandboxApproval {
  const askReasons = new Map<string, string>()
  const recentCalls = [...(input.context?.recentCalls ?? [])].slice(-6)
  const denials = [...(input.context?.denials ?? [])].slice(-20)
  const allowed = new Map<string, ClassifierVerdict>()
  let consecutiveDenials = input.context?.consecutiveDenials ?? 0
  let totalDenials = input.context?.totalDenials ?? 0

  const observe = (toolName: string, args: unknown) => {
    recentCalls.push({
      toolName,
      subject: callSubject(toolName, args, input.policy.workDir).slice(
        0,
        1_000
      ),
    })
    if (recentCalls.length > 6) recentCalls.shift()
  }

  const classify = async (
    call: Parameters<PiBuiltinToolApproval>[0],
    subject: string,
    reason: string,
    parsed: ParsedShell | null
  ) => {
    try {
      if (!input.classifier) throw new Error("Classifier unavailable")
      const content = stringArg(
        call.input,
        call.toolName === "write" ? "content" : "new_string"
      )
      const oldContent = stringArg(call.input, "old_string")
      const request = input.context?.request ?? ""
      const subcommands =
        call.toolName === "bash" ? (parsed?.commands ?? null) : undefined
      const context: ClassifierInput = {
        toolCallId: call.toolCallId,
        call: {
          toolName: call.toolName,
          subject: subject.slice(0, CLASSIFIER_TEXT_LIMIT),
          ...(call.toolName === "bash"
            ? { subcommands: subcommands ?? [] }
            : {
                content: content.slice(0, CLASSIFIER_TEXT_LIMIT),
                oldContent: oldContent.slice(0, CLASSIFIER_TEXT_LIMIT),
              }),
          flagReason: reason,
        },
        workDir: input.policy.workDir,
        request: request.slice(0, CLASSIFIER_TEXT_LIMIT),
        recentCalls: [...recentCalls],
        denials: [...denials],
        autonomous: input.mode === "autonomous",
        incomplete:
          !request.trim() ||
          subcommands === null ||
          [subject, content, oldContent, request].some(
            (text) => text.length > CLASSIFIER_TEXT_LIMIT
          ),
      }
      if (!context.incomplete) {
        Object.assign(
          context,
          await classifierFacts(
            context,
            parsed?.plain ?? false,
            input.sandbox,
            input.signal
          )
        )
      }
      if (JSON.stringify(context).length > 48_000) context.incomplete = true
      // Evidence and denial history are also part of the key: a changed file
      // or a later refusal invalidates an earlier allow, even within a turn.
      // Recent calls are not: every decided call changes them.
      const {
        toolCallId: _toolCallId,
        recentCalls: _recentCalls,
        ...cacheInput
      } = context
      const key = createHash("sha256")
        .update(JSON.stringify(cacheInput))
        .digest("hex")
      const cached = allowed.get(key)
      if (cached) return cached
      const verdict = await input.classifier.classify(context, input.signal)
      input.signal?.throwIfAborted()
      if (verdict.allow) {
        if (allowed.size >= 64) allowed.clear()
        allowed.set(key, verdict)
      }
      return verdict
    } catch {
      input.signal?.throwIfAborted()
      return {
        allow: false,
        reason: "could not be fully checked by the safety classifier",
      }
    }
  }

  const decide = async (call: Parameters<PiBuiltinToolApproval>[0]) => {
    input.signal?.throwIfAborted()
    if (call.kind === "readonly") {
      consecutiveDenials = 0
      observe(call.toolName, call.input)
      return "allow" as const
    }
    const subject = callSubject(call.toolName, call.input, input.policy.workDir)
    const { check, parsed } =
      call.toolName === "bash"
        ? await checkCommand(subject, input.policy)
        : { check: checkFileWrite(subject, input.policy), parsed: null }
    let outcome = outcomeFor(input.mode, check)
    let reason = "reason" in check ? check.reason : "requires manual approval"
    if (
      check.kind === "flagged" &&
      (input.mode === "auto" || input.mode === "autonomous")
    ) {
      const verdict = await classify(call, subject, check.reason, parsed)
      input.signal?.throwIfAborted()
      outcome = verdict.allow
        ? "allow"
        : input.mode === "autonomous"
          ? "deny"
          : "ask"
      reason = `${check.reason}; safety check: ${verdict.reason}`
    }
    observe(call.toolName, call.input)
    if (outcome !== "deny") consecutiveDenials = 0
    if (outcome === "allow") return "allow" as const
    if (outcome === "ask") {
      askReasons.set(call.toolCallId, reason)
      return "ask" as const
    }
    consecutiveDenials++
    totalDenials++
    denials.push(`${call.toolName}: ${subject.slice(0, 1_000)} (${reason})`)
    if (denials.length > 20) denials.shift()
    return {
      type: "deny" as const,
      reason: denialText(
        check,
        reason,
        consecutiveDenials >= MAX_CONSECUTIVE_DENIALS ||
          totalDenials >= MAX_TOTAL_DENIALS
      ),
    }
  }

  return {
    decide: (call): Promise<PiBuiltinToolDecision> => decide(call),
    askReason: (toolCallId) => askReasons.get(toolCallId),
    observe,
    snapshot: () => ({
      request: input.context?.request ?? "",
      recentCalls: [...recentCalls],
      denials: [...denials],
      consecutiveDenials,
      totalDenials,
    }),
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

// The approval card's line for a prompt from Claude Code's own permission
// mode: Pi's wording for the tools both have. ExitPlanMode's input carries
// the plan, which the card shows.
export function claudeCodeAskDescription(
  toolName: string,
  input: unknown
): string {
  const url = stringArg(input, "url")
  const query = stringArg(input, "query")
  const notebook = stringArg(input, "notebook_path")
  switch (toolName) {
    case "ExitPlanMode":
      return "Start working on this plan"
    case "WebFetch":
      return url ? `Fetch ${url}` : "Fetch a page"
    case "webSearch":
      return query ? `Search the web for “${query}”` : "Search the web"
    case "NotebookEdit":
      return notebook ? `Edit ${notebook}` : "Edit a notebook"
    default:
      return sandboxAskDescription(toolName, input, undefined)
  }
}
