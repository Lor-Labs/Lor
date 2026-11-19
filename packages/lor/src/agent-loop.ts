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
import { chatFeedMessage } from "@repo/db/queries/agent-sessions"
import type { AgentStepKind, AgentStepMessage } from "@repo/db/schema"
import {
  generateText,
  isStepCount,
  type ModelMessage,
  type ToolApprovalResponse,
  type ToolApprovalStatus,
  type ToolSet,
  tool,
} from "ai"
import { z } from "zod"
import { aiRuntimeContext, aiTelemetry } from "./ai-observability"
import type { RunAgentContext } from "./channel-agent"
import { logger } from "./logger"
import { lorGatewayModel } from "./models"
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
  channelId: string
  agent: RunAgentContext
  run: RunHandle
  model: string
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
export function stepText(message: AgentStepMessage): string {
  if (typeof message.content === "string") return message.content
  return partsOf(message)
    .map((part) => {
      switch (part.type) {
        case "text":
          return typeof part.text === "string" ? part.text : ""
        case "tool-call":
          return `→ ${String(part.toolName)} ${clip(json(part.input), STEP_TEXT_PART_CHARS)}`
        case "tool-result":
          return `← ${String(part.toolName)}: ${clip(json(part.output), STEP_TEXT_PART_CHARS)}`
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

export async function loadAgentContext(workspaceId: string, channelId: string) {
  await db
    .insert(schema.agentContext)
    .values({ channelId, workspaceId })
    .onConflictDoNothing()
  const [row] = await db
    .select()
    .from(schema.agentContext)
    .where(eq(schema.agentContext.channelId, channelId))
  if (!row) throw new Error("Channel agent context missing")
  return row
}

async function loadEpochSteps(
  channelId: string,
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
        eq(schema.agentStep.channelId, channelId),
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
    channelId: string
    epoch: number
    runId: string | null
    steps: { kind: AgentStepKind; message: AgentStepMessage }[]
  }
): Promise<void> {
  if (args.steps.length === 0) return
  const [last] = await tx
    .select({ seq: sql<number>`coalesce(max(${schema.agentStep.seq}), -1)` })
    .from(schema.agentStep)
    .where(eq(schema.agentStep.channelId, args.channelId))
  const base = Number(last?.seq ?? -1) + 1
  await tx.insert(schema.agentStep).values(
    args.steps.map((step, index) => ({
      workspaceId: args.workspaceId,
      channelId: args.channelId,
      epoch: args.epoch,
      seq: base + index,
      runId: args.runId,
      kind: step.kind,
      message: step.message,
      text: stepText(step.message),
    }))
  )
}

// The approval requests a model step left open, with the calls they hold.
function openApprovals(step: StoredStep | undefined) {
  if (!step || step.kind !== "model") return []
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
export async function pausedAgentRun(channelId: string): Promise<{
  runId: string
  epoch: number
} | null> {
  const [last] = await db
    .select({
      id: schema.agentStep.id,
      seq: schema.agentStep.seq,
      epoch: schema.agentStep.epoch,
      runId: schema.agentStep.runId,
      kind: schema.agentStep.kind,
      message: schema.agentStep.message,
    })
    .from(schema.agentStep)
    .where(eq(schema.agentStep.channelId, channelId))
    .orderBy(desc(schema.agentStep.seq))
    .limit(1)
  if (!last?.runId || openApprovals(last).length === 0) return null
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
// both live with the provider that wrote them.
function gatewayOptions(model: string) {
  return {
    gateway: {
      caching: "auto" as const,
      ...(model.startsWith("anthropic/") ? { order: ["anthropic"] } : {}),
    },
  }
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
        ...total,
        ...(costUsd !== null ? { costUsd } : {}),
        wallMs: Math.round(performance.now() - started),
        toolCalls,
        billingKey: `${args.runId}:${args.label}:${args.model}`,
      })
    },
  }
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
  const { run, channelId, workspaceId } = args
  const ledger = usageLedger({
    workspaceId,
    runId: run.runId,
    model: args.model,
    label: "agent",
    onUsage: args.onUsage,
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
    logger.info({ channelId, runId: run.runId, toolCalls }, "Agent turn ended")
  }
}

async function turnLoop(
  args: AgentTurnArgs,
  ledger: ReturnType<typeof usageLedger>,
  countToolCalls: (n: number) => void
): Promise<AgentTurnResult> {
  const { run, channelId, workspaceId, agent } = args
  let context = await loadAgentContext(workspaceId, channelId)

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
          eq(schema.agentContext.channelId, channelId),
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
        channelId,
        toolsChanged: context.toolsHash !== toolsHash,
        modelChanged: context.model !== args.model,
      },
      "Agent tools or model changed within an epoch; the cache misses once"
    )
    const [last] = await db
      .select({ seq: sql<number>`coalesce(max(${schema.agentStep.seq}), -1)` })
      .from(schema.agentStep)
      .where(eq(schema.agentStep.channelId, channelId))
    const reasoningCutSeq = Number(last?.seq ?? -1)
    await db
      .update(schema.agentContext)
      .set({ toolsHash, model: args.model, reasoningCutSeq })
      .where(eq(schema.agentContext.channelId, channelId))
    context = { ...context, toolsHash, model: args.model, reasoningCutSeq }
  }
  const system = context.system ?? args.instructions

  let steps = await loadEpochSteps(channelId, context.epoch)
  const save = async (messages: ModelMessage[]) => {
    await appendSteps(db, {
      workspaceId,
      channelId,
      epoch: context.epoch,
      runId: run.runId,
      steps: messages.map((message) => ({
        kind: kindOf(message),
        message: message as AgentStepMessage,
      })),
    })
  }

  // A paused turn finishes first: one decision per open approval.
  const open = openApprovals(steps.at(-1))
  if (open.length > 0) {
    const pausedRunId = steps.at(-1)?.runId
    const decisions =
      pausedRunId && agent.loadDecisions
        ? await agent.loadDecisions(pausedRunId)
        : []
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
    steps = await loadEpochSteps(channelId, context.epoch)
  }

  let messages = promptMessages(steps, context.reasoningCutSeq)
  const startedAt = messages.length
  const window = contextWindowOf(args.model)
  let promptTokens = context.promptTokens
  let sentMessages = 0
  let stoppedFor: RunStopCause | undefined
  const approvals: PendingApproval[] = []

  const ledgerSpend = { credits: 0 }
  const spendLimited = () =>
    Date.now() >= run.budgets.deadlineAt.getTime() - 3 * 60_000 ||
    ledgerSpend.credits >= run.budgets.credits * 0.9
  const toolApproval = ({ toolCall }: { toolCall: { toolName: string } }) =>
    spendLimited()
      ? ({ type: "denied", reason: LIMIT_REASON } as const)
      : args.approval[toolCall.toolName]

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

  while (!finished()) {
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
    // A turn that filled most of the window compacts before its next call.
    if (promptTokens >= window * COMPACT_IN_TURN_SHARE) {
      const compacted = await compactAgentConversation({
        workspaceId,
        channelId,
        model: args.model,
        tools: args.tools,
        record: async (usage) => {
          const counters = await agent.recordUsage(usage, "compaction")
          ledgerSpend.credits = counters.creditsSpent
          ledger.add(usage, counters.costUsd)
        },
        ...(run.abortSignal ? { abortSignal: run.abortSignal } : {}),
        inTurn: true,
      })
      if (compacted) {
        context = await loadAgentContext(workspaceId, channelId)
        await freeze()
        steps = await loadEpochSteps(channelId, context.epoch)
        messages = promptMessages(steps, context.reasoningCutSeq)
        promptTokens = 0
      }
    }

    const result = await generateText({
      model: lorGatewayModel(args.model),
      instructions: system,
      messages: withLongCache(messages, promptTokens),
      tools: args.tools,
      // The context map is built for this tool set in respond().
      toolsContext: args.toolsContext as never,
      toolApproval,
      stopWhen: isStepCount(1),
      providerOptions: gatewayOptions(args.model),
      ...(run.abortSignal ? { abortSignal: run.abortSignal } : {}),
      runtimeContext: aiRuntimeContext(),
      telemetry: aiTelemetry("lor.agent"),
    })
    const usage = stepUsage(args.model, result)
    // A cache miss is a bug (always-on-agents.md §8): every call logs its
    // cached share.
    logger.info(
      {
        channelId,
        runId: run.runId,
        inputTokens: usage.inputTokens,
        cacheRead: usage.cachedInputTokens,
        cacheWrite: result.usage.inputTokenDetails.cacheWriteTokens ?? 0,
        messages: messages.length,
        provider: (
          result.providerMetadata?.gateway as
            | { routing?: { finalProvider?: string } }
            | undefined
        )?.routing?.finalProvider,
      },
      "Agent model call"
    )
    const counters = await agent.recordUsage(usage, "step")
    ledgerSpend.credits = counters.creditsSpent
    ledger.add(usage, counters.costUsd)
    promptTokens = usage.inputTokens

    const replies = result.responseMessages as ModelMessage[]
    await save(replies)
    messages = [...messages, ...replies]
    const calls = result.content.filter((part) => part.type === "tool-call")
    countToolCalls(calls.length)
    sentMessages += calls.filter(
      (part) => part.toolName === "send_message"
    ).length

    for (const part of result.content) {
      if (part.type !== "tool-approval-request" || part.isAutomatic) continue
      const input = part.toolCall.input
      const asked =
        part.toolCall.toolName === "request_approval"
          ? (input as { action?: unknown; description?: unknown })
          : null
      const target = asked ? null : args.targetFor(part.toolCall.toolName)
      approvals.push({
        harnessApprovalId: part.approvalId,
        toolCallId: part.toolCall.toolCallId,
        toolName: part.toolCall.toolName,
        kind: asked ? "request" : "policy",
        target,
        action:
          typeof asked?.action === "string"
            ? asked.action
            : (target ?? part.toolCall.toolName),
        description:
          typeof asked?.description === "string"
            ? asked.description
            : args.describe(part.toolCall.toolName, input),
        reason: part.reason ?? null,
        payload: input,
        inputSha256: sha256(stableStringify(input)),
      })
    }
    if (approvals.length > 0) {
      stoppedFor = "awaiting_approval"
      break
    }
  }

  await db
    .update(schema.agentContext)
    .set({ promptTokens, lastTurnEndedAt: new Date() })
    .where(eq(schema.agentContext.channelId, channelId))

  return {
    text: lastAssistantText(messages.slice(startedAt)),
    messages: messages.slice(Math.max(0, startedAt - 1)),
    ...(stoppedFor ? { stoppedFor } : {}),
    approvals,
    promptTokens,
    sentMessages,
  }
}

// The latest chat, word for word, for the top of a new epoch.
async function recentChat(channelId: string): Promise<string> {
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
  channelId: string
  model: string
  tools: ToolSet
  record: (usage: RunStepRecord & { reasoningTokens: number }) => Promise<void>
  abortSignal?: AbortSignal
  inTurn?: boolean
}): Promise<{ epoch: number; summaryChars: number } | null> {
  const context = await loadAgentContext(args.workspaceId, args.channelId)
  if (!context.system) return null
  const steps = await loadEpochSteps(args.channelId, context.epoch)
  if (steps.length < 2 || openApprovals(steps.at(-1)).length > 0) return null

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
    model: lorGatewayModel(args.model),
    instructions: context.system,
    messages,
    tools: inert,
    stopWhen: isStepCount(1),
    providerOptions: gatewayOptions(args.model),
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
    logger.warn({ channelId: args.channelId }, "Agent compaction was empty")
    return null
  }
  const chat = await recentChat(args.channelId)
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
          eq(schema.agentContext.channelId, args.channelId),
          eq(schema.agentContext.epoch, context.epoch)
        )
      )
      .returning({ epoch: schema.agentContext.epoch })
    if (updated.length === 0) return false
    await appendSteps(tx, {
      workspaceId: args.workspaceId,
      channelId: args.channelId,
      epoch: next,
      runId: null,
      steps: [{ kind: "summary", message: { role: "user", content: opening } }],
    })
    return true
  })
  if (!moved) return null
  logger.info(
    {
      channelId: args.channelId,
      epoch: next,
      inTurn: Boolean(args.inTurn),
      promptTokens: context.promptTokens,
      summaryChars: summary.length,
    },
    "Agent conversation compacted"
  )
  return { epoch: next, summaryChars: summary.length }
}

// The agent's own history, including what compaction left out of its
// context. A turn is one run.
export const readAgentHistoryTool = {
  read_agent_history: tool({
    description:
      "Read your own earlier work in this channel word for word, including everything from before your conversation was summarized: what woke you, what you sent, the tools you called and what they returned. With `turn` (a turn id from an earlier result), reads that turn in full. With `query`, finds earlier turns whose text contains it. With neither, lists your recent turns. `before` (a date like 2026-11-01) limits results to earlier turns.",
    inputSchema: z.object({
      turn: z.string().uuid().optional().describe("a turn id to read in full"),
      query: z.string().min(2).max(200).optional(),
      before: z.string().optional().describe("ISO date or datetime"),
    }),
    contextSchema: z.object({ channelId: z.string() }),
    execute: async ({ turn, query, before }, { context }) => {
      const channelId = context.channelId
      if (turn) {
        const rows = await db
          .select({
            kind: schema.agentStep.kind,
            text: schema.agentStep.text,
            createdAt: schema.agentStep.createdAt,
          })
          .from(schema.agentStep)
          .where(
            and(
              eq(schema.agentStep.channelId, channelId),
              eq(schema.agentStep.runId, turn)
            )
          )
          .orderBy(asc(schema.agentStep.seq))
        if (rows.length === 0) return { error: "No turn with that id here." }
        const body = rows
          .map((row) => `[${row.kind}]\n${row.text}`)
          .join("\n\n")
        return {
          turn,
          startedAt: rows[0]?.createdAt.toISOString(),
          text: clip(body, HISTORY_RESULT_CHARS),
        }
      }
      const beforeDate = before ? new Date(before) : null
      const rows = await db
        .select({
          runId: schema.agentStep.runId,
          kind: schema.agentStep.kind,
          text: schema.agentStep.text,
          createdAt: schema.agentStep.createdAt,
        })
        .from(schema.agentStep)
        .where(
          and(
            eq(schema.agentStep.channelId, channelId),
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
        .orderBy(desc(schema.agentStep.seq))
        .limit(20)
      return {
        turns: rows.map((row) => ({
          turn: row.runId,
          at: row.createdAt.toISOString(),
          kind: row.kind,
          text: clip(row.text, 600),
        })),
      }
    },
  }),
}
