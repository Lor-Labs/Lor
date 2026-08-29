import type { AgentRunContextTask } from "@repo/db/schema"
import { generateText, type ModelMessage, pruneMessages } from "ai"
import { logger } from "./logger"
import { merlinSmallModel, smallGatewayOptions } from "./models"
import { taskStateSection } from "./tasks"
import type { OnUsage, UsageEvent } from "./usage"

// Compaction is a projection, not a deletion: `agent_run_step` keeps the whole
// transcript forever and only what gets SENT is reduced. One compaction
// produces:
//
//   [original ask] [working notes] [verbatim recent tail] [authoritative state]
//
// The notes carry what old tool calls found; the tail keeps the immediate
// working set intact; state (the task's live plan) is reconstructed from the
// database rather than trusted to prose.

// Verbatim tail target. The split lands on the nearest complete tool round at
// or before this, so the number is a floor on what survives, not exact.
const TAIL_TARGET_TOKENS = 60_000
// Never summarize away so much that the tail is the whole conversation.
const MIN_MESSAGES_TO_SUMMARIZE = 4
// Per tool result when rendering the summarizer's digest. Enough to carry
// identifiers and shape; the point is what was learned, not the rows.
const TOOL_RESULT_DIGEST_CHARS = 4_000
const MAX_DIGEST_CHARS = 120_000
const MAX_SUMMARY_CHARS = 12_000
// After this many summarizer failures, stop paying for retries and let the
// plain prune carry the run.
const MAX_SUMMARY_FAILURES = 3
const CHARS_PER_TOKEN = 4

const SUMMARY_INSTRUCTION = `You are keeping the working notes for an agent midway through a task. Its older tool calls are about to leave its context, so these notes are the ONLY thing it will retain about them.

Write what it needs to continue without redoing work. Preserve VERBATIM and in full:
- every identifier it will need again: ids, project/database/table/column names, branch names, urls, file paths, filenames
- exact queries, commands, or search terms that worked (and ones that failed, with why)
- concrete findings: counts, totals, names of things discovered, decisions reached
- what has been produced so far (files, links, messages sent) and what remains to be done

Rules:
- Facts only. No preamble, no "the agent then...", no restating the task.
- Never generalize away a specific value. "2,553 policies" not "several thousand"; "client_id a37328ef-..." not "the client id".
- If earlier notes are provided, merge them with the new activity into one current set; keep what still matters, drop what has been superseded.
- Group under short headings. Be dense.`

export type CompactionState = {
  summary: string | null
  summaryFailures: number
}

export function newCompactionState(): CompactionState {
  return { summary: null, summaryFailures: 0 }
}

// Marks the injected notes so a later compaction can find and replace them.
// The AI SDK carries a prepareStep `messages` override forward into subsequent
// steps, so the compacted array becomes the new baseline — "what is already
// summarized" has to be read off the array itself, never from an index
// remembered against the pre-compaction one.
const SUMMARY_MARKER = "[Your working notes from earlier in this task."

export function isSummaryMessage(message: ModelMessage): boolean {
  return (
    message.role === "user" &&
    typeof message.content === "string" &&
    message.content.startsWith(SUMMARY_MARKER)
  )
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

type Part = Record<string, unknown>

function partsOf(content: unknown): Part[] {
  return Array.isArray(content) ? (content as Part[]) : []
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content
  return partsOf(content)
    .map((p) => {
      if (p.type === "text" && typeof p.text === "string") return p.text
      if (p.type === "image") return "[image]"
      if (p.type === "tool-call") {
        return `→ ${String(p.toolName)}(${JSON.stringify(p.input ?? p.args ?? {})})`
      }
      if (p.type === "tool-result") {
        const out = JSON.stringify(p.output ?? p.result ?? null) ?? ""
        const clipped =
          out.length > TOOL_RESULT_DIGEST_CHARS
            ? `${out.slice(0, TOOL_RESULT_DIGEST_CHARS)}…[truncated]`
            : out
        return `← ${String(p.toolName)}: ${clipped}`
      }
      return ""
    })
    .filter(Boolean)
    .join("\n")
}

function messageTokens(message: ModelMessage): number {
  return estimateTokens(
    typeof message.content === "string"
      ? message.content
      : JSON.stringify(message.content)
  )
}

// Rough size of a message array, for callers that must decide whether to
// compact before any real usage figure exists (a continued run's first step).
export function estimateMessagesTokens(messages: ModelMessage[]): number {
  return messages.reduce((sum, m) => sum + messageTokens(m), 0)
}

// A split is only valid where every tool call before it already has its result
// before it too. Cutting between a tool call and its result leaves an orphaned
// call, which providers reject outright.
export function isSafeSplit(messages: ModelMessage[], index: number): boolean {
  const called = new Set<string>()
  const resolved = new Set<string>()
  for (const message of messages.slice(0, index)) {
    for (const part of partsOf(message.content)) {
      const id = typeof part.toolCallId === "string" ? part.toolCallId : null
      if (!id) continue
      if (part.type === "tool-call") called.add(id)
      if (part.type === "tool-result") resolved.add(id)
    }
  }
  for (const id of called) {
    if (!resolved.has(id)) return false
  }
  return true
}

// Walk back from the end until the tail is big enough, then slide to the
// nearest safe split. Index 0 (the original ask) always stays at the head, so
// the split never goes below 1.
export function chooseSplit(
  messages: ModelMessage[],
  tailTargetTokens = TAIL_TARGET_TOKENS
): number {
  let tokens = 0
  let index = messages.length
  while (index > 1 && tokens < tailTargetTokens) {
    index--
    tokens += messageTokens(messages[index] as ModelMessage)
  }
  while (index > 1 && !isSafeSplit(messages, index)) index--
  return index
}

// Flatten the messages being dropped into something the small model can read.
export function renderForSummary(messages: ModelMessage[]): string {
  const rendered = messages
    .map((m) => {
      const body = textOf(m.content)
      return body ? `[${m.role}]\n${body}` : ""
    })
    .filter(Boolean)
    .join("\n\n")
  // Oldest content is most likely already covered by the previous notes, so
  // clip from the front when the digest is oversized.
  return rendered.length > MAX_DIGEST_CHARS
    ? `…[earlier activity truncated]\n${rendered.slice(-MAX_DIGEST_CHARS)}`
    : rendered
}

function emitUsage(onUsage: OnUsage | undefined, event: UsageEvent) {
  try {
    onUsage?.(event)
  } catch {
    // metering is best-effort and must never cost us the summary
  }
}

// Roll previous notes plus newly-dropped activity into one set. Returns null on
// failure so the caller falls back to a plain prune — lossy, but never fails
// the run. One turn, no tools.
export async function summarizeWorkingState(args: {
  workspaceId: string
  previousSummary: string | null
  messages: ModelMessage[]
  onUsage?: OnUsage
}): Promise<string | null> {
  const digest = renderForSummary(args.messages)
  if (!digest.trim()) return args.previousSummary
  try {
    const result = await generateText({
      model: merlinSmallModel,
      reasoning: "low",
      instructions: SUMMARY_INSTRUCTION,
      prompt: args.previousSummary
        ? `Current notes:\n${args.previousSummary}\n\n---\nNew activity since those notes:\n${digest}`
        : `Activity to write notes for:\n${digest}`,
      providerOptions: { gateway: smallGatewayOptions },
    })
    emitUsage(args.onUsage, {
      workspaceId: args.workspaceId,
      tool: "merlin.compact",
      model: result.response.modelId,
      inputTokens: result.usage.inputTokens,
      cachedInputTokens: result.usage.inputTokenDetails.cacheReadTokens,
      outputTokens: result.usage.outputTokens,
    })
    const text = result.text.trim()
    if (!text) return args.previousSummary
    return text.length > MAX_SUMMARY_CHARS
      ? text.slice(0, MAX_SUMMARY_CHARS)
      : text
  } catch (err) {
    logger.warn({ err }, "Compaction summary failed; falling back to prune")
    return null
  }
}

export function summaryMessage(summary: string): ModelMessage {
  return {
    role: "user",
    content: `${SUMMARY_MARKER} The tool calls behind them are no longer in your context, so treat these as the record of what you already did — don't redo that work. The full transcript is preserved outside your context if someone needs it.]\n\n${summary}`,
  }
}

// Authoritative state, rebuilt from the database rather than trusted to prose.
// A summary can quietly drop a plan item; the task row cannot.
function stateMessages(task: AgentRunContextTask | undefined): ModelMessage[] {
  if (!task) return []
  return [
    {
      role: "user",
      content: `[Current task state, restored after compaction — this is authoritative and overrides anything in the notes above.]\n${taskStateSection(task)}`,
    },
  ]
}

// Tool pairing must hold for the assembled result too, or the request is
// rejected. Cheap insurance against a bad split.
function toolPairingHolds(messages: ModelMessage[]): boolean {
  return isSafeSplit(messages, messages.length)
}

// Reduce what gets SENT. The caller decides WHEN (see prepareStep's
// MERLIN_COMPACT_INPUT_TOKENS check) so the trigger stays visible at the call
// site; this only decides HOW. Returns the messages unchanged if the reduced
// version fails validation — never throws, never fails the run.
export async function compact(args: {
  messages: ModelMessage[]
  state: CompactionState
  workspaceId: string
  task?: AgentRunContextTask
  onUsage?: OnUsage
  tailTargetTokens?: number
}): Promise<ModelMessage[]> {
  const { messages, state } = args
  // Structural reduction first (drops old tool payloads, keeps pairing valid).
  const pruned = pruneMessages({
    messages,
    toolCalls: "before-last-4-messages",
  })

  // The boundary: notes injected by an earlier compaction are still in this
  // array (overrides carry forward), so everything AFTER them is the activity
  // not yet summarized. Reading it off the array keeps this correct even
  // though compaction rewrites the array it is measuring.
  const notesIndex = messages.findIndex(isSummaryMessage)
  const unsummarizedFrom = notesIndex >= 0 ? notesIndex + 1 : 1
  // Never cut into or before the previous notes — that would drop the tail's
  // head or leave two sets of notes stacked in the context.
  const split = Math.max(
    unsummarizedFrom,
    chooseSplit(messages, args.tailTargetTokens)
  )
  const canSummarize =
    split - unsummarizedFrom >= MIN_MESSAGES_TO_SUMMARIZE &&
    state.summaryFailures < MAX_SUMMARY_FAILURES
  if (canSummarize) {
    // Only what has been added since the last compaction, so a long run pays
    // for each stretch of activity once.
    const summary = await summarizeWorkingState({
      workspaceId: args.workspaceId,
      previousSummary: state.summary,
      messages: messages.slice(unsummarizedFrom, split),
      onUsage: args.onUsage,
    })
    if (summary) {
      state.summary = summary
      state.summaryFailures = 0
    } else {
      state.summaryFailures++
    }
  }
  if (!state.summary) return pruned

  // Head stays byte-identical so instructions + the original ask survive in the
  // provider's prompt cache across compaction. The old notes message is not
  // carried over — the fresh one supersedes it.
  const assembled: ModelMessage[] = [
    ...messages.slice(0, 1),
    summaryMessage(state.summary),
    ...messages.slice(split),
    ...stateMessages(args.task),
  ]
  if (!toolPairingHolds(assembled)) {
    logger.warn(
      { split, count: assembled.length },
      "Compaction produced unpaired tool calls; using plain prune"
    )
    return pruned
  }
  return assembled
}
