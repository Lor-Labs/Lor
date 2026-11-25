import { createHash } from "node:crypto"
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all"
import {
  and,
  asc,
  db,
  desc,
  eq,
  ilike,
  isNotNull,
  lt,
  schema,
  sql,
} from "@repo/db"
import { loadConversation } from "@repo/db/queries/agent-conversations"
import { chatFeedMessage } from "@repo/db/queries/agent-sessions"
import type { AgentStepKind, AgentStepMessage } from "@repo/db/schema"
import {
  generateText,
  isStepCount,
  type LanguageModel,
  type ModelMessage,
  type ToolApprovalResponse,
  type ToolApprovalStatus,
  type ToolResultPart,
  type ToolSet,
  tool,
} from "ai"
import { z } from "zod"
import { addJournalEntry } from "./agent-memory"
import { aiRuntimeContext, aiTelemetry } from "./ai-observability"
import type { RunAgentContext } from "./channel-agent"
import {
  applyFactChanges,
  factsForMemoryPass,
  loadAgentFacts,
  memoryPassRequest,
  parseFactChanges,
} from "./channel-profile"
import { logger } from "./logger"
import { lorGatewayModel, withInferenceGuard } from "./models"
import type {
  PendingApproval,
  RunHandle,
  RunStepRecord,
  RunStopCause,
} from "./run"
import { stableStringify } from "./tool-guard"
import { formatSpeakerLine } from "./transcript"
import type { OnUsage } from "./usage"

// The channel agent's own loop (reference/always-on-agents.md §4, §8). Lor
// stores every model message as a step and builds the prompt from them: the
// system prompt frozen per epoch, then the epoch's steps in order, so the
// prompt only grows at the end and the provider's cache holds. No sandbox.
// Compaction starts a new epoch from a summary; old steps stay readable.

export { CHANNEL_AGENT_DEFAULT_MODEL as AGENT_DEFAULT_MODEL } from "@repo/utils/inference"
// Compaction: once a turn ends above this prompt size and the conversation
// stays idle, summarize it while the cache is still warm.
export const COMPACT_AT_TOKENS = 100_000
export const COMPACT_IDLE_MS = 10 * 60_000
// A single turn that fills this share of the window compacts in place.
const COMPACT_IN_TURN_SHARE = 0.8
const DEFAULT_CONTEXT_WINDOW = 200_000
const RECENT_CHAT_MESSAGES = 30
const STEP_TEXT_PART_CHARS = 4_000
const HISTORY_RESULT_CHARS = 60_000

const LIMIT_REASON =
  "Not run: this turn is close to its time or spend limit. Do not call more tools. End the turn, and use send_message to say what is left undone if someone is waiting."
const NO_DECISION_REASON =
  "No decision was recorded for this action, so it was not run."
const TOOL_GONE_REASON =
  "This tool is no longer available under the same approval rule, so it was not run."
const INPUT_CHANGED_REASON =
  "The approved input does not match this call, so it was not run."

const SUMMARY_HEADER =
  "[Your conversation so far was summarized to keep it short. Everything before this point is stored: read_agent_history reads it word for word.]"
const SUMMARY_REQUEST = `Summarize this conversation inside <summary></summary> tags. It will continue in a new context window from this summary alone, so include what is needed to carry on without redoing work or being given constraints again. Preserve: (1) problems that came up and how they were handled; (2) options raised, tried or set aside, and why; (3) everything people asked for, decided, agreed, ruled out or stated as a preference or boundary, stated exactly; (4) where things stand now; (5) what is still open, promised or expected next, including anything you said you would follow up on; (6) details that would be hard to find again: names, numbers, dates, message ids, links and exact wording. Keep what people said close to their own words; condense your own reasoning to what it concluded. The latest chat messages are added after the summary word for word, so you need not repeat them. Do not call any tools while writing this summary; respond with text only.`

export type AgentTurnArgs = {
  workspaceId: string
  conversationId: string
  agent: RunAgentContext
  run: RunHandle
  model: string
  languageModel?: LanguageModel
  byok?: boolean
  // The system prompt this turn would build fresh. The epoch keeps the one
  // its first turn built until the next compaction.
  instructions: string
  tools: ToolSet
  toolsContext: Record<string, unknown>
  // Tools that wait for a person's approval under the workspace's rules.
  approval: Record<string, ToolApprovalStatus>
  targetFor: (toolName: string) => string | null
  describe: (toolName: string, input: unknown) => string
  onUsage?: OnUsage
}

export type AgentTurnResult = {
  // The agent's own last words: private notes, never posted.
  text: string
  messages: ModelMessage[]
  stoppedFor?: RunStopCause
  approvals: PendingApproval[]
  promptTokens: number
  sentMessages: number
}

type StoredStep = {
  id: string
  seq: number
  epoch: number
  runId: string | null
  kind: AgentStepKind
  message: AgentStepMessage
}

type Part = Record<string, unknown>

function partsOf(message: AgentStepMessage): Part[] {
  return Array.isArray(message.content) ? (message.content as Part[]) : []
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…[truncated]` : text
}

function json(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ""
  } catch {
    return String(value)
  }
}

// Plain text of a step, for search and read-back. Reasoning is left out.
export function stepText(
  message: AgentStepMessage,
  partChars = STEP_TEXT_PART_CHARS
): string {
  if (typeof message.content === "string") return message.content
  return partsOf(message)
    .map((part) => {
      switch (part.type) {
        case "text":
          return typeof part.text === "string" ? part.text : ""
        case "tool-call":
          return `→ ${String(part.toolName)} ${clip(json(part.input), partChars)}`
        case "tool-result":
          return `← ${String(part.toolName)}: ${clip(json(part.output), partChars)}`
        case "tool-approval-request":
          return "(waiting for a person's approval)"
        case "tool-approval-response":
          return part.approved
            ? "(approved)"
            : `(not approved${typeof part.reason === "string" ? `: ${part.reason}` : ""})`
        default:
          return ""
      }
    })
    .filter(Boolean)
    .join("\n")
}

function kindOf(message: ModelMessage): AgentStepKind {
  return message.role === "assistant" ? "model" : "tools"
}

export function contextWindowOf(model: string): number {
  return (
    getBuiltinModels("vercel-ai-gateway").find((entry) => entry.id === model)
      ?.contextWindow ?? DEFAULT_CONTEXT_WINDOW
  )
}

export async function loadAgentContext(
  workspaceId: string,
  conversationId: string
) {
  await db
    .insert(schema.agentContext)
    .values({ conversationId, workspaceId })
    .onConflictDoNothing()
  const [row] = await db
    .select()
    .from(schema.agentContext)
    .where(eq(schema.agentContext.conversationId, conversationId))
  if (!row) throw new Error("Channel agent context missing")
  return row
}

async function loadEpochSteps(
  conversationId: string,
  epoch: number
): Promise<StoredStep[]> {
  return db
    .select({
      id: schema.agentStep.id,
      seq: schema.agentStep.seq,
      epoch: schema.agentStep.epoch,
      runId: schema.agentStep.runId,
      kind: schema.agentStep.kind,
      message: schema.agentStep.message,
    })
    .from(schema.agentStep)
    .where(
      and(
        eq(schema.agentStep.conversationId, conversationId),
        eq(schema.agentStep.epoch, epoch)
      )
    )
    .orderBy(asc(schema.agentStep.seq))
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// Appends steps after the channel's last one. Only the run holding the
// channel's scope writes, and the (channel, seq) unique index refuses a
// second writer.
export async function appendSteps(
  tx: Tx | typeof db,
  args: {
    workspaceId: string
    conversationId: string
    epoch: number
    runId: string | null
    steps: { kind: AgentStepKind; message: AgentStepMessage }[]
  }
): Promise<void> {
  if (args.steps.length === 0) return
  const [last] = await tx
    .select({ seq: sql<number>`coalesce(max(${schema.agentStep.seq}), -1)` })
    .from(schema.agentStep)
    .where(eq(schema.agentStep.conversationId, args.conversationId))
  const base = Number(last?.seq ?? -1) + 1
  await tx.insert(schema.agentStep).values(
    args.steps.map((step, index) => ({
      workspaceId: args.workspaceId,
      conversationId: args.conversationId,
      epoch: args.epoch,
      seq: base + index,
      runId: args.runId,
      kind: step.kind,
      message: step.message,
      text: stepText(step.message),
    }))
  )
}

// The approval requests the last model step left open, with the calls they
// hold. A step that also ran another tool stores that result in a following
// tools message, so answers and results are read from everything after it.
function openApprovals(steps: StoredStep[]) {
  let at = steps.length - 1
  while (at >= 0 && steps[at]?.kind !== "model") at--
  const step = steps[at]
  if (!step) return []
  const later = steps.slice(at + 1).flatMap((next) => partsOf(next.message))
  const answered = new Set(
    later
      .filter((part) => part.type === "tool-approval-response")
      .map((part) => String(part.approvalId))
  )
  const done = new Set(
    later
      .filter((part) => part.type === "tool-result")
      .map((part) => String(part.toolCallId))
  )
  return openRequests(step).filter(
    (request) =>
      !answered.has(request.approvalId) && !done.has(request.toolCallId)
  )
}

function openRequests(step: StoredStep) {
  const parts = partsOf(step.message)
  const calls = new Map(
    parts
      .filter((part) => part.type === "tool-call")
      .map((part) => [String(part.toolCallId), part])
  )
  return parts
    .filter((part) => part.type === "tool-approval-request")
    .map((part) => {
      const call = calls.get(String(part.toolCallId))
      return {
        approvalId: String(part.approvalId),
        toolCallId: String(part.toolCallId),
        toolName: String(call?.toolName ?? ""),
        input: call?.input,
      }
    })
}

// The run whose turn waits on approvals, when the conversation's last step
// is one that asked for them.
export async function pausedAgentRun(conversationId: string): Promise<{
  runId: string
  epoch: number
} | null> {
  const recent = await db
    .select({
      id: schema.agentStep.id,
      seq: schema.agentStep.seq,
      epoch: schema.agentStep.epoch,
      runId: schema.agentStep.runId,
      kind: schema.agentStep.kind,
      message: schema.agentStep.message,
    })
    .from(schema.agentStep)
    .where(eq(schema.agentStep.conversationId, conversationId))
    .orderBy(desc(schema.agentStep.seq))
    .limit(4)
  const last = recent[0]
  if (!last?.runId || openApprovals(recent.reverse()).length === 0) return null
  return { runId: last.runId, epoch: last.epoch }
}

// What a person sees in a newest message: the time, then the inbox.
export function turnHeader(now: Date): string {
  const when = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now)
  return `[${when} UTC]`
}

function requestOptions(promptTokens: number, message: ModelMessage) {
  // Large conversations keep the cache an hour, so compaction after an idle
  // stretch still reads it warm.
  if (promptTokens < COMPACT_AT_TOKENS) return message
  return {
    ...message,
    providerOptions: {
      ...message.providerOptions,
      anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
    },
  } as ModelMessage
}

function withLongCache(
  messages: ModelMessage[],
  promptTokens: number
): ModelMessage[] {
  const last = messages.at(-1)
  if (!last) return messages
  return [...messages.slice(0, -1), requestOptions(promptTokens, last)]
}

// One provider per conversation: the prompt cache and reasoning signatures
// both live with the provider that wrote them. The gateway's session
// affinity puts a session's last provider ahead of `order`; without our own
// session id it fingerprints the prompt's opening and pinned every channel
// agent to one provider. One id per conversation (channel and epoch), shared
// by its turns, memory passes and compaction, also pins the exact credential.
function gatewayOptions(model: string, conversation: string) {
  return {
    gateway: {
      caching: "auto" as const,
      sessionId: conversation,
      ...(model.startsWith("anthropic/") ? { order: ["anthropic"] } : {}),
    },
  }
}

function gatewaySession(conversationId: string, epoch: number): string {
  return `lor-agent-${conversationId}-${epoch}`
}

// Reasoning signed under an earlier tool set or model is dropped from the
// front of the history, which the provider accepts; the rest replays as is.
function promptMessages(
  steps: StoredStep[],
  cutSeq: number | null
): ModelMessage[] {
  return steps.map((step) => {
    if (cutSeq === null || step.seq > cutSeq || step.kind !== "model") {
      return step.message as ModelMessage
    }
    const parts = partsOf(step.message).filter(
      (part) => part.type !== "reasoning"
    )
    return { ...step.message, content: parts } as ModelMessage
  })
}

function gatewayCostOf(metadata: unknown): number | undefined {
  const cost = (metadata as { gateway?: { cost?: unknown } } | undefined)
    ?.gateway?.cost
  const usd =
    typeof cost === "string" || typeof cost === "number"
      ? Number(cost)
      : Number.NaN
  return Number.isFinite(usd) ? usd : undefined
}

function stepUsage(
  model: string,
  result: {
    usage: {
      inputTokens: number | undefined
      outputTokens: number | undefined
      inputTokenDetails: { cacheReadTokens: number | undefined }
      outputTokenDetails: { reasoningTokens: number | undefined }
    }
    providerMetadata?: unknown
  }
): RunStepRecord & { reasoningTokens: number } {
  return {
    model,
    inputTokens: result.usage.inputTokens ?? 0,
    cachedInputTokens: result.usage.inputTokenDetails.cacheReadTokens ?? 0,
    outputTokens: result.usage.outputTokens ?? 0,
    reasoningTokens: result.usage.outputTokenDetails.reasoningTokens ?? 0,
    gatewayCostUsd: gatewayCostOf(result.providerMetadata),
  }
}

// Usage summed per attempt and charged once at the end, like a Pi turn.
export function usageLedger(args: {
  workspaceId: string
  runId: string
  model: string
  languageModel?: LanguageModel
  byok?: boolean
  // Names the charge in its billing key ("agent", "compact").
  label: string
  onUsage?: OnUsage
}) {
  const total = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  }
  let costUsd: number | null = 0
  let charged = false
  const started = performance.now()
  return {
    add(usage: RunStepRecord & { reasoningTokens: number }, usd?: number) {
      total.inputTokens += usage.inputTokens
      total.cachedInputTokens += usage.cachedInputTokens
      total.outputTokens += usage.outputTokens
      total.reasoningTokens += usage.reasoningTokens
      costUsd = usd === undefined || costUsd === null ? null : costUsd + usd
    },
    charge(toolCalls: number) {
      if (charged) return
      charged = true
      if (total.inputTokens === 0 && total.outputTokens === 0) return
      args.onUsage?.({
        workspaceId: args.workspaceId,
        // Billed like any Lor turn.
        tool: "lor.respond",
        model: args.model,
        requestedModel: args.model,
        byok: args.byok,
        ...total,
        ...(costUsd !== null ? { costUsd } : {}),
        wallMs: Math.round(performance.now() - started),
        toolCalls,
        billingKey: `${args.runId}:${args.label}:${args.model}`,
      })
    },
  }
}

function awaitingApprovedResults(messages: ModelMessage[]): boolean {
  const last = messages.at(-1)
  return (
    last?.role === "tool" &&
    Array.isArray(last.content) &&
    last.content.some((part) => part.type === "tool-approval-response")
  )
}

// Sends that ran: each result is in the response messages once. A denied
// call has no result.
function sentIn(messages: ModelMessage[]): number {
  return messages
    .flatMap((message) => (message.role === "tool" ? message.content : []))
    .filter(
      (part) =>
        part.type === "tool-result" &&
        part.toolName === "send_message" &&
        part.output.type === "json" &&
        (part.output.value as { ok?: unknown } | null)?.ok === true
    ).length
}

// The results of approved calls that ran before an aborted model call. The
// approval answers for calls that did not run are repeated after them, so
// only those run on a retry; the SDK reads answers from the last message.
function approvedResultsCheckpoint(
  messages: ModelMessage[],
  ran: ToolResultPart[]
): ModelMessage {
  const ranIds = new Set(ran.map((part) => part.toolCallId))
  const callOf = new Map(
    messages.flatMap((message) =>
      message.role === "assistant" && Array.isArray(message.content)
        ? message.content.flatMap((part) =>
            part.type === "tool-approval-request"
              ? [[part.approvalId, part.toolCallId] as const]
              : []
          )
        : []
    )
  )
  const last = messages.at(-1)
  const notRun =
    last?.role === "tool"
      ? last.content.filter(
          (part) =>
            part.type === "tool-approval-response" &&
            !ranIds.has(callOf.get(part.approvalId) ?? "")
        )
      : []
  return { role: "tool", content: [...notRun, ...ran] }
}

function lastAssistantText(messages: ModelMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.role !== "assistant") continue
    if (typeof message.content === "string") return message.content
    const text = message.content
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("")
    if (text.trim()) return text
  }
  return ""
}

// One turn: from the run's inbox step, or the decisions on a paused turn,
// to the model's last reply. Each model call and its tool results are saved
// before the next call, so a retried attempt continues from the last saved
// step.
export async function runAgentTurn(
  args: AgentTurnArgs
): Promise<AgentTurnResult> {
  const { run, conversationId, workspaceId } = args
  const ledger = usageLedger({
    workspaceId,
    runId: run.runId,
    model: args.model,
    label: "agent",
    onUsage: args.onUsage,
    byok: args.byok,
  })
  let toolCalls = 0
  try {
    return await turnLoop(args, ledger, (n) => {
      toolCalls += n
    })
  } finally {
    ledger.charge(toolCalls)
    if (toolCalls > 0) {
      await db
        .update(schema.agentRun)
        .set({ toolCalls: sql`${schema.agentRun.toolCalls} + ${toolCalls}` })
        .where(eq(schema.agentRun.id, run.runId))
        .catch(() => {})
    }
    logger.info(
      { conversationId, runId: run.runId, toolCalls },
      "Agent turn ended"
    )
  }
}

async function turnLoop(
  args: AgentTurnArgs,
  ledger: ReturnType<typeof usageLedger>,
  countToolCalls: (n: number) => void
): Promise<AgentTurnResult> {
  const { run, conversationId, workspaceId, agent } = args
  let context = await loadAgentContext(workspaceId, conversationId)

  // The prompt's top is the epoch's: built by its first turn, then frozen.
  const toolsHash = sha256(
    json(
      Object.entries(args.tools)
        .map(([name, t]) => [name, (t as { description?: string }).description])
        .sort()
    )
  )
  const freeze = async () => {
    await db
      .update(schema.agentContext)
      .set({ system: args.instructions, toolsHash, model: args.model })
      .where(
        and(
          eq(schema.agentContext.conversationId, conversationId),
          eq(schema.agentContext.epoch, context.epoch)
        )
      )
    context = {
      ...context,
      system: args.instructions,
      toolsHash,
      model: args.model,
    }
  }
  if (context.system === null) await freeze()
  else if (context.toolsHash !== toolsHash || context.model !== args.model) {
    logger.warn(
      {
        conversationId,
        toolsChanged: context.toolsHash !== toolsHash,
        modelChanged: context.model !== args.model,
      },
      "Agent tools or model changed within an epoch; the cache misses once"
    )
    const [last] = await db
      .select({ seq: sql<number>`coalesce(max(${schema.agentStep.seq}), -1)` })
      .from(schema.agentStep)
      .where(eq(schema.agentStep.conversationId, conversationId))
    const reasoningCutSeq = Number(last?.seq ?? -1)
    await db
      .update(schema.agentContext)
      .set({ toolsHash, model: args.model, reasoningCutSeq })
      .where(eq(schema.agentContext.conversationId, conversationId))
    context = { ...context, toolsHash, model: args.model, reasoningCutSeq }
  }

  let steps = await loadEpochSteps(conversationId, context.epoch)
  const save = async (messages: ModelMessage[]) => {
    await appendSteps(db, {
      workspaceId,
      conversationId,
      epoch: context.epoch,
      runId: run.runId,
      steps: messages.map((message) => ({
        kind: kindOf(message),
        message: message as AgentStepMessage,
      })),
    })
  }

  const pendingApproval = (request: {
    approvalId: string
    toolCallId: string
    toolName: string
    input: unknown
    reason: string | null
  }): PendingApproval => {
    const asked =
      request.toolName === "request_approval"
        ? (request.input as { action?: unknown; description?: unknown })
        : null
    const target = asked ? null : args.targetFor(request.toolName)
    return {
      harnessApprovalId: request.approvalId,
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      kind: asked ? "request" : "policy",
      target,
      action:
        typeof asked?.action === "string"
          ? asked.action
          : (target ?? request.toolName),
      description:
        typeof asked?.description === "string"
          ? asked.description
          : args.describe(request.toolName, request.input),
      reason: request.reason,
      payload: request.input,
      inputSha256: sha256(stableStringify(request.input)),
    }
  }

  // A paused turn finishes first: one decision per open approval.
  const open = openApprovals(steps)
  const pausedRunId =
    open.length > 0
      ? [...steps].reverse().find((step) => step.kind === "model")?.runId
      : undefined
  const decisions =
    pausedRunId && agent.loadDecisions
      ? await agent.loadDecisions(pausedRunId)
      : []
  // An earlier attempt of this run saved the requests but stopped before
  // filing their approvals: file them now rather than deny them unseen. A
  // stopped run files nothing.
  const unfiled =
    pausedRunId === run.runId &&
    decisions.length === 0 &&
    !run.stopRequested?.()
      ? open.map((request) => pendingApproval({ ...request, reason: null }))
      : []
  if (open.length > 0 && unfiled.length === 0) {
    const responses = open.map((request): ToolApprovalResponse => {
      const decision = decisions.find(
        (d) => d.harnessApprovalId === request.approvalId
      )
      const deny = (reason: string): ToolApprovalResponse => ({
        type: "tool-approval-response",
        approvalId: request.approvalId,
        approved: false,
        reason,
      })
      if (!decision) return deny(NO_DECISION_REASON)
      if (!decision.approved) return deny(decision.reason)
      const stillBound =
        Object.hasOwn(args.tools, request.toolName) &&
        (decision.kind !== "policy" ||
          args.targetFor(request.toolName) === decision.target)
      if (!stillBound) return deny(TOOL_GONE_REASON)
      // Key order is not kept by jsonb, so inputs hash in canonical form.
      if (decision.inputSha256 !== sha256(stableStringify(request.input))) {
        return deny(INPUT_CHANGED_REASON)
      }
      return {
        type: "tool-approval-response",
        approvalId: request.approvalId,
        approved: true,
      }
    })
    const decided: ModelMessage = { role: "tool", content: responses }
    await save([decided])
    steps = await loadEpochSteps(conversationId, context.epoch)
  }

  let messages = promptMessages(steps, context.reasoningCutSeq)
  // This turn's own messages, kept apart from the prompt, which compaction
  // replaces mid-turn.
  const before = messages.at(-1)
  const turnMessages: ModelMessage[] = []
  const window = contextWindowOf(args.model)
  let promptTokens = context.promptTokens
  // The standing cache check (always-on-agents.md §8, step 4.5): the first
  // call of a turn is expected warm only when the last turn ended within the
  // 5-minute lifetime (or the hour, above the compaction size); every later
  // call should read what the call before it sent.
  const lifetimeMs =
    promptTokens >= COMPACT_AT_TOKENS ? 55 * 60_000 : 4 * 60_000
  let expectWarm =
    context.lastTurnEndedAt !== null &&
    Date.now() - context.lastTurnEndedAt.getTime() < lifetimeMs
  let lastProvider: string | undefined
  const turnCache = { calls: 0, input: 0, cacheRead: 0, coldFirst: false }
  let sentMessages = 0
  let stoppedFor: RunStopCause | undefined =
    unfiled.length > 0 ? "awaiting_approval" : undefined
  const approvals: PendingApproval[] = [...unfiled]

  const ledgerSpend = { credits: 0 }
  const spendLimited = () =>
    Date.now() >= run.budgets.deadlineAt.getTime() - 3 * 60_000 ||
    ledgerSpend.credits >= run.budgets.credits * 0.9
  // Near a limit only one send_message still runs (under its usual approval
  // rule), so the agent can say what is left undone.
  let finalSendAllowed = true
  const toolApproval = ({ toolCall }: { toolCall: { toolName: string } }) => {
    if (!spendLimited()) return args.approval[toolCall.toolName]
    if (toolCall.toolName === "send_message" && finalSendAllowed) {
      finalSendAllowed = false
      return args.approval.send_message
    }
    return { type: "denied", reason: LIMIT_REASON } as const
  }

  // The last saved step decides where the turn is: a model reply with no
  // tool calls ended it, anything else continues.
  const finished = () => {
    const last = messages.at(-1)
    if (!last || last.role !== "assistant") return false
    if (typeof last.content === "string") return true
    return !last.content.some(
      (part) =>
        part.type === "tool-call" || part.type === "tool-approval-request"
    )
  }

  while (unfiled.length === 0 && !finished()) {
    if (run.stopRequested?.()) {
      stoppedFor = "stopped_by_user"
      break
    }
    if (Date.now() >= run.budgets.deadlineAt.getTime()) {
      stoppedFor = "budget_wall_clock"
      break
    }
    if (ledgerSpend.credits >= run.budgets.credits) {
      stoppedFor = "budget_spend"
      break
    }
    // A slow call must not outlive the turn's wall-clock budget.
    const deadline = AbortSignal.timeout(
      Math.max(0, run.budgets.deadlineAt.getTime() - Date.now())
    )
    const abortSignal = AbortSignal.any([
      ...(run.abortSignal ? [run.abortSignal] : []),
      deadline,
    ])
    // A lease loss or a user stop keeps its own handling.
    const rethrowUnlessDeadline = (err: unknown) => {
      if (!deadline.aborted || run.abortSignal?.aborted) throw err
    }
    // A turn that filled most of the window compacts before its next call,
    // but not while approved calls still wait for their results: the
    // provider needs those right after the decision.
    if (
      promptTokens >= window * COMPACT_IN_TURN_SHARE &&
      !awaitingApprovedResults(messages)
    ) {
      const compacted = await compactAgentConversation({
        workspaceId,
        conversationId,
        model: args.model,
        languageModel: args.languageModel,
        assertCanInfer: run.assertCanInfer,
        tools: args.tools,
        record: async (usage) => {
          const counters = await agent.recordUsage(usage, "compaction")
          ledgerSpend.credits = counters.creditsSpent
          ledger.add(usage, counters.costUsd)
        },
        abortSignal,
        inTurn: true,
      }).catch((err: unknown) => {
        rethrowUnlessDeadline(err)
        return "deadline" as const
      })
      if (compacted === "deadline") {
        stoppedFor = "budget_wall_clock"
        break
      }
      if (compacted) {
        context = await loadAgentContext(workspaceId, conversationId)
        await freeze()
        steps = await loadEpochSteps(conversationId, context.epoch)
        messages = promptMessages(steps, context.reasoningCutSeq)
        promptTokens = 0
        expectWarm = false
        // Compaction spent: the limits are checked again before the call.
        continue
      }
    }

    await run.assertCanInfer?.()

    // Approved calls run inside generateText before its model call. Their
    // results are kept so a deadline abort during that call saves them
    // instead of losing them (and resending on a retry).
    const savedCalls = new Set(
      messages.flatMap((message) =>
        message.role === "assistant" && Array.isArray(message.content)
          ? message.content.flatMap((part) =>
              part.type === "tool-call" ? [part.toolCallId] : []
            )
          : []
      )
    )
    const ranApproved: ToolResultPart[] = []
    const keepRanApproved = async () => {
      if (ranApproved.length === 0) return
      const checkpoint = approvedResultsCheckpoint(messages, ranApproved)
      await save([checkpoint])
      messages = [...messages, checkpoint]
      turnMessages.push(checkpoint)
      sentMessages += sentIn([checkpoint])
    }
    const result = await generateText({
      model: withInferenceGuard(
        args.languageModel ?? lorGatewayModel(args.model),
        run.assertCanInfer
      ),
      // The epoch's own prompt: after an in-turn compaction, the new one.
      instructions: context.system ?? args.instructions,
      messages: withLongCache(messages, promptTokens),
      tools: args.tools,
      // The context map is built for this tool set in respond().
      toolsContext: args.toolsContext as never,
      toolApproval,
      stopWhen: isStepCount(1),
      providerOptions: gatewayOptions(
        args.model,
        gatewaySession(conversationId, context.epoch)
      ),
      abortSignal,
      onToolExecutionEnd: ({ toolCall, toolOutput }) => {
        if (!savedCalls.has(toolCall.toolCallId)) return
        ranApproved.push({
          type: "tool-result",
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          output:
            toolOutput.type === "tool-error"
              ? {
                  type: "error-text",
                  value:
                    toolOutput.error instanceof Error
                      ? toolOutput.error.message
                      : String(toolOutput.error),
                }
              : typeof toolOutput.output === "string"
                ? { type: "text", value: toolOutput.output }
                : {
                    type: "json",
                    value: JSON.parse(
                      JSON.stringify(toolOutput.output ?? null)
                    ),
                  },
        })
      },
      runtimeContext: aiRuntimeContext(),
      telemetry: aiTelemetry("lor.agent"),
    }).catch(async (err: unknown) => {
      if (deadline.aborted && !run.abortSignal?.aborted) return null
      // Any other inference failure (e.g. the key guard) still keeps approved
      // results that already ran, so the retry does not lose them.
      if (!run.abortSignal?.aborted)
        await keepRanApproved().catch((saveErr: unknown) =>
          logger.error(
            { err: saveErr, runId: run.runId },
            "Saving approved tool results after a failed call failed"
          )
        )
      throw err
    })
    if (!result) {
      await keepRanApproved()
      stoppedFor = "budget_wall_clock"
      break
    }
    const usage = stepUsage(args.model, result)
    const routing = (
      result.providerMetadata?.gateway as
        | {
            routing?: {
              finalProvider?: string
              modelAttempts?: {
                providerAttempts?: {
                  provider?: string
                  success?: boolean
                  statusCode?: number
                }[]
              }[]
            }
          }
        | undefined
    )?.routing
    const provider = routing?.finalProvider
    // A provider that refused the call before the gateway fell back: the
    // fallback's cache is cold, so it is logged with the call.
    const refusedBy = (routing?.modelAttempts ?? [])
      .flatMap((attempt) => attempt.providerAttempts ?? [])
      .filter((attempt) => attempt.success === false)
      .map((attempt) => `${attempt.provider}:${attempt.statusCode ?? "?"}`)
    // A cache miss is a bug (always-on-agents.md §8): every call logs its
    // cached share, and a miss where the cache should be warm is flagged
    // with what could explain it.
    logger.info(
      {
        conversationId,
        runId: run.runId,
        inputTokens: usage.inputTokens,
        cacheRead: usage.cachedInputTokens,
        cacheWrite: result.usage.inputTokenDetails.cacheWriteTokens ?? 0,
        messages: messages.length,
        provider,
        ...(refusedBy.length > 0 ? { refusedBy } : {}),
      },
      "Agent model call"
    )
    if (turnCache.calls === 0 && usage.cachedInputTokens === 0) {
      turnCache.coldFirst = true
    }
    if (
      expectWarm &&
      promptTokens > 4_096 &&
      usage.cachedInputTokens < promptTokens * 0.5
    ) {
      logger.warn(
        {
          conversationId,
          runId: run.runId,
          call: turnCache.calls + 1,
          expectedCached: promptTokens,
          cacheRead: usage.cachedInputTokens,
          provider,
          previousProvider: lastProvider ?? context.model,
          systemHash: sha256(context.system ?? args.instructions).slice(0, 12),
          toolsHash: toolsHash.slice(0, 12),
          reasoningCutSeq: context.reasoningCutSeq,
        },
        "Agent cache miss"
      )
    }
    turnCache.calls += 1
    turnCache.input += usage.inputTokens
    turnCache.cacheRead += usage.cachedInputTokens
    expectWarm = true
    lastProvider = provider
    const counters = await agent.recordUsage(usage, "step")
    ledgerSpend.credits = counters.creditsSpent
    ledger.add(usage, counters.costUsd)
    promptTokens = usage.inputTokens

    const replies = [...result.responseMessages] as ModelMessage[]
    // An empty stop sends no assistant message; a saved one ends the turn,
    // here and on a retry, since ending without a reply is allowed.
    if (
      result.finishReason === "stop" &&
      !replies.some((message) => message.role === "assistant")
    ) {
      replies.push({
        role: "assistant",
        content: [{ type: "text", text: "(Ended the turn without a reply.)" }],
      })
    }
    await save(replies)
    messages = [...messages, ...replies]
    turnMessages.push(...replies)
    const calls = result.content.filter((part) => part.type === "tool-call")
    countToolCalls(calls.length)
    // Includes approved sends run before this call.
    sentMessages += sentIn(replies)

    for (const part of result.content) {
      if (part.type !== "tool-approval-request" || part.isAutomatic) continue
      approvals.push(
        pendingApproval({
          approvalId: part.approvalId,
          toolCallId: part.toolCall.toolCallId,
          toolName: part.toolCall.toolName,
          input: part.toolCall.input,
          reason: part.reason ?? null,
        })
      )
    }
    if (approvals.length > 0) {
      stoppedFor = "awaiting_approval"
      break
    }
  }

  await db
    .update(schema.agentContext)
    .set({ promptTokens, lastTurnEndedAt: new Date() })
    .where(eq(schema.agentContext.conversationId, conversationId))
  if (turnCache.calls > 0) {
    logger.info(
      {
        conversationId,
        runId: run.runId,
        calls: turnCache.calls,
        inputTokens: turnCache.input,
        cacheRead: turnCache.cacheRead,
        cachedShare: Math.round((turnCache.cacheRead / turnCache.input) * 100),
        coldFirst: turnCache.coldFirst,
      },
      "Agent turn cache"
    )
  }

  return {
    text: lastAssistantText(turnMessages),
    messages: before ? [before, ...turnMessages] : turnMessages,
    ...(stoppedFor ? { stoppedFor } : {}),
    approvals,
    promptTokens,
    sentMessages,
  }
}

// A channel's latest chat, word for word: for the top of a new epoch, and
// for a request's first turn, which has seen none of it.
export async function recentChat(channelId: string): Promise<string> {
  const rows = await db
    .select({
      id: schema.message.id,
      content: schema.message.content,
      createdAt: schema.message.createdAt,
      authorName: schema.user.name,
    })
    .from(schema.message)
    .innerJoin(schema.user, eq(schema.user.id, schema.message.authorId))
    .where(
      and(
        eq(schema.message.channelId, channelId),
        chatFeedMessage(),
        isNotNull(schema.message.content)
      )
    )
    .orderBy(desc(schema.message.createdAt))
    .limit(RECENT_CHAT_MESSAGES)
  return rows
    .reverse()
    .map((row) =>
      formatSpeakerLine(
        row.authorName,
        `${row.content ?? ""}\n(message ${row.id})`
      )
    )
    .join("\n")
}

// Summarizes the epoch on its own prompt (same tools, system prompt and
// model, with the request added at the end) and opens the next epoch from
// the summary and the latest chat. Null when there is nothing to compact.
export async function compactAgentConversation(args: {
  workspaceId: string
  conversationId: string
  model: string
  languageModel?: LanguageModel
  assertCanInfer?: () => Promise<void>
  byok?: boolean
  tools: ToolSet
  record: (usage: RunStepRecord & { reasoningTokens: number }) => Promise<void>
  abortSignal?: AbortSignal
  inTurn?: boolean
}): Promise<{ epoch: number; summaryChars: number } | null> {
  const context = await loadAgentContext(args.workspaceId, args.conversationId)
  if (!context.system) return null
  const steps = await loadEpochSteps(args.conversationId, context.epoch)
  if (steps.length < 2 || openApprovals(steps).length > 0) return null

  // Same tool definitions so the prefix matches, but nothing runs.
  const inert = Object.fromEntries(
    Object.entries(args.tools).map(([name, t]) => [
      name,
      { ...(t as object), execute: undefined },
    ])
  ) as ToolSet
  const messages: ModelMessage[] = [
    ...promptMessages(steps, context.reasoningCutSeq),
    { role: "user", content: SUMMARY_REQUEST },
  ]
  const result = await generateText({
    model: withInferenceGuard(
      args.languageModel ?? lorGatewayModel(args.model),
      args.assertCanInfer
    ),
    instructions: context.system,
    messages,
    tools: inert,
    stopWhen: isStepCount(1),
    providerOptions: gatewayOptions(
      args.model,
      gatewaySession(args.conversationId, context.epoch)
    ),
    ...(args.abortSignal ? { abortSignal: args.abortSignal } : {}),
    runtimeContext: aiRuntimeContext(),
    telemetry: aiTelemetry("lor.agent.compact"),
  })
  await args.record(stepUsage(args.model, result))

  const raw = result.text.trim()
  const summary = (
    raw.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? raw
  ).trim()
  if (!summary) {
    logger.warn(
      { conversationId: args.conversationId },
      "Agent compaction was empty"
    )
    return null
  }
  // A request picks up from its channel's chat. The own conversation spans
  // every channel, and its next inbox says what is new in each.
  const conversation = await loadConversation(args.conversationId)
  const chat =
    conversation?.kind === "request" && conversation.channelId
      ? await recentChat(conversation.channelId)
      : ""
  const opening = `${SUMMARY_HEADER}\n\n${summary}${chat ? `\n\nThe latest messages in the chat, word for word:\n${chat}` : ""}`

  const next = context.epoch + 1
  const moved = await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.agentContext)
      .set({
        epoch: next,
        system: null,
        toolsHash: null,
        model: null,
        reasoningCutSeq: null,
        promptTokens: 0,
        compactedAt: new Date(),
      })
      .where(
        and(
          eq(schema.agentContext.conversationId, args.conversationId),
          eq(schema.agentContext.epoch, context.epoch)
        )
      )
      .returning({ epoch: schema.agentContext.epoch })
    if (updated.length === 0) return false
    await appendSteps(tx, {
      workspaceId: args.workspaceId,
      conversationId: args.conversationId,
      epoch: next,
      runId: null,
      steps: [{ kind: "summary", message: { role: "user", content: opening } }],
    })
    return true
  })
  if (!moved) return null
  logger.info(
    {
      conversationId: args.conversationId,
      epoch: next,
      inTurn: Boolean(args.inTurn),
      promptTokens: context.promptTokens,
      summaryChars: summary.length,
    },
    "Agent conversation compacted"
  )
  return { epoch: next, summaryChars: summary.length }
}

const MEMORY_PASS_CALLS = 6
const MEMORY_TOOLS: ReadonlySet<string> = new Set([
  "memory_ls",
  "memory_read",
  "memory_write",
  "memory_edit",
  "memory_link",
])
const NOT_IN_MEMORY_PASS = {
  ok: false as const,
  error: "Only the memory tools run during the memory pass.",
}

export type MemoryPassResult = {
  added: number
  edited: number
  removed: number
  archived: number
  // Whether the pass wrote a journal entry for the turn.
  journaled: boolean
  calls: number
}

// After a turn, on its own prompt while the cache is warm (decision 11): the
// same tools, system prompt and model, with the current facts and the request
// added at the end. It changes facts through its closing block and brain
// pages through the memory tools; every other tool is refused, and so is a
// memory tool an approval rule covers. Nothing it writes joins the history.
export async function agentMemoryPass(args: {
  workspaceId: string
  conversationId: string
  agentId: string
  // The channel the turn was about, on its facts and journal entry.
  channelId: string | null
  // The turn it follows: the pass reads the history up to that turn's end.
  turnRunId: string
  // The person the turn was for, on its journal entry.
  askedById?: string | null
  model: string
  languageModel?: LanguageModel
  assertCanInfer?: () => Promise<void>
  byok?: boolean
  tools: ToolSet
  toolsContext: unknown
  gated: ReadonlySet<string>
  record: (usage: RunStepRecord & { reasoningTokens: number }) => void
  abortSignal?: AbortSignal
}): Promise<MemoryPassResult | null> {
  const context = await loadAgentContext(args.workspaceId, args.conversationId)
  if (!context.system) return null
  const steps = await loadEpochSteps(args.conversationId, context.epoch)
  const through = steps.filter((step) => step.runId === args.turnRunId).at(-1)
  if (!through) return null
  const history = steps.filter((step) => step.seq <= through.seq)
  if (openApprovals(history).length > 0) return null

  const shown = factsForMemoryPass(await loadAgentFacts(args.agentId))
  const tools = Object.fromEntries(
    Object.entries(args.tools).map(([name, t]) => [
      name,
      MEMORY_TOOLS.has(name) && !args.gated.has(name)
        ? t
        : { ...(t as object), execute: async () => NOT_IN_MEMORY_PASS },
    ])
  ) as ToolSet
  const messages: ModelMessage[] = [
    ...promptMessages(history, context.reasoningCutSeq),
    { role: "user", content: memoryPassRequest(shown.text) },
  ]

  let calls = 0
  let reply = ""
  while (calls < MEMORY_PASS_CALLS) {
    const result = await generateText({
      model: withInferenceGuard(
        args.languageModel ?? lorGatewayModel(args.model),
        args.assertCanInfer
      ),
      instructions: context.system,
      messages,
      tools,
      toolsContext: args.toolsContext as never,
      stopWhen: isStepCount(1),
      providerOptions: gatewayOptions(
        args.model,
        gatewaySession(args.conversationId, context.epoch)
      ),
      ...(args.abortSignal ? { abortSignal: args.abortSignal } : {}),
      runtimeContext: aiRuntimeContext(),
      telemetry: aiTelemetry("lor.agent.memory"),
    })
    calls += 1
    const usage = stepUsage(args.model, result)
    args.record(usage)
    logger.info(
      {
        conversationId: args.conversationId,
        runId: args.turnRunId,
        inputTokens: usage.inputTokens,
        cacheRead: usage.cachedInputTokens,
        outputTokens: usage.outputTokens,
      },
      "Agent memory pass call"
    )
    messages.push(...(result.responseMessages as ModelMessage[]))
    reply = result.text
    if (!result.content.some((part) => part.type === "tool-call")) break
  }

  const changes = parseFactChanges(reply)
  if (!changes) {
    logger.warn(
      { conversationId: args.conversationId, runId: args.turnRunId, calls },
      "Agent memory pass left no facts block"
    )
    return {
      added: 0,
      edited: 0,
      removed: 0,
      archived: 0,
      journaled: false,
      calls,
    }
  }
  const applied = await applyFactChanges({
    workspaceId: args.workspaceId,
    agentId: args.agentId,
    channelId: args.channelId,
    shown: shown.ids,
    changes,
  })
  const journaled = changes.journal?.trim()
    ? await addJournalEntry({
        workspaceId: args.workspaceId,
        agentId: args.agentId,
        channelId: args.channelId,
        conversationId: args.conversationId,
        runId: args.turnRunId,
        userId: args.askedById ?? null,
        text: changes.journal,
      })
    : false
  logger.info(
    {
      conversationId: args.conversationId,
      runId: args.turnRunId,
      calls,
      ...applied,
      journaled,
    },
    "Agent memory pass ended"
  )
  return { ...applied, journaled, calls }
}

// The agent's own history, including what compaction left out of its
// context, in every conversation it has (reference/agents-and-chats.md,
// decision 25). A turn is one run.
export const readAgentHistoryTool = {
  read_agent_history: tool({
    description:
      "Read your own earlier work word for word, in this conversation and every other one you have (your own, and each request), including everything from before a conversation was summarized: what woke you, what you sent, the tools you called and what they returned. With `turn` (a turn id from an earlier result), reads that turn in full, a page at a time (`page`, from 0, when the result says there is more). With `query`, finds earlier turns whose text contains it. With neither, lists your recent turns. Each result says where it was. `before` (a date like 2026-11-01) limits results to earlier turns.",
    inputSchema: z.object({
      turn: z.string().uuid().optional().describe("a turn id to read in full"),
      page: z.number().optional().describe("a page of a long turn, from 0"),
      query: z.string().min(2).max(200).optional(),
      before: z.string().optional().describe("ISO date or datetime"),
    }),
    contextSchema: z.object({ agentId: z.string() }),
    execute: async ({ turn, page, query, before }, { context }) => {
      const mine = eq(schema.agentConversation.agentId, context.agentId)
      const inConversation = eq(
        schema.agentConversation.id,
        schema.agentStep.conversationId
      )
      const named = eq(schema.channel.id, schema.agentConversation.channelId)
      const where = (row: {
        kind: "own" | "request"
        channelName: string | null
      }) =>
        row.kind === "own"
          ? "your own conversation"
          : `a request in #${row.channelName ?? "a channel"}`
      if (turn) {
        // From the stored messages, not the search text, which clips each
        // tool input and result.
        const rows = await db
          .select({
            kind: schema.agentStep.kind,
            message: schema.agentStep.message,
            createdAt: schema.agentStep.createdAt,
            conversationKind: schema.agentConversation.kind,
            channelName: schema.channel.name,
          })
          .from(schema.agentStep)
          .innerJoin(schema.agentConversation, inConversation)
          .leftJoin(schema.channel, named)
          .where(and(mine, eq(schema.agentStep.runId, turn)))
          .orderBy(asc(schema.agentStep.seq))
        const first = rows[0]
        if (!first) return { error: "No turn of yours has that id." }
        const body = rows
          .map(
            (row) =>
              `[${row.kind}]\n${stepText(row.message, Number.POSITIVE_INFINITY)}`
          )
          .join("\n\n")
        const pages = Math.max(1, Math.ceil(body.length / HISTORY_RESULT_CHARS))
        const at = Math.min(Math.max(0, Math.floor(page ?? 0)), pages - 1)
        return {
          turn,
          where: where({
            kind: first.conversationKind,
            channelName: first.channelName,
          }),
          startedAt: first.createdAt.toISOString(),
          page: at,
          pages,
          text: body.slice(
            at * HISTORY_RESULT_CHARS,
            (at + 1) * HISTORY_RESULT_CHARS
          ),
        }
      }
      const beforeDate = before ? new Date(before) : null
      const rows = await db
        .select({
          runId: schema.agentStep.runId,
          kind: schema.agentStep.kind,
          text: schema.agentStep.text,
          createdAt: schema.agentStep.createdAt,
          conversationKind: schema.agentConversation.kind,
          channelName: schema.channel.name,
        })
        .from(schema.agentStep)
        .innerJoin(schema.agentConversation, inConversation)
        .leftJoin(schema.channel, named)
        .where(
          and(
            mine,
            isNotNull(schema.agentStep.runId),
            query
              ? ilike(
                  schema.agentStep.text,
                  `%${query.replace(/[%_\\]/g, "\\$&")}%`
                )
              : eq(schema.agentStep.kind, "inbox"),
            beforeDate && !Number.isNaN(beforeDate.getTime())
              ? lt(schema.agentStep.createdAt, beforeDate)
              : undefined
          )
        )
        .orderBy(desc(schema.agentStep.createdAt), desc(schema.agentStep.seq))
        .limit(20)
      return {
        turns: rows.map((row) => ({
          turn: row.runId,
          where: where({
            kind: row.conversationKind,
            channelName: row.channelName,
          }),
          at: row.createdAt.toISOString(),
          kind: row.kind,
          text: clip(row.text, 600),
        })),
      }
    },
  }),
}
