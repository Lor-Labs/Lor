import { computeCredits, getRate } from "@repo/billing"
import {
  and,
  asc,
  db,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  LOR_USER_ID,
  lt,
  ne,
  notExists,
  notInArray,
  or,
  schema,
  sql,
} from "@repo/db"
import { chatFeedMessage } from "@repo/db/queries/agent-sessions"
import type {
  AgentRunContext,
  LorMemory,
  LorReasoningSegment,
  LorToolCall,
} from "@repo/db/schema"
import {
  type ConversationUpdate,
  type RunCounters,
  type RunHandle,
  type RunResume,
  type RunTurnRecord,
  type UsageEvent,
  userDisplayName,
} from "@repo/lor"
import { type HarnessOwner, SessionCoreError } from "@repo/lor/session-core"
import { writeHarnessState } from "@/lib/harness-state"
import { logger } from "@/lib/logger"
import { createRunEventWriter, type RunEventWriter } from "@/lib/run-events"
import { WORKER_ID } from "@/lib/worker-id"
import { notifyWorkspaceActivity } from "@/lib/workspace-activity"

const LEASE_TTL_MS = 60_000
const HEARTBEAT_MS = 20_000
// Sequence gap left when taking over a crashed attempt, so recovered frames
// can never collide with the dead worker's un-flushed live tail.
const TAKEOVER_SEQ_GAP = 10_000

// Attachment-only messages have null content; render their files as the same
// [file: …] lines the initial context uses so mid-run injections carry them.
function withAttachmentLines(
  content: string | null,
  attachments:
    | { url: string; filename: string; size: number; contentType: string }[]
    | null
): string {
  const lines = (attachments ?? []).map(
    (a) =>
      `[file: ${a.filename} — ${a.contentType}, ${a.size} bytes — ${a.url}]`
  )
  return [content ?? "", ...lines].filter(Boolean).join("\n")
}

// Runs this process currently holds a lease on, keyed to their immediate-stop
// trigger. The pub/sub subscriber (worker bootstrap) routes stop signals here.
const activeRunStops = new Map<string, () => void>()

export function signalRunStop(runId: string) {
  activeRunStops.get(runId)?.()
}

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
  toolCalls: LorToolCall[]
  reasoning: string
  reasoningSegments: LorReasoningSegment[]
  remembered: LorMemory[]
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
  // Saves a finished Pi turn for the conversation `owner` (RunHarness.saveTurn).
  saveTurn: (owner: HarnessOwner, turn: RunTurnRecord) => Promise<RunCounters>
  // Nested billable usage (investigate_code) folds into the turn's save.
  noteNestedUsage: (u: UsageEvent) => void
  // Post-answer usage (write-back) folds straight into the counters.
  addUsage: (u: UsageEvent) => void
  // Persists the predecessor pointer; recovery combines it with this run's
  // saved context to replay the predecessor chain instead of rebuilding fresh.
  markContinuedFrom: (predecessorRunId: string) => Promise<void>
  setPhase: (phase: "answer" | "writeback") => Promise<void>
  // Fresh runs call this right after loading the conversation snapshot: steer
  // rows that predate the snapshot are already in it, so they're consumed
  // here instead of being injected again at the first boundary.
  markConversationLoaded: () => Promise<void>
  aborted: () => boolean
  stop: () => void
}

// Live-socket hook for steer injections (the event log gets the durable copy;
// this lets the processor emit the frame to the room).
export type ClaimHooks = {
  onSteered?: (e: {
    messageId: string
    authorName: string
    seq?: number
  }) => void
}

export type ClaimOutcome =
  | { kind: "legacy" }
  | { kind: "terminal" }
  | { kind: "exhausted" }
  | { kind: "claimed"; execution: RunExecution }

function countersOf(row: {
  steps: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  toolCalls: number
  toolOutputBytes: number
  creditsSpent: number
}): RunCounters {
  return {
    steps: row.steps,
    inputTokens: row.inputTokens,
    cachedInputTokens: row.cachedInputTokens,
    outputTokens: row.outputTokens,
    toolCalls: row.toolCalls,
    toolOutputBytes: row.toolOutputBytes,
    creditsSpent: row.creditsSpent,
  }
}

const COUNTER_SELECTION = {
  steps: schema.agentRun.steps,
  inputTokens: schema.agentRun.inputTokens,
  cachedInputTokens: schema.agentRun.cachedInputTokens,
  outputTokens: schema.agentRun.outputTokens,
  toolCalls: schema.agentRun.toolCalls,
  toolOutputBytes: schema.agentRun.toolOutputBytes,
  creditsSpent: schema.agentRun.creditsSpent,
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
        {
          path: payload.path,
          action: payload.action,
          ...(payload.nodeId ? { nodeId: payload.nodeId } : {}),
        },
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
  runId: string | undefined,
  hooks: ClaimHooks = {}
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
        .returning({ workspaceId: schema.agentRun.workspaceId })
        .then((r) => {
          if (r[0]) notifyWorkspaceActivity(r[0].workspaceId)
        })
        .catch(() => {})
      return { kind: "exhausted" }
    }
    // A live lease elsewhere — that worker owns the answer.
    return { kind: "terminal" }
  }

  // queued → working changes the channel's sidebar aggregate (a takeover
  // re-emit is harmless — the snapshot recomputes and clients dedupe).
  notifyWorkspaceActivity(claimed.workspaceId)

  const writer = createRunEventWriter({
    runId,
    workerId: WORKER_ID,
    initialSeq: claimed.nextSeq,
  })
  const abort = new AbortController()
  // User stop gets its own controller so the graceful path (keep the partial
  // answer, settle as stopped) is distinguishable from a lost lease (exit
  // silently — another attempt owns the message).
  const stopAbort = new AbortController()
  let counters = countersOf(claimed)
  let stopRequested = claimed.stopRequestedAt != null
  const requestStop = () => {
    stopRequested = true
    stopAbort.abort()
  }
  activeRunStops.set(runId, requestStop)
  // Stop was requested while this run sat unclaimed (or before a recovery
  // takeover) — honor it immediately rather than at the first boundary.
  if (stopRequested) stopAbort.abort()
  // Ambient-refresh watermark. Fresh runs start at claim time — the snapshot
  // loads moments later, so a message landing in that window may be seen
  // twice (harmless), never missed. Resumed runs restart from run start,
  // re-reading what the dead attempt saw rather than losing it.
  let conversationSeenAt = claimed.context ? (claimed.startedAt ?? now) : now

  // The stop flag rides the heartbeat and every checkpoint, so a working run
  // notices within one step boundary or one heartbeat, whichever is sooner.
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
      .returning({
        id: schema.agentRun.id,
        stopRequestedAt: schema.agentRun.stopRequestedAt,
      })
      .then((r) => {
        if (!r[0]) {
          logger.warn({ runId }, "Agent run lease lost; aborting attempt")
          clearInterval(heartbeat)
          activeRunStops.delete(runId)
          abort.abort()
          return
        }
        if (r[0].stopRequestedAt) requestStop()
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
  let runContext = claimed.context

  // One transaction: the Pi log under the lease and head checks, the approval
  // set a paused turn waits on, then the run counters, including nested
  // usage noted during the turn.
  const saveTurn = async (
    owner: HarnessOwner,
    turn: RunTurnRecord
  ): Promise<RunCounters> => {
    let credits = await creditsFor({
      ...(turn.model ? { model: turn.model } : {}),
      inputTokens: turn.inputTokens,
      cachedInputTokens: turn.cachedInputTokens,
      outputTokens: turn.outputTokens,
    })
    for (const nested of pendingNested.splice(0)) {
      credits += await creditsFor(nested)
    }
    const row = await db
      .transaction(async (tx) => {
        if (turn.save) {
          await writeHarnessState(tx, {
            ...turn.save,
            owner,
            workspaceId: claimed.workspaceId,
            claim: { runId, attempt: claimed.attempt },
          })
        }
        if (turn.approvals.length > 0) {
          await tx.insert(schema.approval).values(
            turn.approvals.map((approval) => ({
              ...approval,
              workspaceId: claimed.workspaceId,
              runId,
              planId: turn.planId,
            }))
          )
        }
        const updated = await tx
          .update(schema.agentRun)
          .set({
            steps: sql`${schema.agentRun.steps} + ${turn.steps}`,
            inputTokens: sql`${schema.agentRun.inputTokens} + ${turn.inputTokens}`,
            cachedInputTokens: sql`${schema.agentRun.cachedInputTokens} + ${turn.cachedInputTokens}`,
            outputTokens: sql`${schema.agentRun.outputTokens} + ${turn.outputTokens}`,
            toolCalls: sql`${schema.agentRun.toolCalls} + ${turn.toolCalls}`,
            toolOutputBytes: sql`${schema.agentRun.toolOutputBytes} + ${turn.toolOutputBytes}`,
            creditsSpent: sql`${schema.agentRun.creditsSpent} + ${credits}`,
            ...(turn.pausedSandbox
              ? {
                  context: sql`coalesce(${schema.agentRun.context}, '{}'::jsonb) || ${JSON.stringify({ pausedSandbox: turn.pausedSandbox })}::jsonb`,
                }
              : {}),
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
        if (!updated) throw new LeaseLostError()
        return updated
      })
      .catch((err: unknown) => {
        if (
          err instanceof LeaseLostError ||
          (err instanceof SessionCoreError && err.code === "lease_lost")
        ) {
          abort.abort()
          throw new LeaseLostError()
        }
        throw err
      })
    counters = countersOf(row)
    return counters
  }

  // A retried attempt sends the saved request again from the last saved Pi
  // head; the lost attempt's turn is gone (pi-harness-runbook.md §4.3).
  const resume: ResumeState | null = claimed.context
    ? {
        context: claimed.context,
        counters,
        conversation: claimed.context.conversation,
        trail: await loadTrailSeed(runId),
      }
    : null

  // Consume steer rows and gather ambient conversation activity for the next
  // step boundary. Steered rows are the guaranteed tier: consumed
  // transactionally with the fetch, replayed via the checkpoint they ride.
  const drainConversation = async (): Promise<ConversationUpdate> => {
    const steered = await db.transaction(async (tx) => {
      // consumedAtStep = the step whose checkpoint will carry the injection;
      // a takeover requeues consumed rows past the last durable step.
      const consumed = await tx
        .update(schema.agentRunQueue)
        .set({ state: "consumed", consumedAtStep: counters.steps + 1 })
        .where(
          and(
            eq(schema.agentRunQueue.runId, runId),
            eq(schema.agentRunQueue.state, "steered")
          )
        )
        .returning({
          messageId: schema.agentRunQueue.messageId,
          createdAt: schema.agentRunQueue.createdAt,
        })
      if (consumed.length === 0) return []
      const rows = await tx
        .select({
          id: schema.message.id,
          content: schema.message.content,
          attachments: schema.message.attachments,
          name: schema.user.name,
        })
        .from(schema.message)
        .innerJoin(schema.user, eq(schema.message.authorId, schema.user.id))
        .where(
          inArray(
            schema.message.id,
            consumed.map((c) => c.messageId)
          )
        )
      const order = new Map(consumed.map((c, i) => [c.messageId, i]))
      return rows
        .filter((r) => r.content || (r.attachments?.length ?? 0) > 0)
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
        .map((r) => ({
          messageId: r.id,
          authorName: userDisplayName(r),
          content: withAttachmentLines(r.content, r.attachments),
        }))
    })
    for (const m of steered) {
      const seq = writer.append({
        kind: "steer",
        messageId: m.messageId,
        authorName: m.authorName,
      })
      hooks.onSteered?.({
        messageId: m.messageId,
        authorName: m.authorName,
        seq,
      })
    }

    // Ambient tier: whatever else landed in the run's scope since the last
    // boundary — context only, no delivery guarantee.
    const scopeCond = claimed.threadRootId
      ? eq(schema.message.threadRootId, claimed.threadRootId)
      : and(eq(schema.message.channelId, claimed.channelId), chatFeedMessage())
    const ambientRows = await db
      .select({
        id: schema.message.id,
        content: schema.message.content,
        attachments: schema.message.attachments,
        createdAt: schema.message.createdAt,
        name: schema.user.name,
      })
      .from(schema.message)
      .innerJoin(schema.user, eq(schema.message.authorId, schema.user.id))
      .where(
        and(
          scopeCond,
          gt(schema.message.createdAt, conversationSeenAt),
          ne(schema.message.authorId, LOR_USER_ID),
          or(
            isNotNull(schema.message.content),
            sql`jsonb_array_length(coalesce(${schema.message.attachments}, '[]'::jsonb)) > 0`
          ),
          eq(schema.message.excludedFromMemory, false),
          (runContext?.coveredMessageIds?.length ?? 0) > 0
            ? notInArray(schema.message.id, runContext?.coveredMessageIds ?? [])
            : sql`true`,
          // Routed messages ride the steer/queue path — never both tiers.
          notExists(
            db
              .select({ id: schema.agentRunQueue.id })
              .from(schema.agentRunQueue)
              .where(eq(schema.agentRunQueue.messageId, schema.message.id))
          )
        )
      )
      .orderBy(asc(schema.message.createdAt))
      .limit(20)
      .catch(() => [])
    const newest = ambientRows.at(-1)
    if (newest) conversationSeenAt = newest.createdAt
    return {
      steered,
      ambient: ambientRows.map((r) => ({
        messageId: r.id,
        authorName: userDisplayName(r),
        content: withAttachmentLines(r.content, r.attachments),
      })),
    }
  }

  const handle: RunHandle = {
    runId,
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
      runContext = context
    },
    drainConversation,
    stopRequested: () => stopRequested,
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
    abortSignal: AbortSignal.any([abort.signal, stopAbort.signal]),
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
      saveTurn,
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
              cachedInputTokens: sql`${schema.agentRun.cachedInputTokens} + ${u.cachedInputTokens ?? 0}`,
              outputTokens: sql`${schema.agentRun.outputTokens} + ${u.outputTokens ?? 0}`,
              creditsSpent: sql`${schema.agentRun.creditsSpent} + ${credits}`,
            })
            .where(eq(schema.agentRun.id, runId))
        })().catch((err) =>
          logger.warn({ err, runId }, "Agent run usage fold failed")
        )
      },
      markContinuedFrom: async (predecessorRunId) => {
        const row = await db
          .update(schema.agentRun)
          .set({ continuedFromRunId: predecessorRunId })
          .where(
            and(
              eq(schema.agentRun.id, runId),
              eq(schema.agentRun.leaseOwner, WORKER_ID),
              eq(schema.agentRun.state, "working")
            )
          )
          .returning({ id: schema.agentRun.id })
          .then((rows) => rows[0])
        if (!row) {
          abort.abort()
          throw new LeaseLostError()
        }
      },
      setPhase: async (phase) => {
        await db
          .update(schema.agentRun)
          .set({ phase })
          .where(eq(schema.agentRun.id, runId))
          .catch(() => {})
      },
      // Steer rows that predate the just-loaded snapshot are already in it —
      // consume them so the first boundary doesn't inject duplicates. (Resumed
      // runs skip this: their snapshot is old, so pending rows must inject.)
      markConversationLoaded: async () => {
        await db
          .update(schema.agentRunQueue)
          .set({ state: "consumed", consumedAtStep: 0 })
          .where(
            and(
              eq(schema.agentRunQueue.runId, runId),
              eq(schema.agentRunQueue.state, "steered")
            )
          )
          .catch((err) =>
            logger.warn({ err, runId }, "Steer snapshot sweep failed")
          )
      },
      aborted: () => abort.signal.aborted,
      stop: () => {
        clearInterval(heartbeat)
        activeRunStops.delete(runId)
      },
    },
  }
}
