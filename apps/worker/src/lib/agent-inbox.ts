import { checkCredits, recordUsage } from "@repo/billing"
import {
  and,
  db,
  desc,
  eq,
  inArray,
  isNotNull,
  isUniqueViolation,
  LOR_USER_ID,
  notInArray,
  schema,
} from "@repo/db"
import { workspaceBetaAccess } from "@repo/db/queries/beta-access"
import { env } from "@repo/env/server"
import { type ModelMessage, respond, writeBack } from "@repo/lor"
import { saveHandoffNote } from "@repo/lor/act-runs"
import {
  AGENT_DEFAULT_MODEL,
  appendSteps,
  COMPACT_AT_TOKENS,
  COMPACT_IDLE_MS,
  loadAgentContext,
  pausedAgentRun,
  turnHeader,
} from "@repo/lor/agent-loop"
import {
  hasPendingWake,
  type InboxBatch,
  loadInboxBatch,
  markInboxRead,
  type RunAgentContext,
} from "@repo/lor/channel-agent"
import { LoopProposalError, type ProposeLoopExecutor } from "@repo/lor/loops"
import {
  ProposalRefusedError,
  type ProposeChangeExecutor,
} from "@repo/lor/proposals"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import {
  AGENT_COMPACT_JOB,
  AGENT_INBOX_FLUSH_JOB,
  AGENT_TURN_JOB,
  type AgentCompactJobData,
  type AgentInboxFlushJobData,
  type AgentTurnJobData,
  type LorRespondJobData,
} from "@repo/realtime-types/queues"
import {
  channelRoom,
  threadRoom,
  workspaceRoom,
} from "@repo/realtime-types/rooms"
import type { Emitter } from "@socket.io/redis-emitter"
import type { Job, Queue } from "bullmq"
import type { createClient } from "redis"
import {
  claimAgentRun,
  delayJobUntil,
  LeaseLostError,
  type RunExecution,
} from "@/lib/agent-run"
import { agentSessionExecutors } from "@/lib/agent-session-tools"
import {
  notifyApprovalParked,
  scheduleApprovalEscalation,
} from "@/lib/approval-notify"
import { createProposalCard } from "@/lib/change-proposal"
import { logger } from "@/lib/logger"
import { agentCompleteLoop, settleLoopRun } from "@/lib/loop-session"
import { createLoopCard } from "@/lib/lor-loop"
import { postLorMessage } from "@/lib/lor-messages"
import { loadPausedDecisions } from "@/lib/paused-turn"
import { notifyWorkspaceActivity } from "@/lib/workspace-activity"

type RedisClient = ReturnType<typeof createClient>

export type AgentQueueData =
  | AgentInboxFlushJobData
  | AgentTurnJobData
  | AgentCompactJobData

export type AgentDeps = {
  emitter: Emitter<ServerToClientEvents>
  redis: RedisClient
  queue: Queue<AgentQueueData>
  // Starts the turns of the code sessions the agent runs.
  respondQueue: Queue<LorRespondJobData>
}

export type InboxFlushOutcome =
  | "started"
  | "resumed"
  | "busy"
  | "empty"
  | "skipped"
  | "failed"

const OUT_OF_CREDITS_MESSAGE =
  "This workspace is out of Lor credits. An admin can top up in Settings → Billing."
const FAILED_MESSAGE =
  "Something went wrong and I stopped before finishing. Mention me to try again."
const APPROVAL_MESSAGE = "I need an approval before I go on."
// A turn that already went on after a decision and paused again.
const ANOTHER_APPROVAL_MESSAGE = "One more approval before I go on."

// "Lor is typing" in the chat, or the thread the turn answers in, while a
// turn runs: clients drop a typer 5s after their last signal, or when their
// message arrives.
const TYPING_EVERY_MS = 3_000

function showTyping(
  deps: AgentDeps,
  channelId: string,
  threadRootId: string | null
) {
  let pausedUntil = 0
  const emit = () => {
    if (Date.now() < pausedUntil) return
    deps.emitter
      .to(threadRootId ? threadRoom(threadRootId) : channelRoom(channelId))
      .emit("typing:update", {
        channelId,
        threadRootId,
        userId: LOR_USER_ID,
        name: "Lor",
      })
  }
  emit()
  const timer = setInterval(emit, TYPING_EVERY_MS)
  return {
    // After a post the turn usually just ends; typing resumes if it goes on.
    pause: () => {
      pausedUntil = Date.now() + 2 * TYPING_EVERY_MS
    },
    stop: () => clearInterval(timer),
  }
}

const TURN_JOB_OPTIONS = {
  attempts: 2,
  // Longer than the run lease (60s), so a retry can reclaim a crashed attempt.
  backoff: { type: "fixed" as const, delay: 90_000 },
  removeOnComplete: true,
  removeOnFail: 100,
}

async function activeAgentRun(channelId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.agentRun.id })
    .from(schema.agentRun)
    .where(
      and(
        eq(schema.agentRun.scopeKey, channelId),
        inArray(schema.agentRun.state, ["queued", "working", "finalizing"])
      )
    )
    .limit(1)
  return Boolean(row)
}

async function pendingApproval(runId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.approval.id })
    .from(schema.approval)
    .where(
      and(
        eq(schema.approval.runId, runId),
        eq(schema.approval.status, "pending")
      )
    )
    .limit(1)
  return Boolean(row)
}

// A turn's run holds the channel's scope (one active run per scope), and its
// inbox step and the items it read commit with it. Null when another run
// holds the scope.
async function createTurnRun(args: {
  workspaceId: string
  channelId: string
  triggerMessageId: string | null
  batch: InboxBatch | null
  // The Loop whose fire this turn answers: its run in the Loop's history.
  loop?: { id: string; scheduledFor: Date | null } | null
}): Promise<string | null> {
  const loop = args.loop ?? args.batch?.loop ?? null
  try {
    return await db.transaction(async (tx) => {
      const [run] = await tx
        .insert(schema.agentRun)
        .values({
          workspaceId: args.workspaceId,
          channelId: args.channelId,
          scopeKey: args.channelId,
          threadRootId: null,
          messageId: null,
          triggerMessageId: args.triggerMessageId,
          ...(loop ? { loopId: loop.id, scheduledFor: loop.scheduledFor } : {}),
          budgetWallMs: env.AGENT_RUN_MAX_WALL_MS,
          budgetCredits: env.AGENT_RUN_MAX_CREDITS,
        })
        .returning({ id: schema.agentRun.id })
      if (!run) throw new Error("Agent run insert returned no row")
      if (args.batch) {
        const context = await loadAgentContext(args.workspaceId, args.channelId)
        await appendSteps(tx, {
          workspaceId: args.workspaceId,
          channelId: args.channelId,
          epoch: context.epoch,
          runId: run.id,
          steps: [
            {
              kind: "inbox",
              message: {
                role: "user",
                content: `${turnHeader(new Date())}\n\n${args.batch.text}`,
              },
            },
          ],
        })
        await markInboxRead(tx, args.batch.itemIds, run.id)
        // The delivery log points at the turn that read each event.
        if (args.batch.deliveryIds.length > 0) {
          await tx
            .update(schema.triggerDelivery)
            .set({ runId: run.id })
            .where(inArray(schema.triggerDelivery.id, args.batch.deliveryIds))
        }
      }
      return run.id
    })
  } catch (err) {
    if (isUniqueViolation(err)) return null
    throw err
  }
}

// Reads one channel's inbox: starts a turn for its pending items, or lets a
// turn paused on approvals go on once they are all decided. One turn at a
// time; whatever arrives meanwhile waits for the next flush
// (reference/always-on-agents.md §3).
export async function flushAgentInbox(
  deps: AgentDeps,
  channelId: string
): Promise<InboxFlushOutcome> {
  const [channel] = await db
    .select({
      id: schema.channel.id,
      workspaceId: schema.channel.workspaceId,
      type: schema.channel.type,
      archivedAt: schema.channel.archivedAt,
    })
    .from(schema.channel)
    .where(eq(schema.channel.id, channelId))
  if (!channel?.workspaceId || channel.type !== "text" || channel.archivedAt) {
    return "skipped"
  }
  const workspaceId = channel.workspaceId
  if ((await workspaceBetaAccess(workspaceId)).state !== "active") {
    return "skipped"
  }
  if (await activeAgentRun(channelId)) return "busy"

  const paused = await pausedAgentRun(channelId)
  if (paused) {
    if (await pendingApproval(paused.runId)) return "busy"
    const [pausedRun] = await db
      .select({
        triggerMessageId: schema.agentRun.triggerMessageId,
        loopId: schema.agentRun.loopId,
      })
      .from(schema.agentRun)
      .where(eq(schema.agentRun.id, paused.runId))
    const runId = await createTurnRun({
      workspaceId,
      channelId,
      triggerMessageId: pausedRun?.triggerMessageId ?? null,
      batch: null,
      loop: pausedRun?.loopId
        ? { id: pausedRun.loopId, scheduledFor: null }
        : null,
    })
    if (!runId) return "busy"
    await enqueueTurn(deps, workspaceId, { channelId, runId })
    return "resumed"
  }

  // A fire of a Loop paused, completed or deleted since is not read.
  await db
    .update(schema.agentInbox)
    .set({ status: "read", readAt: new Date() })
    .where(
      and(
        eq(schema.agentInbox.channelId, channelId),
        eq(schema.agentInbox.status, "pending"),
        isNotNull(schema.agentInbox.loopId),
        notInArray(
          schema.agentInbox.loopId,
          db
            .select({ id: schema.loop.id })
            .from(schema.loop)
            .where(eq(schema.loop.status, "active"))
        )
      )
    )
  const batch = await loadInboxBatch(channelId)
  if (!batch) return "empty"
  const runId = await createTurnRun({
    workspaceId,
    channelId,
    triggerMessageId: batch.triggerMessageId,
    batch,
  })
  if (!runId) return "busy"
  await enqueueTurn(deps, workspaceId, { channelId, runId })
  return "started"
}

async function enqueueTurn(
  deps: AgentDeps,
  workspaceId: string,
  data: AgentTurnJobData
) {
  notifyWorkspaceActivity(workspaceId)
  try {
    await deps.queue.add(AGENT_TURN_JOB, data, {
      ...TURN_JOB_OPTIONS,
      jobId: data.runId,
    })
  } catch (err) {
    // Unwind: the items go back to pending and the next flush retries.
    logger.error({ err, runId: data.runId }, "Agent turn enqueue failed")
    await db.transaction(async (tx) => {
      await tx
        .update(schema.agentInbox)
        .set({ status: "pending", readAt: null, runId: null })
        .where(eq(schema.agentInbox.runId, data.runId))
      await tx
        .delete(schema.agentStep)
        .where(eq(schema.agentStep.runId, data.runId))
      await tx.delete(schema.agentRun).where(eq(schema.agentRun.id, data.runId))
    })
    throw err
  }
}

async function flushIfWaiting(deps: AgentDeps, channelId: string) {
  if (!(await hasPendingWake(channelId))) return
  await deps.queue
    .add(AGENT_INBOX_FLUSH_JOB, { channelId })
    .catch((err) =>
      logger.error({ err, channelId }, "Agent inbox re-flush failed")
    )
}

function sentText(messages: ModelMessage[]): string[] {
  return messages.flatMap((message) =>
    message.role === "assistant" && Array.isArray(message.content)
      ? message.content.flatMap((part) =>
          part.type === "tool-call" &&
          part.toolName === "send_message" &&
          typeof (part.input as { content?: unknown })?.content === "string"
            ? [(part.input as { content: string }).content]
            : []
        )
      : []
  )
}

function inboxText(messages: ModelMessage[]): string {
  const first = messages[0]
  return first?.role === "user" && typeof first.content === "string"
    ? first.content
    : ""
}

async function claim(job: Job, token: string | undefined, runId: string) {
  const outcome = await claimAgentRun(runId)
  if (outcome.kind === "busy") await delayJobUntil(job, token, outcome.retryAt)
  return outcome.kind === "claimed" ? outcome.execution : null
}

// propose_loop for the agent: a draft card in the chat, only in a turn a
// person started (a trigger or a Loop must not schedule more Loops).
function agentProposeLoop(
  deps: AgentDeps,
  channel: { id: string; workspaceId: string },
  askerId: string | null
): ProposeLoopExecutor {
  return (input) => {
    if (!askerId) {
      throw new LoopProposalError(
        "Nobody asked for this in the chat just now. Propose a Loop only when a person asks for one."
      )
    }
    return createLoopCard(deps, {
      workspaceId: channel.workspaceId,
      channelId: channel.id,
      threadRootId: null,
      creatorId: askerId,
      ...input,
    })
  }
}

// propose_workspace_change for the agent: the card posts in the chat (never
// in a thread: a decision on a thread card would continue a session there),
// only in a turn a person started.
function agentProposeChange(
  deps: AgentDeps,
  channel: { id: string; workspaceId: string },
  askerId: string | null
): ProposeChangeExecutor {
  return (input) => {
    if (!askerId) {
      throw new ProposalRefusedError(
        "Nobody asked for this in the chat just now. Propose workspace changes only when a person asks for them."
      )
    }
    return createProposalCard(deps, {
      workspaceId: channel.workspaceId,
      channelId: channel.id,
      threadRootId: null,
      ...input,
    })
  }
}

function agentHooks(
  deps: AgentDeps,
  execution: RunExecution,
  channel: { id: string; name: string | null; workspaceId: string },
  mode: RunAgentContext["mode"],
  onSent: () => void,
  // Who woke the turn, and the human thread it answers in (null: the chat).
  turn: { askerId: string | null; threadRootId: string | null } = {
    askerId: null,
    threadRootId: null,
  }
): RunAgentContext {
  return {
    channelName: channel.name,
    mode,
    sessions: agentSessionExecutors(deps, {
      workspaceId: channel.workspaceId,
      channelId: channel.id,
      channelName: channel.name,
      askerId: turn.askerId,
    }),
    completeLoop: agentCompleteLoop(deps, channel.id),
    sendMessage: async ({ content }) => {
      const posted = await postLorMessage(deps, {
        channelId: channel.id,
        content,
        type: "agent_post",
        ...(turn.threadRootId ? { threadRootId: turn.threadRootId } : {}),
      })
      onSent()
      return posted
    },
    recordUsage: (usage, kind) => execution.recordUsage(usage, kind),
    loadDecisions: async (pausedRunId) =>
      (await loadPausedDecisions(pausedRunId, execution.runId, null, false))
        .decisions,
  }
}

// One turn of a channel's agent, on its own loop (agent-loop.ts).
export async function runAgentTurnJob(
  deps: AgentDeps,
  job: Job<AgentTurnJobData>,
  token: string | undefined
): Promise<void> {
  const { runId, channelId } = job.data
  const execution = await claim(job, token, runId)
  if (!execution) return
  const writer = execution.writer
  const [channel] = await db
    .select({
      id: schema.channel.id,
      name: schema.channel.name,
      workspaceId: schema.channel.workspaceId,
      agentModel: schema.channel.agentModel,
      agentWakeMode: schema.channel.agentWakeMode,
    })
    .from(schema.channel)
    .where(eq(schema.channel.id, channelId))
  const [run] = await db
    .select({
      triggerMessageId: schema.agentRun.triggerMessageId,
      triggerAuthorId: schema.message.authorId,
      triggerContent: schema.message.content,
      triggerThreadRootId: schema.message.threadRootId,
      loopId: schema.agentRun.loopId,
    })
    .from(schema.agentRun)
    .leftJoin(
      schema.message,
      eq(schema.message.id, schema.agentRun.triggerMessageId)
    )
    .where(eq(schema.agentRun.id, runId))
  if (!channel?.workspaceId) {
    await writer.transition("failed", { stopReason: "error" })
    execution.stop()
    return
  }
  const workspaceId = channel.workspaceId
  const userId = run?.triggerAuthorId ?? undefined
  // A turn woken in a human thread answers there (loadInboxBatch keeps a
  // turn to one place, and its trigger is the first message that woke it).
  const threadRootId = run?.triggerThreadRootId ?? null
  let sent = false
  const notice = (content: string) =>
    postLorMessage(deps, {
      channelId,
      content,
      type: "agent_post",
      ...(threadRootId ? { threadRootId } : {}),
    }).catch((err) => logger.error({ err, runId }, "Agent notice failed"))
  // A Loop fire's turn counts toward the Loop's health: five failures in a
  // row pause it, with a line in the chat.
  const settleLoop = async (
    outcome: "complete" | "failed" | "stopped",
    stopReason?: string
  ) => {
    if (!run?.loopId) return
    await settleLoopRun(deps, run.loopId, null, {
      outcome,
      ...(stopReason ? { stopReason } : {}),
    }).catch((err) => logger.error({ err, runId }, "Loop settlement failed"))
  }

  try {
    const gate = await checkCredits(workspaceId)
    if (!gate.allowed) {
      // Said only to a person who asked: events and Loops would repeat it.
      if (userId) await notice(OUT_OF_CREDITS_MESSAGE)
      await writer.transition("failed", { stopReason: "out_of_credits" })
      execution.stop()
      await settleLoop("failed", "out_of_credits")
      deps.emitter
        .to(workspaceRoom(workspaceId))
        .emit("billing:updated", { workspaceId, reason: "out_of_credits" })
      return
    }
    // Typing only when a person addressed Lor: turns woken by an event, a
    // session's report or "every message" often end quiet. A person's id
    // marks a person's message (the trigger of a note-only turn is null).
    const addressed =
      Boolean(userId) &&
      (channel.agentWakeMode === "mention" ||
        Boolean(run?.triggerContent?.includes(`<@${LOR_USER_ID}>`)))
    const typing = addressed
      ? showTyping(deps, channelId, threadRootId)
      : { pause: () => {}, stop: () => {} }
    const result = await respond(
      {
        workspaceId,
        channelId,
        conversation: [],
        runId,
        ...(run?.triggerMessageId
          ? { triggerMessageId: run.triggerMessageId }
          : {}),
        ...(userId ? { userId } : {}),
        aiSessionId: channelId,
        turn: { model: channel.agentModel ?? AGENT_DEFAULT_MODEL },
        proposeLoop: agentProposeLoop(
          deps,
          { id: channelId, workspaceId },
          userId ?? null
        ),
        proposeChange: agentProposeChange(
          deps,
          { id: channelId, workspaceId },
          userId ?? null
        ),
        agent: agentHooks(
          deps,
          execution,
          { ...channel, workspaceId },
          "turn",
          () => {
            sent = true
            typing.pause()
          },
          { askerId: userId ?? null, threadRootId }
        ),
      },
      {
        onDelta: () => {},
        onUsage: (u) =>
          void recordUsage(u, {
            channelId,
            userId: userId ?? null,
            debitScope: runId,
          }),
      },
      execution.handle
    ).finally(() => typing.stop())
    const agent = result.agent

    // A turn paused on approvals: the set is filed under a message in the
    // chat that shows the cards, and a decision resumes it.
    let parkedApprovalId: string | null = null
    if (agent && agent.approvals.length > 0) {
      const [inbox] = await db
        .select({ id: schema.agentStep.id })
        .from(schema.agentStep)
        .where(
          and(
            eq(schema.agentStep.runId, runId),
            eq(schema.agentStep.kind, "inbox")
          )
        )
        .limit(1)
      const posted = await postLorMessage(deps, {
        channelId,
        content: inbox ? APPROVAL_MESSAGE : ANOTHER_APPROVAL_MESSAGE,
        type: "agent_post",
        ...(run?.triggerMessageId
          ? { lorTriggerMessageId: run.triggerMessageId }
          : {}),
      })
      const inserted = await db.transaction(async (tx) => {
        await tx
          .update(schema.agentRun)
          .set({ messageId: posted.messageId })
          .where(eq(schema.agentRun.id, runId))
        return tx
          .insert(schema.approval)
          .values(
            agent.approvals.map((approval) => ({
              ...approval,
              workspaceId,
              runId,
              planId: null,
            }))
          )
          .returning({ id: schema.approval.id })
      })
      parkedApprovalId = inserted[0]?.id ?? null
    }

    const stoppedByUser = result.stoppedFor === "stopped_by_user"
    await writer.transition(stoppedByUser ? "stopped" : "complete", {
      stopReason: result.stoppedFor ?? "completed",
    })
    execution.stop()
    await settleLoop(stoppedByUser ? "stopped" : "complete")

    if (parkedApprovalId) {
      deps.emitter.to(channelRoom(channelId)).emit("approval:created", {
        approvalId: parkedApprovalId,
        channelId,
        threadRootId: null,
        messageId:
          (
            await db
              .select({ messageId: schema.agentRun.messageId })
              .from(schema.agentRun)
              .where(eq(schema.agentRun.id, runId))
          )[0]?.messageId ?? null,
        planId: null,
      })
      try {
        const { scheduleEscalation } = await notifyApprovalParked(
          deps,
          parkedApprovalId
        )
        if (scheduleEscalation) {
          await scheduleApprovalEscalation(parkedApprovalId)
        }
      } catch (err) {
        logger.error(
          { err, approvalId: parkedApprovalId },
          "Agent approval notification failed"
        )
      }
    }
    notifyWorkspaceActivity(workspaceId)

    // What the turn said is its note in a Loop's or trigger's run history.
    const said = sentText(result.messages)
    if (said.length > 0) await saveHandoffNote(runId, said.join("\n\n"))

    // Today's memory pass, until the memory pass of slice 4 replaces it.
    if (result.messages.length > 0 && !stoppedByUser) {
      await writeBack(
        {
          workspaceId,
          channelId,
          priorMessages: result.messages,
          gateText: [
            inboxText(result.messages),
            ...said.map((s) => `Lor: ${s}`),
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
        {
          onUsage: (u) => {
            execution.addUsage(u)
            void recordUsage(u, { channelId, debitScope: runId })
          },
        }
      ).catch((err) => logger.warn({ err, runId }, "Agent write-back failed"))
    }

    if (agent && agent.promptTokens >= COMPACT_AT_TOKENS) {
      await deps.queue
        .add(
          AGENT_COMPACT_JOB,
          { channelId, afterRunId: runId },
          {
            delay: COMPACT_IDLE_MS,
            jobId: `compact-${runId}`,
            removeOnComplete: true,
            removeOnFail: 100,
          }
        )
        .catch((err) =>
          logger.error({ err, runId }, "Agent compaction scheduling failed")
        )
    }
  } catch (err) {
    if (err instanceof LeaseLostError || execution.aborted()) {
      logger.warn({ runId }, "Agent turn lost its lease")
      return
    }
    logger.error({ err, runId, channelId }, "Agent turn failed")
    // A retry continues from the saved steps; only the last attempt says so.
    if (job.attemptsMade + 1 < (job.opts.attempts ?? 1)) {
      execution.stop()
      throw err
    }
    // Said only to a person who asked: a Loop's or an event's turn fails
    // quietly, and its run history shows it (decision 30).
    if (!sent && userId) await notice(FAILED_MESSAGE)
    await writer.transition("failed", { stopReason: "error" })
    execution.stop()
    await settleLoop("failed", "error")
    notifyWorkspaceActivity(workspaceId)
  }
  await flushIfWaiting(deps, channelId)
}

// Summarizes a large conversation once it has been idle, while the cache is
// warm, unless something is about to wake the agent anyway
// (reference/always-on-agents.md §8).
export async function runAgentCompactJob(
  deps: AgentDeps,
  job: Job<AgentCompactJobData>,
  token: string | undefined
): Promise<void> {
  const { channelId, afterRunId } = job.data
  const [latest] = await db
    .select({ id: schema.agentRun.id })
    .from(schema.agentRun)
    .where(eq(schema.agentRun.scopeKey, channelId))
    .orderBy(desc(schema.agentRun.createdAt))
    .limit(1)
  // A later turn ran: it schedules its own compaction.
  if (latest?.id !== afterRunId) return
  if (await hasPendingWake(channelId)) return
  if (await pausedAgentRun(channelId)) return
  const [channel] = await db
    .select({
      id: schema.channel.id,
      name: schema.channel.name,
      workspaceId: schema.channel.workspaceId,
      agentModel: schema.channel.agentModel,
    })
    .from(schema.channel)
    .where(eq(schema.channel.id, channelId))
  if (!channel?.workspaceId) return
  const workspaceId = channel.workspaceId
  const context = await loadAgentContext(workspaceId, channelId)
  if (context.promptTokens < COMPACT_AT_TOKENS) return

  const runId = await createTurnRun({
    workspaceId,
    channelId,
    triggerMessageId: null,
    batch: null,
  })
  if (!runId) return
  const execution = await claim(job, token, runId)
  if (!execution) return
  try {
    const result = await respond(
      {
        workspaceId,
        channelId,
        conversation: [],
        runId,
        aiSessionId: channelId,
        // The epoch's model, so the summary reads its cache.
        turn: {
          model: context.model ?? channel.agentModel ?? AGENT_DEFAULT_MODEL,
        },
        // Unused here, but the summary call needs the turn's exact tool set.
        proposeLoop: agentProposeLoop(
          deps,
          { id: channelId, workspaceId },
          null
        ),
        proposeChange: agentProposeChange(
          deps,
          { id: channelId, workspaceId },
          null
        ),
        agent: agentHooks(
          deps,
          execution,
          { ...channel, workspaceId },
          "compact",
          () => {}
        ),
      },
      {
        onDelta: () => {},
        onUsage: (u) => void recordUsage(u, { channelId, debitScope: runId }),
      },
      execution.handle
    )
    logger.info(
      { channelId, compacted: result.agent?.compacted ?? false },
      "Agent compaction run ended"
    )
    await execution.writer.transition("complete", { stopReason: "completed" })
  } catch (err) {
    logger.error({ err, channelId }, "Agent compaction failed")
    await execution.writer.transition("failed", { stopReason: "error" })
  } finally {
    execution.stop()
  }
  await flushIfWaiting(deps, channelId)
}
