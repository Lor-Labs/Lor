import { randomUUID } from "node:crypto"
import { hostname } from "node:os"
import { computeCredits, getRate } from "@repo/billing"
import {
  and,
  asc,
  db,
  eq,
  inArray,
  isNull,
  lt,
  or,
  schema,
  sql,
} from "@repo/db"
import type {
  AgentRunContext,
  MerlinMemory,
  MerlinReasoningSegment,
  MerlinToolCall,
} from "@repo/db/schema"
import {
  buildInitialUserMessage,
  type ModelMessage,
  type RunCounters,
  type RunHandle,
  type RunResume,
  type RunStepRecord,
  type UsageEvent,
} from "@repo/merlin"
import { logger } from "@/lib/logger"
import { createRunEventWriter, type RunEventWriter } from "@/lib/run-events"

const LEASE_TTL_MS = 60_000
const HEARTBEAT_MS = 20_000
// Sequence gap left when taking over a crashed attempt, so recovered frames
// can never collide with the dead worker's un-flushed live tail.
const TAKEOVER_SEQ_GAP = 10_000

const WORKER_ID = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`

// Thrown (and converted to an abort) when a lease-guarded write matches no
// row: another worker owns the run now, so this attempt must stop touching
// the message and exit without emitting anything.
export class LeaseLostError extends Error {
  constructor() {
    super("agent run lease lost")
    this.name = "LeaseLostError"
  }
}

// In-flight UI trail reconstructed from the event log so a recovered attempt
// keeps (and keeps persisting) the tool calls/reasoning streamed before the
// crash, not just its own.
export type RunTrailSeed = {
  toolCalls: MerlinToolCall[]
  reasoning: string
  reasoningSegments: MerlinReasoningSegment[]
  remembered: MerlinMemory[]
  nextOrder: number
}

export type ResumeState = RunResume & {
  conversation: AgentRunContext["conversation"]
  trail: RunTrailSeed
}

export type RunExecution = {
  runId: string
  workspaceId: string
  writer: RunEventWriter
  handle: RunHandle
  resume: ResumeState | null
  counters: () => RunCounters
  // Nested billable usage (investigate_code) folds into the next checkpoint.
  noteNestedUsage: (u: UsageEvent) => void
  // Post-answer usage (write-back) folds straight into the counters.
  addUsage: (u: UsageEvent) => void
  setPhase: (phase: "answer" | "writeback") => Promise<void>
  aborted: () => boolean
  stop: () => void
}

export type ClaimOutcome =
  | { kind: "legacy" }
  | { kind: "terminal" }
  | { kind: "exhausted" }
  | { kind: "claimed"; execution: RunExecution }

function countersOf(row: {
  steps: number
  inputTokens: number
  outputTokens: number
  toolCalls: number
  toolOutputBytes: number
  creditsSpent: number
}): RunCounters {
  return {
    steps: row.steps,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    toolCalls: row.toolCalls,
    toolOutputBytes: row.toolOutputBytes,
    creditsSpent: row.creditsSpent,
  }
}

const COUNTER_SELECTION = {
  steps: schema.agentRun.steps,
  inputTokens: schema.agentRun.inputTokens,
  outputTokens: schema.agentRun.outputTokens,
  toolCalls: schema.agentRun.toolCalls,
  toolOutputBytes: schema.agentRun.toolOutputBytes,
  creditsSpent: schema.agentRun.creditsSpent,
}

function assistantText(messages: ModelMessage[]): string {
  let out = ""
  for (const m of messages) {
    if (m.role !== "assistant") continue
    if (typeof m.content === "string") {
      out += m.content
      continue
    }
    for (const part of m.content) {
      if (part.type === "text") out += part.text
    }
  }
  return out
}

async function loadTrailSeed(runId: string): Promise<RunTrailSeed> {
  const seed: RunTrailSeed = {
    toolCalls: [],
    reasoning: "",
    reasoningSegments: [],
    remembered: [],
    nextOrder: 0,
  }
  const rows = await db
    .select({ payload: schema.agentRunEvent.payload })
    .from(schema.agentRunEvent)
    .where(
      and(
        eq(schema.agentRunEvent.runId, runId),
        inArray(schema.agentRunEvent.kind, ["tool", "reasoning", "memory"])
      )
    )
    .orderBy(asc(schema.agentRunEvent.seq))
    .catch(() => [])
  for (const { payload } of rows) {
    if (payload.kind === "tool") {
      const tc = payload.toolCall
      const idx = seed.toolCalls.findIndex(
        (t) => t.toolCallId === tc.toolCallId
      )
      if (idx >= 0) seed.toolCalls[idx] = { ...seed.toolCalls[idx], ...tc }
      else seed.toolCalls.push(tc)
      if (tc.order !== undefined) {
        seed.nextOrder = Math.max(seed.nextOrder, tc.order + 1)
      }
    } else if (payload.kind === "reasoning") {
      seed.reasoning += payload.delta
      const seg = seed.reasoningSegments.find(
        (s) => s.at === payload.at && s.order === payload.order
      )
      if (seg) seg.text += payload.delta
      else {
        seed.reasoningSegments.push({
          text: payload.delta,
          at: payload.at,
          order: payload.order,
        })
      }
      seed.nextOrder = Math.max(seed.nextOrder, payload.order + 1)
    } else if (payload.kind === "memory") {
      seed.remembered = [
        ...seed.remembered.filter((r) => r.path !== payload.path),
        { path: payload.path, action: payload.action },
      ]
    }
  }
  return seed
}

// Claim the run for execution: queued → working, or takeover of an expired
// lease. Attempt accounting, the wall-clock deadline, and the takeover seq
// gap all happen in the same guarded update, so concurrent workers can never
// share a claim or reset each other's limits.
export async function claimAgentRun(
  runId: string | undefined
): Promise<ClaimOutcome> {
  if (!runId) return { kind: "legacy" }

  const now = new Date()
  const claimed = await db
    .update(schema.agentRun)
    .set({
      state: "working",
      leaseOwner: WORKER_ID,
      leaseExpiresAt: new Date(now.getTime() + LEASE_TTL_MS),
      attempt: sql`${schema.agentRun.attempt} + 1`,
      startedAt: sql`coalesce(${schema.agentRun.startedAt}, now())`,
      deadlineAt: sql`coalesce(${schema.agentRun.deadlineAt}, now() + make_interval(secs => ${schema.agentRun.budgetWallMs} / 1000.0))`,
      nextSeq: sql`${schema.agentRun.nextSeq} + case when ${schema.agentRun.state} = 'queued' then 0 else ${TAKEOVER_SEQ_GAP} end`,
    })
    .where(
      and(
        eq(schema.agentRun.id, runId),
        lt(schema.agentRun.attempt, schema.agentRun.maxAttempts),
        or(
          eq(schema.agentRun.state, "queued"),
          and(
            inArray(schema.agentRun.state, ["working", "finalizing"]),
            or(
              isNull(schema.agentRun.leaseExpiresAt),
              lt(schema.agentRun.leaseExpiresAt, now)
            )
          )
        )
      )
    )
    .returning()
    .then((r) => r[0] ?? null)
    .catch((err) => {
      logger.warn({ err, runId }, "Agent run claim failed")
      return null
    })

  if (!claimed) {
    const row = await db
      .select({
        state: schema.agentRun.state,
        attempt: schema.agentRun.attempt,
        maxAttempts: schema.agentRun.maxAttempts,
        leaseExpiresAt: schema.agentRun.leaseExpiresAt,
      })
      .from(schema.agentRun)
      .where(eq(schema.agentRun.id, runId))
      .then((r) => r[0])
      .catch(() => undefined)
    // Row missing (or unreadable): behave as before durable runs existed.
    if (!row) return { kind: "legacy" }
    if (
      row.state === "complete" ||
      row.state === "failed" ||
      row.state === "stopped"
    ) {
      return { kind: "terminal" }
    }
    const leaseExpired =
      !row.leaseExpiresAt || row.leaseExpiresAt.getTime() < now.getTime()
    if (row.attempt >= row.maxAttempts && leaseExpired) {
      // No attempts left and nobody working it: this run can never continue.
      await db
        .update(schema.agentRun)
        .set({ state: "failed", stopReason: "error", finishedAt: new Date() })
        .where(
          and(
            eq(schema.agentRun.id, runId),
            inArray(schema.agentRun.state, ["queued", "working", "finalizing"])
          )
        )
        .catch(() => {})
      return { kind: "exhausted" }
    }
    // A live lease elsewhere — that worker owns the answer.
    return { kind: "terminal" }
  }

  const writer = createRunEventWriter({
    runId,
    workerId: WORKER_ID,
    initialSeq: claimed.nextSeq,
  })
  const abort = new AbortController()
  let counters = countersOf(claimed)

  const heartbeat = setInterval(() => {
    void db
      .update(schema.agentRun)
      .set({ leaseExpiresAt: new Date(Date.now() + LEASE_TTL_MS) })
      .where(
        and(
          eq(schema.agentRun.id, runId),
          eq(schema.agentRun.leaseOwner, WORKER_ID),
          inArray(schema.agentRun.state, ["working", "finalizing"])
        )
      )
      .returning({ id: schema.agentRun.id })
      .then((r) => {
        if (!r[0]) {
          logger.warn({ runId }, "Agent run lease lost; aborting attempt")
          clearInterval(heartbeat)
          abort.abort()
        }
      })
      .catch(() => {
        // Transient DB failure: keep going; the lease has a full TTL of slack.
      })
  }, HEARTBEAT_MS)

  const rateCache = new Map<
    string,
    Awaited<ReturnType<typeof getRate>> | null
  >()
  const creditsFor = async (u: {
    model?: string
    inputTokens?: number
    cachedInputTokens?: number
    outputTokens?: number
  }): Promise<number> => {
    if (!u.model) return 0
    if ((u.inputTokens ?? 0) === 0 && (u.outputTokens ?? 0) === 0) return 0
    if (!rateCache.has(u.model)) {
      rateCache.set(u.model, await getRate(u.model).catch(() => null))
    }
    const rate = rateCache.get(u.model)
    if (!rate) return 0
    return computeCredits(
      {
        inputTokens: u.inputTokens,
        cachedInputTokens: u.cachedInputTokens,
        outputTokens: u.outputTokens,
      },
      rate
    )
  }

  const pendingNested: UsageEvent[] = []

  const checkpoint = async (record: RunStepRecord): Promise<RunCounters> => {
    let credits = await creditsFor(record)
    for (const nested of pendingNested.splice(0)) {
      credits += await creditsFor(nested)
    }
    const updated = await db.transaction(async (tx) => {
      const row = await tx
        .update(schema.agentRun)
        .set({
          steps: record.step,
          inputTokens: sql`${schema.agentRun.inputTokens} + ${record.inputTokens ?? 0}`,
          outputTokens: sql`${schema.agentRun.outputTokens} + ${record.outputTokens ?? 0}`,
          toolCalls: sql`${schema.agentRun.toolCalls} + ${record.toolCalls}`,
          toolOutputBytes: sql`${schema.agentRun.toolOutputBytes} + ${record.toolOutputBytes}`,
          creditsSpent: sql`${schema.agentRun.creditsSpent} + ${credits}`,
        })
        .where(
          and(
            eq(schema.agentRun.id, runId),
            eq(schema.agentRun.leaseOwner, WORKER_ID),
            eq(schema.agentRun.state, "working")
          )
        )
        .returning(COUNTER_SELECTION)
        .then((r) => r[0])
      if (!row) throw new LeaseLostError()
      await tx
        .insert(schema.agentRunStep)
        .values({
          runId,
          step: record.step,
          messages: record.messages as unknown[],
          model: record.model ?? null,
          inputTokens: record.inputTokens ?? null,
          cachedInputTokens: record.cachedInputTokens ?? null,
          outputTokens: record.outputTokens ?? null,
          reasoningTokens: record.reasoningTokens ?? null,
          toolCalls: record.toolCalls,
          toolOutputBytes: record.toolOutputBytes,
        })
        .onConflictDoNothing()
      return row
    })
    counters = countersOf(updated)
    return counters
  }

  let resume: ResumeState | null = null
  if (claimed.context && claimed.instructions) {
    const stepRows = await db
      .select()
      .from(schema.agentRunStep)
      .where(eq(schema.agentRunStep.runId, runId))
      .orderBy(asc(schema.agentRunStep.step))
    const stepMessages = stepRows.flatMap((r) => r.messages as ModelMessage[])
    const userMessage = await buildInitialUserMessage(claimed.context)
    resume = {
      messages: [userMessage, ...stepMessages],
      instructions: claimed.instructions,
      counters,
      answerTextSoFar: assistantText(stepMessages),
      lastInputTokens: stepRows.at(-1)?.inputTokens ?? 0,
      conversation: claimed.context.conversation,
      trail: await loadTrailSeed(runId),
    }
  }

  const handle: RunHandle = {
    budgets: {
      steps: claimed.budgetSteps,
      inputTokens: claimed.budgetInputTokens,
      outputTokens: claimed.budgetOutputTokens,
      toolCalls: claimed.budgetToolCalls,
      toolOutputBytes: claimed.budgetToolOutputBytes,
      credits: claimed.budgetCredits,
      deadlineAt:
        claimed.deadlineAt ?? new Date(now.getTime() + claimed.budgetWallMs),
    },
    resume,
    saveContext: async ({ context, instructions }) => {
      const row = await db
        .update(schema.agentRun)
        .set({ context, instructions })
        .where(
          and(
            eq(schema.agentRun.id, runId),
            eq(schema.agentRun.leaseOwner, WORKER_ID),
            eq(schema.agentRun.state, "working")
          )
        )
        .returning({ id: schema.agentRun.id })
        .then((r) => r[0])
      if (!row) {
        abort.abort()
        throw new LeaseLostError()
      }
    },
    checkpoint: (record) =>
      checkpoint(record).catch((err) => {
        if (err instanceof LeaseLostError) abort.abort()
        throw err
      }),
    toolResults: {
      get: async (toolKey) => {
        const row = await db
          .select({ output: schema.agentRunToolResult.output })
          .from(schema.agentRunToolResult)
          .where(
            and(
              eq(schema.agentRunToolResult.runId, runId),
              eq(schema.agentRunToolResult.toolKey, toolKey)
            )
          )
          .then((r) => r[0])
        return row ? (row.output ?? undefined) : undefined
      },
      put: async (toolKey, toolName, output) => {
        await db
          .insert(schema.agentRunToolResult)
          .values({ runId, toolKey, toolName, output })
          .onConflictDoNothing()
      },
    },
    abortSignal: abort.signal,
  }

  return {
    kind: "claimed",
    execution: {
      runId,
      workspaceId: claimed.workspaceId,
      writer,
      handle,
      resume,
      counters: () => counters,
      noteNestedUsage: (u) => {
        pendingNested.push(u)
      },
      // Write-back runs after the answer is terminal, so this folds without a
      // lease guard — it only feeds observability and the skip floor.
      addUsage: (u) => {
        void (async () => {
          const credits = await creditsFor(u)
          await db
            .update(schema.agentRun)
            .set({
              inputTokens: sql`${schema.agentRun.inputTokens} + ${u.inputTokens ?? 0}`,
              outputTokens: sql`${schema.agentRun.outputTokens} + ${u.outputTokens ?? 0}`,
              creditsSpent: sql`${schema.agentRun.creditsSpent} + ${credits}`,
            })
            .where(eq(schema.agentRun.id, runId))
        })().catch((err) =>
          logger.warn({ err, runId }, "Agent run usage fold failed")
        )
      },
      setPhase: async (phase) => {
        await db
          .update(schema.agentRun)
          .set({ phase })
          .where(eq(schema.agentRun.id, runId))
          .catch(() => {})
      },
      aborted: () => abort.signal.aborted,
      stop: () => clearInterval(heartbeat),
    },
  }
}
