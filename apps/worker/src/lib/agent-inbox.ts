import { checkCredits, recordUsage } from "@repo/billing"
import {
  APP_USER_ID,
  and,
  asc,
  db,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  isUniqueViolation,
  LOR_USER_ID,
  lt,
  ne,
  notInArray,
  or,
  schema,
  sql,
} from "@repo/db"
import {
  loadConversation,
  recordConversationPost,
} from "@repo/db/queries/agent-conversations"
import { workspaceBetaAccess } from "@repo/db/queries/beta-access"
import { resolveChannelAccess } from "@repo/db/queries/channel-access"
import {
  autonomousUsesSubscription,
  channelRequestUserId,
  personalRequestHarness,
} from "@repo/db/queries/personal-accounts"
import { subscribeToThread } from "@repo/db/queries/thread-subscriptions"
import type { AgentConversation } from "@repo/db/schema"
import { env } from "@repo/env/server"
import { type ModelMessage, respond } from "@repo/lor"
import { saveHandoffNote } from "@repo/lor/act-runs"
import { resolveAgentFiles } from "@repo/lor/agent-files"
import {
  AGENT_DEFAULT_MODEL,
  appendSteps,
  COMPACT_AT_TOKENS,
  COMPACT_IDLE_MS,
  loadAgentContext,
  pausedAgentRun,
  recentChat,
  turnHeader,
} from "@repo/lor/agent-loop"
import { journalNotes } from "@repo/lor/agent-memory"
import {
  addInboxNote,
  hasPendingWake,
  type InboxBatch,
  loadInboxBatch,
  markInboxRead,
  type RunAgentContext,
  StaleInboxBatchError,
} from "@repo/lor/channel-agent"
import { openBlock, profileChangeNotes } from "@repo/lor/channel-profile"
import { CHECK_IN_MINUTES, CHECK_IN_NOTE } from "@repo/lor/check-in"
import {
  filesForDiscord,
  postAgentToDiscord,
  showDiscordTyping,
  startDiscordThread,
} from "@repo/lor/discord"
import { approvalCard } from "@repo/lor/discord-ui"
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
import { creatureById, isCreatureId } from "@repo/utils/bestiary"
import type { Emitter } from "@socket.io/redis-emitter"
import type { Job, Queue } from "bullmq"
import type { createClient } from "redis"
import { agentLoopExecutors } from "@/lib/agent-loops"
import { agentMessenger } from "@/lib/agent-messages"
import {
  claimAgentRun,
  delayJobUntil,
  LeaseLostError,
  type RunExecution,
} from "@/lib/agent-run"
import { agentSessionExecutors } from "@/lib/agent-session-tools"
import { agentWakeUpExecutors, wakeUpDueSoon } from "@/lib/agent-wake-ups"
import {
  notifyApprovalParked,
  scheduleApprovalEscalation,
} from "@/lib/approval-notify"
import { createProposalCard } from "@/lib/change-proposal"
import { logger } from "@/lib/logger"
import { agentCompleteLoop, settleLoopRun } from "@/lib/loop-session"
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
const PAUSED_OUT_OF_CREDITS_MESSAGE =
  "This workspace is out of Lor credits. The approved work will go on once an admin tops up in Settings → Billing."
// One notice per paused run; a pause that outlives this may say it again.
const PAUSED_CREDITS_NOTICE_MS = 7 * 24 * 60 * 60_000
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
  // Read on every beat: a turn that starts a thread moves there.
  place: { threadRootId: string | null },
  agent: { id: string; name: string }
) {
  let pausedUntil = 0
  let beats = 0
  const emit = () => {
    if (Date.now() < pausedUntil) return
    const threadRootId = place.threadRootId
    // Discord's typing lasts about 10s a call.
    if (beats++ % 3 === 0) void showDiscordTyping(channelId, threadRootId)
    deps.emitter
      .to(threadRootId ? threadRoom(threadRootId) : channelRoom(channelId))
      .emit("typing:update", {
        channelId,
        threadRootId,
        userId: LOR_USER_ID,
        name: agent.name,
        agentId: agent.id,
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

// The agent's creature works on every turn, quiet ones too, unlike typing:
// clients drop the state 15s after the last beat.
const WORKING_EVERY_MS = 10_000

function showWorking(deps: AgentDeps, channelId: string, agentId: string) {
  const emit = (working: boolean) =>
    deps.emitter
      .to(channelRoom(channelId))
      .emit("agent:working", { channelId, working, agentId })
  emit(true)
  const timer = setInterval(() => emit(true), WORKING_EVERY_MS)
  return () => {
    clearInterval(timer)
    emit(false)
  }
}

const TURN_JOB_OPTIONS = {
  attempts: 2,
  // Longer than the run lease (60s), so a retry can reclaim a crashed attempt.
  backoff: { type: "fixed" as const, delay: 90_000 },
  removeOnComplete: true,
  removeOnFail: 100,
}

async function activeAgentRun(conversationId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.agentRun.id })
    .from(schema.agentRun)
    .where(
      and(
        eq(schema.agentRun.scopeKey, conversationId),
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

// The agent's journal entries from its other conversations since `since`,
// those about the person who woke this turn first.
async function journalSince(
  args: {
    agentId: string
    conversationId: string
    triggerMessageId: string | null
  },
  since: Date
): Promise<string | null> {
  const author = args.triggerMessageId
    ? await db
        .select({ id: schema.message.authorId })
        .from(schema.message)
        .where(eq(schema.message.id, args.triggerMessageId))
        .then((rows) => rows[0]?.id ?? null)
    : null
  return journalNotes({
    agentId: args.agentId,
    here: { conversationId: args.conversationId },
    since,
    people: author ? [author] : [],
  })
}

const THREAD_SO_FAR_MESSAGES = 30

// What a request reads on its first turn, since its conversation has seen
// none of it: the thread it was addressed in, or the channel's latest chat.
async function requestBackdrop(
  channel: { id: string; name: string | null },
  threadRootId: string | null
): Promise<string | null> {
  if (!threadRootId) {
    const chat = await recentChat(channel.id)
    return chat
      ? `The latest messages in #${channel.name ?? "channel"}'s chat, word for word, for context. What woke you is below:\n${chat}`
      : null
  }
  const rows = await db
    .select({
      id: schema.message.id,
      content: schema.message.content,
      authorName: schema.user.name,
    })
    .from(schema.message)
    .innerJoin(schema.user, eq(schema.user.id, schema.message.authorId))
    .where(
      and(
        or(
          eq(schema.message.id, threadRootId),
          eq(schema.message.threadRootId, threadRootId)
        ),
        isNotNull(schema.message.content)
      )
    )
    .orderBy(desc(schema.message.createdAt))
    .limit(THREAD_SO_FAR_MESSAGES)
  return rows.length > 0
    ? `The thread so far, word for word, for context. What woke you is below:\n${rows
        .reverse()
        .map(
          (row) =>
            `${row.authorName}: ${row.content ?? ""}\n(message ${row.id})`
        )
        .join("\n")}`
    : null
}

// notesThrough: the profile-notes cursor before this run's opening advanced
// it, restored if the run is unwound.
type TurnRun = { runId: string; notesThrough?: Date | null }

class SupersededRunError extends Error {}

// A turn's run holds its conversation's scope (one active run per scope),
// and its inbox step and the items it read commit with it. Null when another
// run holds the scope.
async function createTurnRun(args: {
  workspaceId: string
  conversation: AgentConversation
  // The channel the turn is about and posts in by default; no id for a
  // turn about no chat.
  channel: { id: string | null; name: string | null }
  triggerMessageId: string | null
  batch: InboxBatch | null
  // The Loop whose fire this turn answers: its run in the Loop's history.
  loop?: { id: string; scheduledFor: Date | null } | null
  // Compaction: only while this is still the scope's latest run.
  afterRunId?: string
  resumeFromRunId?: string
}): Promise<TurnRun | null> {
  const conversationId = args.conversation.id
  const agentId = args.conversation.agentId
  const loop = args.loop ?? args.batch?.loop ?? null
  // The newest message carries what changed in the profile since the agent
  // last saw it and what is open now (reference/always-on-agents.md §4). A
  // conversation not frozen yet gets the profile in its snapshot instead.
  const notedAt = new Date()
  let opening: string | null = null
  let notesThrough: Date | null | undefined
  if (args.batch) {
    const context = await loadAgentContext(args.workspaceId, conversationId)
    notesThrough = context.notesThrough
    const since = context.notesThrough ?? context.compactedAt ?? new Date(0)
    const request = args.conversation.kind === "request"
    const [notes, journal, open, backdrop] = await Promise.all([
      context.system
        ? profileChangeNotes(agentId, request ? args.channel.id : null, since)
        : null,
      // What the agent noted in its other conversations and sessions
      // meanwhile: one journal under all of them (agents-and-chats.md, d. 25).
      context.system
        ? journalSince(
            {
              agentId,
              conversationId,
              triggerMessageId: args.triggerMessageId,
            },
            since
          )
        : null,
      openBlock(agentId),
      // A request is always about a chat.
      !context.system && request && args.channel.id
        ? requestBackdrop(
            { id: args.channel.id, name: args.channel.name },
            args.batch.threadRootId
          )
        : null,
    ])
    opening = [
      turnHeader(notedAt),
      notes,
      journal,
      open,
      backdrop,
      args.batch.text,
    ]
      .filter((part): part is string => Boolean(part))
      .join("\n\n")
  }
  try {
    return await db.transaction(async (tx) => {
      const previous = args.resumeFromRunId
        ? await tx
            .select({
              context: schema.agentRun.context,
              inferenceFunding: schema.agentRun.inferenceFunding,
              harnessAccount: schema.agentRun.harnessAccount,
            })
            .from(schema.agentRun)
            .where(
              and(
                eq(schema.agentRun.id, args.resumeFromRunId),
                eq(schema.agentRun.workspaceId, args.workspaceId),
                eq(schema.agentRun.conversationId, conversationId)
              )
            )
            .then((rows) => rows[0])
        : null
      const [run] = await tx
        .insert(schema.agentRun)
        .values({
          workspaceId: args.workspaceId,
          channelId: args.channel.id,
          scopeKey: conversationId,
          conversationId,
          threadRootId: null,
          messageId: null,
          triggerMessageId: args.triggerMessageId,
          ...(previous
            ? {
                context: previous.context,
                inferenceFunding: previous.inferenceFunding,
                harnessAccount: previous.harnessAccount,
              }
            : {}),
          ...(loop ? { loopId: loop.id, scheduledFor: loop.scheduledFor } : {}),
          budgetWallMs: env.AGENT_RUN_MAX_WALL_MS,
          budgetCredits: env.AGENT_RUN_MAX_CREDITS,
        })
        .returning({ id: schema.agentRun.id })
      if (!run) throw new Error("Agent run insert returned no row")
      // Checked once this run holds the scope, so no run can start between
      // the check and the insert.
      if (args.afterRunId) {
        const [previous] = await tx
          .select({ id: schema.agentRun.id })
          .from(schema.agentRun)
          .where(
            and(
              eq(schema.agentRun.scopeKey, conversationId),
              ne(schema.agentRun.id, run.id)
            )
          )
          .orderBy(desc(schema.agentRun.createdAt))
          .limit(1)
        if (previous?.id !== args.afterRunId) throw new SupersededRunError()
      }
      if (args.batch && opening) {
        const context = await loadAgentContext(args.workspaceId, conversationId)
        await appendSteps(tx, {
          workspaceId: args.workspaceId,
          conversationId,
          epoch: context.epoch,
          runId: run.id,
          steps: [
            { kind: "inbox", message: { role: "user", content: opening } },
          ],
        })
        // The opening's createdAt is its notes watermark: returnBatchToPending
        // restores the cursor from it when a later opening is dropped.
        await tx
          .update(schema.agentStep)
          .set({ createdAt: notedAt })
          .where(
            and(
              eq(schema.agentStep.runId, run.id),
              eq(schema.agentStep.kind, "inbox")
            )
          )
        await tx
          .update(schema.agentContext)
          .set({ notesThrough: notedAt })
          .where(eq(schema.agentContext.conversationId, conversationId))
        await markInboxRead(tx, args.batch.itemIds, run.id)
        // The delivery log points at the turn that read each event.
        if (args.batch.deliveryIds.length > 0) {
          await tx
            .update(schema.triggerDelivery)
            .set({ runId: run.id })
            .where(inArray(schema.triggerDelivery.id, args.batch.deliveryIds))
        }
        await tx
          .update(schema.agentConversation)
          .set({
            lastActivityAt: notedAt,
            // A turn of the own conversation reads everything unread, so it
            // is a check-in whatever woke it.
            ...(args.conversation.kind === "own"
              ? { checkedInAt: notedAt }
              : {}),
          })
          .where(eq(schema.agentConversation.id, conversationId))
      }
      return { runId: run.id, notesThrough }
    })
  } catch (err) {
    if (
      isUniqueViolation(err) ||
      err instanceof StaleInboxBatchError ||
      err instanceof SupersededRunError
    ) {
      return null
    }
    throw err
  }
}

// A turn's credit gate: subscription turns run on their own plan.
async function turnFunded(
  workspaceId: string,
  // The agent whose own settings pay when no person's plan does.
  agentId: string,
  run: {
    harnessAccount: { source: string } | null
    funding: unknown
    requestUserId: string | null
  }
): Promise<boolean> {
  const subscription = run.harnessAccount
    ? run.harnessAccount.source === "subscription"
    : !run.funding &&
      (run.requestUserId
        ? (await personalRequestHarness(workspaceId, run.requestUserId)) !==
          "pi"
        : await autonomousUsesSubscription(agentId))
  return subscription || (await checkCredits(workspaceId)).allowed
}

// A channel a turn of this agent can be about: a text channel, not
// archived, that the agent is in. Null otherwise (it was taken out since
// the item was queued). No channel id: the turn is about no chat (a Loop
// with none, reference/agents-and-chats.md §9), which an agent in no chat
// at all can run too.
async function turnChannel(
  agentId: string,
  channelId: string | null,
  workspaceId: string
): Promise<{
  id: string | null
  name: string | null
  workspaceId: string | null
  archivedAt: Date | null
} | null> {
  if (!channelId) {
    return { id: null, name: null, workspaceId, archivedAt: null }
  }
  const [row] = await db
    .select({
      id: schema.channel.id,
      name: schema.channel.name,
      workspaceId: schema.channel.workspaceId,
      archivedAt: schema.channel.archivedAt,
    })
    .from(schema.channel)
    .innerJoin(
      schema.channelAgent,
      and(
        eq(schema.channelAgent.channelId, schema.channel.id),
        eq(schema.channelAgent.agentId, agentId)
      )
    )
    .where(
      and(eq(schema.channel.id, channelId), eq(schema.channel.type, "text"))
    )
  return row && !row.archivedAt ? row : null
}

// Reads one conversation's inbox: starts a turn for its pending items, or
// lets a turn paused on approvals go on once they are all decided. One turn
// at a time in a conversation; whatever arrives meanwhile waits for the next
// flush (reference/always-on-agents.md §3). Other conversations of the same
// agent run beside it (reference/agents-and-chats.md, decision 28).
export async function flushAgentInbox(
  deps: AgentDeps,
  conversationId: string
): Promise<InboxFlushOutcome> {
  const conversation = await loadConversation(conversationId)
  if (!conversation) return "skipped"
  const workspaceId = conversation.workspaceId
  const agentId = conversation.agentId
  if ((await workspaceBetaAccess(workspaceId)).state !== "active") {
    return "skipped"
  }
  if (await activeAgentRun(conversationId)) return "busy"
  const paused = await pausedAgentRun(conversationId)
  if (paused) {
    if (await pendingApproval(paused.runId)) return "busy"
    const [pausedRun] = await db
      .select({
        channelId: schema.agentRun.channelId,
        triggerMessageId: schema.agentRun.triggerMessageId,
        loopId: schema.agentRun.loopId,
        funding: schema.agentRun.inferenceFunding,
        harnessAccount: schema.agentRun.harnessAccount,
        hasDeliveries: sql<boolean>`exists (select 1 from trigger_delivery d where d.run_id = ${schema.agentRun.id})`,
      })
      .from(schema.agentRun)
      .where(eq(schema.agentRun.id, paused.runId))
    const channel = pausedRun
      ? await turnChannel(agentId, pausedRun.channelId, workspaceId)
      : null
    // The agent left the channel the paused turn was about: it can't go on.
    if (!pausedRun || !channel) return "skipped"
    const channelId = channel.id
    // The continuation copies the pause's account and funding; it would meet
    // the same gate in runAgentTurn. Unfunded: say so once and keep the pause.
    const funded = await turnFunded(workspaceId, agentId, {
      harnessAccount: pausedRun.harnessAccount ?? null,
      funding: pausedRun.funding ?? null,
      requestUserId: pausedRun.harnessAccount
        ? pausedRun.harnessAccount.userId
        : pausedRun.loopId || pausedRun.hasDeliveries || !channelId
          ? null
          : await channelRequestUserId(
              channelId,
              pausedRun.triggerMessageId ?? null
            ),
    })
    if (!funded) {
      const first =
        (await deps.redis.set(`agent:paused-credits:${paused.runId}`, "1", {
          NX: true,
          PX: PAUSED_CREDITS_NOTICE_MS,
        })) === "OK"
      if (first) {
        // A turn about no chat has nowhere to say so.
        if (channelId) {
          await postLorMessage(deps, {
            channelId,
            content: PAUSED_OUT_OF_CREDITS_MESSAGE,
            type: "agent_post",
            agentId,
          })
            .then((posted) =>
              postAgentToDiscord({
                channelId,
                agentId,
                messageId: posted.messageId,
                content: PAUSED_OUT_OF_CREDITS_MESSAGE,
                threadRootId: null,
              })
            )
            .catch((err) =>
              logger.error({ err, channelId }, "Agent notice failed")
            )
        }
        deps.emitter
          .to(workspaceRoom(workspaceId))
          .emit("billing:updated", { workspaceId, reason: "out_of_credits" })
      }
      return "skipped"
    }
    const turnRun = await createTurnRun({
      workspaceId,
      conversation,
      channel,
      triggerMessageId: pausedRun.triggerMessageId ?? null,
      resumeFromRunId: paused.runId,
      batch: null,
      loop: pausedRun.loopId
        ? { id: pausedRun.loopId, scheduledFor: null }
        : null,
    })
    if (!turnRun) return "busy"
    await enqueueTurn(deps, workspaceId, conversationId, turnRun)
    return "resumed"
  }

  // A fire of a Loop paused, completed or deleted since is not read.
  await db
    .update(schema.agentInbox)
    .set({ status: "read", readAt: new Date() })
    .where(
      and(
        eq(schema.agentInbox.conversationId, conversationId),
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
  let batch = await loadInboxBatch(conversationId)
  if (!batch) return "empty"
  const batchChannelId = batch.channelId
  const channel = await turnChannel(agentId, batchChannelId, workspaceId)
  if (!channel) {
    // What woke it is about a channel the agent is no longer in: nothing it
    // could say there. The items are read without a turn, and the rest of
    // the inbox gets its own flush.
    await db
      .update(schema.agentInbox)
      .set({ status: "read", readAt: new Date() })
      .where(
        and(
          eq(schema.agentInbox.conversationId, conversationId),
          batchChannelId
            ? eq(schema.agentInbox.channelId, batchChannelId)
            : isNull(schema.agentInbox.channelId),
          eq(schema.agentInbox.status, "pending")
        )
      )
    await flushIfWaiting(deps, conversationId)
    return "skipped"
  }
  const channelId = channel.id
  const directUserId =
    batch.loop || batch.deliveryIds.length || !channelId
      ? null
      : await channelRequestUserId(channelId, batch.triggerMessageId)
  const subscription = directUserId
    ? (await personalRequestHarness(workspaceId, directUserId)) !== "pi"
    : await autonomousUsesSubscription(agentId)
  // Unfunded API work stays pending; personal subscriptions can still run.
  if (!subscription && !(await checkCredits(workspaceId)).allowed) {
    const harnessByUser = new Map<string, Promise<string>>()
    batch = await loadInboxBatch(conversationId, async (messageId) => {
      const userId = channelId
        ? await channelRequestUserId(channelId, messageId)
        : null
      if (!userId) return false
      let harness = harnessByUser.get(userId)
      if (!harness) {
        harness = personalRequestHarness(workspaceId, userId)
        harnessByUser.set(userId, harness)
      }
      return (await harness) !== "pi"
    })
    if (!batch || batch.channelId !== channelId) return "skipped"
  }
  const turnRun = await createTurnRun({
    workspaceId,
    conversation,
    channel,
    triggerMessageId: batch.triggerMessageId,
    batch,
  })
  if (!turnRun) return "busy"
  await enqueueTurn(deps, workspaceId, conversationId, turnRun)
  return "started"
}

async function enqueueTurn(
  deps: AgentDeps,
  workspaceId: string,
  conversationId: string,
  turnRun: TurnRun
) {
  const data: AgentTurnJobData = { conversationId, runId: turnRun.runId }
  notifyWorkspaceActivity(workspaceId)
  try {
    await deps.queue.add(AGENT_TURN_JOB, data, {
      ...TURN_JOB_OPTIONS,
      jobId: data.runId,
    })
  } catch (err) {
    // Unwind: the items go back to pending, and one delayed flush retries
    // them without waiting for another wake.
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
      // The discarded opening carried the profile notes since this cursor.
      if (turnRun.notesThrough !== undefined) {
        await tx
          .update(schema.agentContext)
          .set({ notesThrough: turnRun.notesThrough })
          .where(eq(schema.agentContext.conversationId, conversationId))
      }
    })
    await deps.queue
      .add(
        AGENT_INBOX_FLUSH_JOB,
        { conversationId },
        { delay: 30_000, removeOnComplete: true, removeOnFail: 100 }
      )
      .catch(() => {})
    throw err
  }
}

// A turn that stops before it reads its batch: the items go back to pending
// and its opening is dropped, so a later flush reads them again. The notes
// cursor goes back to the previous opening's time.
async function returnBatchToPending(conversationId: string, runId: string) {
  await db.transaction(async (tx) => {
    const opened = await tx
      .delete(schema.agentStep)
      .where(
        and(
          eq(schema.agentStep.runId, runId),
          eq(schema.agentStep.kind, "inbox")
        )
      )
      .returning({ id: schema.agentStep.id })
    if (opened.length === 0) return
    await tx
      .update(schema.agentInbox)
      .set({ status: "pending", readAt: null, runId: null })
      .where(eq(schema.agentInbox.runId, runId))
    const [previous] = await tx
      .select({ createdAt: schema.agentStep.createdAt })
      .from(schema.agentStep)
      .where(
        and(
          eq(schema.agentStep.conversationId, conversationId),
          eq(schema.agentStep.kind, "inbox")
        )
      )
      .orderBy(desc(schema.agentStep.seq))
      .limit(1)
    await tx
      .update(schema.agentContext)
      .set({ notesThrough: previous?.createdAt ?? null })
      .where(eq(schema.agentContext.conversationId, conversationId))
  })
}

async function flushIfWaiting(deps: AgentDeps, conversationId: string) {
  if (!(await hasPendingWake(conversationId))) return
  await deps.queue
    .add(AGENT_INBOX_FLUSH_JOB, { conversationId })
    .catch((err) =>
      logger.error({ err, conversationId }, "Agent inbox re-flush failed")
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

async function claim(job: Job, token: string | undefined, runId: string) {
  const outcome = await claimAgentRun(runId)
  if (outcome.kind === "busy") await delayJobUntil(job, token, outcome.retryAt)
  return outcome.kind === "claimed" ? outcome.execution : null
}

// The person behind a turn no person started: the Loop's creator, whoever
// woke the turn that set the wake-up, or whoever last saved the trigger.
// Sessions the agent starts run on their plan (decision 34).
async function setUpBy(runId: string): Promise<string | null> {
  const [loop] = await db
    .select({ userId: schema.loop.creatorId })
    .from(schema.agentRun)
    .innerJoin(schema.loop, eq(schema.loop.id, schema.agentRun.loopId))
    .where(eq(schema.agentRun.id, runId))
  if (loop?.userId) return loop.userId
  const [wakeUp] = await db
    .select({ userId: schema.agentWakeUp.askedById })
    .from(schema.agentInbox)
    .innerJoin(
      schema.agentWakeUp,
      sql`${schema.agentWakeUp.id}::text = ${schema.agentInbox.sourceId}`
    )
    .where(
      and(
        eq(schema.agentInbox.runId, runId),
        eq(schema.agentInbox.source, "wake_up"),
        isNotNull(schema.agentWakeUp.askedById)
      )
    )
    .orderBy(asc(schema.agentInbox.createdAt), asc(schema.agentInbox.id))
    .limit(1)
  if (wakeUp?.userId) return wakeUp.userId
  const [trigger] = await db
    .select({ userId: schema.connectorTrigger.configuredById })
    .from(schema.agentInbox)
    .innerJoin(
      schema.triggerDelivery,
      eq(schema.triggerDelivery.id, schema.agentInbox.deliveryId)
    )
    .innerJoin(
      schema.connectorTrigger,
      eq(schema.connectorTrigger.id, schema.triggerDelivery.triggerId)
    )
    .where(
      and(
        eq(schema.agentInbox.runId, runId),
        eq(schema.agentInbox.lane, "wake"),
        isNotNull(schema.connectorTrigger.configuredById)
      )
    )
    // The earliest event that woke the turn.
    .orderBy(asc(schema.agentInbox.createdAt), asc(schema.agentInbox.id))
    .limit(1)
  return trigger?.userId ?? null
}

// A card the agent filed in the chat belongs to the request that filed it:
// a reply or a decision in the card's thread goes on with that request.
async function linkCard(
  cardMessageId: string | null | undefined,
  conversationId: string
) {
  if (!cardMessageId) return
  await recordConversationPost(cardMessageId, conversationId).catch((err) =>
    logger.warn({ err, cardMessageId }, "Agent card link failed")
  )
}

// propose_workspace_change for the agent: the card posts in the chat (never
// in a thread: a decision on a thread card would continue a session there),
// only in a turn a person started.
function agentProposeChange(
  deps: AgentDeps,
  channel: { id: string; workspaceId: string; agentId: string },
  askerId: string | null,
  conversationId: string
): ProposeChangeExecutor {
  return async (input) => {
    if (!askerId) {
      throw new ProposalRefusedError(
        "Nobody asked for this in the chat just now. Propose workspace changes only when a person asks for them."
      )
    }
    const made = await createProposalCard(deps, {
      workspaceId: channel.workspaceId,
      channelId: channel.id,
      agentId: channel.agentId,
      threadRootId: null,
      ...input,
    })
    const [proposal] = await db
      .select({ cardMessageId: schema.changeProposal.cardMessageId })
      .from(schema.changeProposal)
      .where(eq(schema.changeProposal.id, made.proposalId))
    await linkCard(proposal?.cardMessageId, conversationId)
    return made
  }
}

// What a turn or a compaction runs with: its conversation, the agent, the
// channel the turn is about and the other channels the agent is in. Null
// when the conversation is gone or the agent is no longer in that channel
// (it was taken out since the turn was queued).
async function loadTurnPlace(
  conversationId: string,
  // Null: a turn about no chat.
  channelId: string | null
) {
  const conversation = await loadConversation(conversationId)
  if (!conversation) return null
  const [[agent], channel] = await Promise.all([
    db
      .select()
      .from(schema.agent)
      .where(eq(schema.agent.id, conversation.agentId)),
    turnChannel(conversation.agentId, channelId, conversation.workspaceId),
  ])
  if (!agent || !channel?.workspaceId) return null
  // Every other channel it is in, private ones too: what an agent knows is
  // shared (reference/agents-and-chats.md, decision 22).
  const others = await db
    .select({ name: schema.channel.name })
    .from(schema.channelAgent)
    .innerJoin(
      schema.channel,
      eq(schema.channel.id, schema.channelAgent.channelId)
    )
    .where(
      and(
        eq(schema.channelAgent.agentId, agent.id),
        channelId ? ne(schema.channel.id, channelId) : undefined,
        isNull(schema.channel.archivedAt)
      )
    )
    .orderBy(asc(schema.channel.createdAt))
  // The agents it shares a chat with, and which chats (decision 32).
  const shared = await db
    .select({
      id: schema.agent.id,
      name: schema.agent.name,
      role: schema.agent.role,
      channel: schema.channel.name,
    })
    .from(schema.channelAgent)
    .innerJoin(schema.agent, eq(schema.agent.id, schema.channelAgent.agentId))
    .innerJoin(
      schema.channel,
      eq(schema.channel.id, schema.channelAgent.channelId)
    )
    .where(
      and(
        ne(schema.channelAgent.agentId, agent.id),
        isNull(schema.channel.archivedAt),
        sql`${schema.channelAgent.channelId} in (select channel_id from channel_agent where agent_id = ${agent.id})`
      )
    )
    .orderBy(asc(schema.agent.createdAt), asc(schema.channel.createdAt))
  const otherAgents = new Map<
    string,
    { id: string; name: string; role: string | null; channels: string[] }
  >()
  for (const row of shared) {
    const entry = otherAgents.get(row.id) ?? {
      id: row.id,
      name: row.name,
      role: row.role,
      channels: [],
    }
    if (row.channel) entry.channels.push(row.channel)
    otherAgents.set(row.id, entry)
  }
  return {
    ...channel,
    workspaceId: channel.workspaceId,
    conversation,
    agentId: agent.id,
    agentModel: agent.model,
    agentName: agent.name,
    agentCreature: agent.creature,
    otherChannels: others.flatMap((other) => other.name ?? []),
    otherAgents: [...otherAgents.values()],
  }
}

function agentHooks(
  deps: AgentDeps,
  execution: RunExecution,
  channel: {
    // Null: a turn about no chat.
    id: string | null
    name: string | null
    workspaceId: string
    conversation: AgentConversation
    agentId: string
    agentName: string
    agentCreature: string
    otherChannels: string[]
    otherAgents: RunAgentContext["otherAgents"]
  },
  mode: RunAgentContext["mode"],
  onSent: () => void,
  // Attribution, direct-request payer, and the place the turn answers in.
  turn: {
    askerId: string | null
    planUserId: string | null
    requestUserId?: string | null
    threadRootId: string | null
    triggerMessageId?: string | null
  } = {
    askerId: null,
    planUserId: null,
    threadRootId: null,
  }
): RunAgentContext {
  const conversation = channel.conversation
  return {
    conversation: { id: conversation.id, kind: conversation.kind },
    agentId: channel.agentId,
    channelName: channel.name,
    agentName: channel.agentName,
    creature: isCreatureId(channel.agentCreature)
      ? creatureById(channel.agentCreature).label
      : "creature",
    otherChannels: channel.otherChannels,
    otherAgents: channel.otherAgents,
    mode,
    // A code session lives in a chat: a turn about none can't start one.
    ...(channel.id
      ? {
          sessions: agentSessionExecutors(deps, {
            workspaceId: channel.workspaceId,
            agentId: channel.agentId,
            conversationId: conversation.id,
            channelId: channel.id,
            channelName: channel.name,
            askerId: turn.askerId,
            planUserId: turn.planUserId,
            requestUserId: turn.requestUserId ?? null,
            turn,
          }),
        }
      : {}),
    completeLoop: agentCompleteLoop(deps, channel.agentId),
    loops: agentLoopExecutors(deps, {
      workspaceId: channel.workspaceId,
      agentId: channel.agentId,
      agentName: channel.agentName,
      channelId: channel.id,
      askerId: turn.askerId,
      setUpById: turn.planUserId,
      conversationId: conversation.id,
      place: turn,
    }),
    wakeUps: agentWakeUpExecutors(deps, {
      workspaceId: channel.workspaceId,
      agentId: channel.agentId,
      conversationId: conversation.id,
      channelId: channel.id,
      runId: execution.runId,
      askedById: turn.askerId,
    }),
    // Only with another agent in the chat this turn is about.
    ...(channel.id !== null &&
    channel.name !== null &&
    channel.otherAgents.some((other) =>
      other.channels.includes(channel.name ?? "")
    )
      ? {
          messageAgent: agentMessenger(deps, {
            workspaceId: channel.workspaceId,
            channelId: channel.id,
            channelName: channel.name,
            agentId: channel.agentId,
            conversationId: conversation.id,
          }),
        }
      : {}),
    sendMessage: async ({ content, startThread, channel: named, files }) => {
      const attached = files?.length
        ? await resolveAgentFiles(channel.workspaceId, files)
        : { attachments: [] }
      if ("error" in attached) return { error: attached.error }
      // Another channel the agent is in, when it names one.
      const wanted = named?.trim().replace(/^#/, "").toLowerCase()
      const elsewhere =
        wanted && wanted !== (channel.name ?? "").toLowerCase()
          ? await db
              .select({ id: schema.channel.id })
              .from(schema.channelAgent)
              .innerJoin(
                schema.channel,
                eq(schema.channel.id, schema.channelAgent.channelId)
              )
              .where(
                and(
                  eq(schema.channelAgent.agentId, channel.agentId),
                  eq(schema.channel.type, "text"),
                  sql`lower(${schema.channel.name}) = ${wanted}`
                )
              )
              .then((rows) => rows[0] ?? null)
          : undefined
      const chats = [
        ...(channel.name ? [channel.name] : []),
        ...channel.otherChannels,
      ].map((name) => `#${name}`)
      if (elsewhere === null) {
        return {
          error: `You are not in a channel named #${wanted}. ${chats.length > 0 ? `You can post in ${chats.join(", ")}.` : "You are in no chat, so there is nowhere to post."}`,
        }
      }
      if (elsewhere && startThread) {
        return {
          error:
            "startThread answers the message that woke this turn, so it can't be used with another channel.",
        }
      }
      const targetId = elsewhere?.id ?? channel.id
      // A turn about no chat (a Loop with none) posts only where it says.
      if (!targetId) {
        return {
          error:
            chats.length > 0
              ? `This turn is about no chat. Name the chat to post in with \`channel\`: ${chats.join(", ")}.`
              : "You are in no chat, so there is nowhere to post. Keep what you found with remember.",
        }
      }
      // The channel may be archived while the model works.
      const [open] = await db
        .select({ archivedAt: schema.channel.archivedAt })
        .from(schema.channel)
        .where(eq(schema.channel.id, targetId))
      if (!open || open.archivedAt) {
        return { error: "This channel is archived, so nothing more can post." }
      }
      let threadNote: string | undefined
      if (startThread) {
        if (turn.threadRootId) {
          return {
            error:
              "This turn already answers in a thread. Send without startThread.",
          }
        }
        const rootId = turn.triggerMessageId
        if (!rootId) {
          return {
            error:
              "No person's message woke this turn, so there is no message to start a thread on.",
          }
        }
        turn.threadRootId = rootId
        // Whoever wrote the message follows the thread started on it.
        const [root] = await db
          .select({ authorId: schema.message.authorId })
          .from(schema.message)
          .where(eq(schema.message.id, rootId))
        if (
          root &&
          root.authorId !== LOR_USER_ID &&
          root.authorId !== APP_USER_ID
        ) {
          await subscribeToThread(rootId, [root.authorId]).catch(() => {})
        }
        // startThread is never with another channel, so this is the turn's.
        threadNote = await startDiscordThread({
          channelId: targetId,
          threadRootId: rootId,
          name: startThread,
        }).then(
          () => undefined,
          (err: unknown) => {
            logger.warn({ err, channelId: channel.id }, "Discord thread failed")
            return err instanceof Error ? err.message : "unknown error"
          }
        )
      }
      // A post in another channel goes to its chat, not to this turn's
      // thread.
      const threadRootId = elsewhere ? null : turn.threadRootId
      const posted = await postLorMessage(deps, {
        channelId: targetId,
        content,
        type: "agent_post",
        agentId: channel.agentId,
        ...(threadRootId ? { threadRootId } : {}),
        ...(attached.attachments.length
          ? { attachments: attached.attachments }
          : {}),
      })
      onSent()
      // A reply to, or a thread under, a request's post in the chat goes on
      // with that request.
      if (conversation.kind === "request" && !threadRootId) {
        await recordConversationPost(posted.messageId, conversation.id).catch(
          (err) => logger.warn({ err }, "Agent post link failed")
        )
      }
      // A chat that lives in Discord gets the post there too (decision 22).
      // A thread Discord refused to start leaves the post in its chat.
      // Images and videos upload with it; one too big for the server is
      // linked instead.
      const forDiscord = await filesForDiscord(
        targetId,
        attached.attachments
      ).catch(() => ({ files: [], linked: attached.attachments }))
      const discordError = await postAgentToDiscord({
        channelId: targetId,
        agentId: channel.agentId,
        messageId: posted.messageId,
        content: forDiscord.linked.length
          ? `${content}\n\n${forDiscord.linked.map((file) => `[${file.filename}](${file.url})`).join("\n")}`
          : content,
        files: forDiscord.files,
        threadRootId: threadNote ? null : threadRootId,
      }).then(
        () => undefined,
        (err: unknown) => {
          logger.warn({ err, channelId: channel.id }, "Discord post failed")
          return err instanceof Error ? err.message : "unknown error"
        }
      )
      const problem = threadNote
        ? `couldn't start the thread there (${threadNote}), so it went to the chat`
        : discordError
      return problem ? { ...posted, discordError: problem } : posted
    },
    recordUsage: (usage, kind) => execution.recordUsage(usage, kind),
    loadDecisions: async (pausedRunId) =>
      (await loadPausedDecisions(pausedRunId, execution.runId, null, false))
        .decisions,
  }
}

// One turn of an agent in one of its conversations, on its own loop
// (agent-loop.ts).
export async function runAgentTurnJob(
  deps: AgentDeps,
  job: Job<AgentTurnJobData>,
  token: string | undefined
): Promise<void> {
  const { runId, conversationId } = job.data
  // A job queued before conversations names a channel: its run is gone.
  if (!conversationId) return
  const execution = await claim(job, token, runId)
  if (!execution) return
  const writer = execution.writer
  // A failed read releases the claim, so the run stays eligible for recovery.
  const loaded = await (async () => {
    const [run] = await db
      .select({
        // The channel the turn is about, set when its run was made.
        channelId: schema.agentRun.channelId,
        triggerMessageId: schema.agentRun.triggerMessageId,
        triggerAuthorId: schema.message.authorId,
        triggerContent: schema.message.content,
        triggerThreadRootId: schema.message.threadRootId,
        triggerReplyAuthorId: sql<
          string | null
        >`(select r.author_id from message r where r.id = ${schema.message.referencedMessageId})`,
        // The agent already answers in a thread on its trigger: a turn that
        // went on after an approval stays where startThread moved it.
        // Woken by the inbox classifier, not by name (LOR-171).
        triggerInferred: sql<boolean>`exists (select 1 from agent_inbox i where i.message_id = ${schema.agentRun.triggerMessageId} and i.conversation_id = ${schema.agentRun.conversationId} and i.inferred)`,
        triggerHasAgentThread: sql<boolean>`exists (select 1 from message t where t.thread_root_id = ${schema.agentRun.triggerMessageId} and (t.author_id = ${LOR_USER_ID}::uuid or t.author_id = (select c.agent_id from agent_conversation c where c.id = ${schema.agentRun.conversationId})))`,
        loopId: schema.agentRun.loopId,
        hasDeliveries: sql<boolean>`exists (select 1 from trigger_delivery d where d.run_id = ${schema.agentRun.id})`,
      })
      .from(schema.agentRun)
      .leftJoin(
        schema.message,
        eq(schema.message.id, schema.agentRun.triggerMessageId)
      )
      .where(eq(schema.agentRun.id, runId))
    return {
      run,
      channel: run ? await loadTurnPlace(conversationId, run.channelId) : null,
    }
  })().catch((err: unknown) => {
    execution.stop()
    throw err
  })
  const { run, channel } = loaded
  if (!run || !channel) {
    await writer.transition("failed", { stopReason: "error" })
    execution.stop()
    return
  }
  // A channel archived since the turn was queued takes no more posts.
  if (channel.archivedAt) {
    await writer.transition("stopped")
    execution.stop()
    return
  }
  const workspaceId = channel.workspaceId
  const channelId = channel.id
  const userId = run?.triggerAuthorId ?? undefined
  const directUserId =
    run?.loopId || run?.hasDeliveries || !channelId
      ? null
      : await channelRequestUserId(
          channelId,
          run?.triggerMessageId ?? null
        ).catch((err: unknown) => {
          execution.stop()
          throw err
        })
  const requestUserId = execution.handle.harnessAccount
    ? execution.handle.harnessAccount.userId
    : directUserId
  // A turn woken in a human thread answers there (loadInboxBatch keeps a
  // turn to one place, and its trigger is the first message that woke it).
  // send_message's startThread moves it into a new thread.
  const turnPlace = {
    askerId: userId ?? null,
    planUserId: userId ?? null,
    requestUserId,
    threadRootId:
      run?.triggerThreadRootId ??
      (run?.triggerHasAgentThread ? run.triggerMessageId : null),
    triggerMessageId: run?.triggerMessageId ?? null,
  }
  let sent = false
  // A turn about no chat has nowhere to say it.
  const notice = async (content: string) => {
    if (!channelId) return
    await postLorMessage(deps, {
      channelId,
      content,
      type: "agent_post",
      agentId: channel.agentId,
      ...(turnPlace.threadRootId
        ? { threadRootId: turnPlace.threadRootId }
        : {}),
    })
      .then((posted) =>
        postAgentToDiscord({
          channelId,
          agentId: channel.agentId,
          messageId: posted.messageId,
          content,
          threadRootId: turnPlace.threadRootId,
        })
      )
      .catch((err) => logger.error({ err, runId }, "Agent notice failed"))
  }
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
    if (
      requestUserId &&
      channelId &&
      !(await resolveChannelAccess(requestUserId, channelId)).ok
    )
      throw new Error(
        "The person who started this turn no longer has access to the channel."
      )
    const funded = await turnFunded(workspaceId, channel.agentId, {
      harnessAccount: execution.handle.harnessAccount ?? null,
      funding: execution.handle.funding ?? null,
      requestUserId,
    })
    if (!funded) {
      // Said only to a person who asked: events and Loops would repeat it,
      // and a message that named nobody shouldn't get it either.
      if (userId && !run?.triggerInferred) await notice(OUT_OF_CREDITS_MESSAGE)
      // The inbox sweep wakes the agent again once credits are back.
      await returnBatchToPending(conversationId, runId)
      await writer.transition("failed", { stopReason: "out_of_credits" })
      execution.stop()
      await settleLoop("failed", "out_of_credits")
      deps.emitter
        .to(workspaceRoom(workspaceId))
        .emit("billing:updated", { workspaceId, reason: "out_of_credits" })
      return
    }
    // Typing only when a person addressed Lor: turns woken by an event, a
    // session's report or a thread it's part of often end quiet. A person's
    // id marks a person's message (the trigger of a note-only turn is null).
    const explicit = [LOR_USER_ID, channel.agentId].some(
      (id) =>
        Boolean(run?.triggerContent?.includes(`<@${id}>`)) ||
        run?.triggerReplyAuthorId === id
    )
    // A message the classifier woke it for may get no answer: no typing.
    const addressed =
      Boolean(userId) &&
      !run?.triggerInferred &&
      (explicit || !turnPlace.threadRootId)
    // Before the typing and working timers start, so a failed lookup can't
    // leave them running.
    turnPlace.planUserId = userId ?? (await setUpBy(runId))
    const typing =
      addressed && channelId
        ? showTyping(deps, channelId, turnPlace, {
            id: channel.agentId,
            name: channel.agentName,
          })
        : { pause: () => {}, stop: () => {} }
    // Working shows in a chat: a turn about none shows nowhere.
    const stopWorking = channelId
      ? showWorking(deps, channelId, channel.agentId)
      : () => {}
    // The memory pass reuses this context, so its tools and prompt match
    // the turn's and it reads the turn's cache.
    const turnContext = {
      workspaceId,
      ...(channelId ? { channelId } : {}),
      conversation: [],
      runId,
      ...(run?.triggerMessageId
        ? { triggerMessageId: run.triggerMessageId }
        : {}),
      ...(userId ? { userId } : {}),
      autonomous: !requestUserId,
      aiSessionId: conversationId,
      turn: { model: channel.agentModel ?? AGENT_DEFAULT_MODEL },
      // A proposal is a card in a chat.
      ...(channelId
        ? {
            proposeChange: agentProposeChange(
              deps,
              { id: channelId, workspaceId, agentId: channel.agentId },
              userId ?? null,
              conversationId
            ),
          }
        : {}),
    }
    const result = await respond(
      {
        ...turnContext,
        agent: agentHooks(
          deps,
          execution,
          { ...channel, workspaceId },
          "turn",
          () => {
            sent = true
            typing.pause()
          },
          turnPlace
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
    ).finally(() => {
      typing.stop()
      stopWorking()
    })
    const agent = result.agent

    // A turn paused on approvals: the set is filed under a message in the
    // chat that shows the cards, and a decision resumes it.
    let parkedApprovalId: string | null = null
    let parkedMessageId: string | null = null
    // A turn about no chat never parks on approvals: the runtime refuses a
    // gated tool there, since there is nowhere to ask.
    if (agent && agent.approvals.length > 0 && channelId) {
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
        agentId: channel.agentId,
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
          .returning({
            id: schema.approval.id,
            description: schema.approval.description,
          })
      })
      parkedApprovalId = inserted[0]?.id ?? null
      parkedMessageId = posted.messageId
      // In a chat that lives in Discord, each approval gets buttons there.
      for (const approval of inserted) {
        await postAgentToDiscord({
          channelId,
          agentId: channel.agentId,
          messageId: null,
          content: "",
          components: approvalCard({
            approvalId: approval.id,
            what: `${channel.agentName} wants to:`,
            description: approval.description,
            decider: null,
            lorUrl: null,
            inLor: false,
          }),
          threadRootId: turnPlace.threadRootId,
        }).catch((err) =>
          logger.warn(
            { err, approvalId: approval.id },
            "Discord approval post failed"
          )
        )
      }
    }

    const stoppedByUser = result.stoppedFor === "stopped_by_user"
    await writer.transition(stoppedByUser ? "stopped" : "complete", {
      stopReason: result.stoppedFor ?? "completed",
    })
    execution.stop()
    // A turn parked on approvals isn't the fire's end: its continuation
    // keeps the Loop and settles it.
    if (!parkedApprovalId) {
      await settleLoop(stoppedByUser ? "stopped" : "complete")
    }

    if (parkedApprovalId && channelId) {
      deps.emitter.to(channelRoom(channelId)).emit("approval:created", {
        approvalId: parkedApprovalId,
        channelId,
        threadRootId: null,
        messageId: parkedMessageId,
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
    // The turn already completed: a failed note must not retry or fail it.
    if (said.length > 0) {
      await saveHandoffNote(runId, said.join("\n\n")).catch((err) =>
        logger.error({ err, runId }, "Agent handoff note save failed")
      )
    }

    // The next turn may start now; the memory pass doesn't hold it up.
    await flushIfWaiting(deps, conversationId)

    // The memory pass (decision 11), on the turn's warm cache. It replaces
    // write-back for the agent; a turn paused on approvals has its pass when
    // it goes on.
    const canRemember =
      result.messages.length > 0 &&
      !stoppedByUser &&
      !parkedApprovalId &&
      (await (async () =>
        (await autonomousUsesSubscription(channel.agentId)) ||
        (
          await checkCredits(workspaceId)
        ).allowed)().catch(() => false))
    if (canRemember) {
      await respond(
        {
          ...turnContext,
          autonomous: true,
          agent: agentHooks(
            deps,
            execution,
            { ...channel, workspaceId },
            "memory",
            () => {},
            { ...turnPlace, requestUserId: null }
          ),
        },
        {
          onDelta: () => {},
          onUsage: (u) => {
            execution.addUsage(u)
            void recordUsage(u, {
              channelId,
              userId: userId ?? null,
              debitScope: runId,
            })
          },
        },
        execution.handle
      ).catch((err) => logger.warn({ err, runId }, "Agent memory pass failed"))
    }

    if (agent && agent.promptTokens >= COMPACT_AT_TOKENS) {
      await deps.queue
        .add(
          AGENT_COMPACT_JOB,
          { conversationId, afterRunId: runId },
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
  await flushIfWaiting(deps, conversationId)
}

// Summarizes a large conversation once it has been idle, while the cache is
// warm, unless something is about to wake the agent anyway
// (reference/always-on-agents.md §8).
export async function runAgentCompactJob(
  deps: AgentDeps,
  job: Job<AgentCompactJobData>,
  token: string | undefined
): Promise<void> {
  const { conversationId, afterRunId } = job.data
  if (!conversationId) return
  const [latest] = await db
    .select({ id: schema.agentRun.id, channelId: schema.agentRun.channelId })
    .from(schema.agentRun)
    .where(eq(schema.agentRun.scopeKey, conversationId))
    .orderBy(desc(schema.agentRun.createdAt))
    .limit(1)
  // A later turn ran: it schedules its own compaction.
  if (latest?.id !== afterRunId) return
  if (await hasPendingWake(conversationId)) return
  if (await pausedAgentRun(conversationId)) return
  if (await wakeUpDueSoon(conversationId)) return
  // The summary's run is about the channel its last turn was about.
  const channel = await loadTurnPlace(conversationId, latest.channelId)
  if (!channel) return
  const workspaceId = channel.workspaceId
  const channelId = channel.id
  const context = await loadAgentContext(workspaceId, conversationId)
  if (context.promptTokens < COMPACT_AT_TOKENS) return

  const runId = (
    await createTurnRun({
      workspaceId,
      conversation: channel.conversation,
      channel,
      triggerMessageId: null,
      batch: null,
      afterRunId,
    })
  )?.runId
  if (!runId) return
  const execution = await claim(job, token, runId)
  if (!execution) return
  try {
    const result = await respond(
      {
        workspaceId,
        ...(channelId ? { channelId } : {}),
        conversation: [],
        runId,
        aiSessionId: conversationId,
        // The epoch's model, so the summary reads its cache.
        turn: {
          model: context.model ?? channel.agentModel ?? AGENT_DEFAULT_MODEL,
        },
        ...(channelId
          ? {
              proposeChange: agentProposeChange(
                deps,
                { id: channelId, workspaceId, agentId: channel.agentId },
                null,
                conversationId
              ),
            }
          : {}),
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
      { conversationId, compacted: result.agent?.compacted ?? false },
      "Agent compaction run ended"
    )
    await execution.writer.transition("complete", { stopReason: "completed" })
  } catch (err) {
    logger.error({ err, conversationId }, "Agent compaction failed")
    await execution.writer.transition("failed", { stopReason: "error" })
  } finally {
    execution.stop()
  }
  await flushIfWaiting(deps, conversationId)
}

// Wakes a flush may have missed: a wake item still unread a minute after it
// arrived, or a turn paused on approvals that are all decided. Any producer
// whose flush enqueue failed (a chat message, Discord, a wake-up, a session
// report, an approval) is recovered here; a repeated flush is harmless.
const STRANDED_AFTER_MS = 60_000

export async function sweepStrandedInboxes(
  queue: Queue<AgentQueueData>
): Promise<number> {
  const before = new Date(Date.now() - STRANDED_AFTER_MS)
  // Random order: conversations a flush keeps skipping (out of credits, beta
  // ended) can't hold every slot sweep after sweep.
  const unread = await db
    .select({ conversationId: schema.agentInbox.conversationId })
    .from(schema.agentInbox)
    .where(
      and(
        eq(schema.agentInbox.status, "pending"),
        eq(schema.agentInbox.lane, "wake"),
        lt(schema.agentInbox.createdAt, before)
      )
    )
    .groupBy(schema.agentInbox.conversationId)
    .orderBy(sql`random()`)
    .limit(200)
  // The conversation's latest run paused on approvals none of which is
  // pending.
  const decided = await db.execute<{ conversation_id: string }>(sql`
    select r.conversation_id::text as conversation_id
    from agent_run r
    join channel c on c.id = r.channel_id and c.archived_at is null
    where r.stop_reason = 'awaiting_approval'
      and r.conversation_id is not null
      and r.updated_at < now() - interval '1 minute'
      and not exists (
        select 1 from approval a where a.run_id = r.id and a.status = 'pending'
      )
      and not exists (
        select 1 from agent_run later
        where later.scope_key = r.scope_key and later.created_at > r.created_at
          -- A continuation that failed before writing a step leaves the pause open.
          and not (
            later.state = 'failed'
            and not exists (select 1 from agent_step s where s.run_id = later.id)
          )
      )
    order by random()
    limit 200
  `)
  const conversationIds = new Set([
    ...unread.map((row) => row.conversationId),
    ...decided.map((row) => row.conversation_id),
  ])
  for (const conversationId of conversationIds) {
    await queue
      .add(AGENT_INBOX_FLUSH_JOB, { conversationId })
      .catch((err) =>
        logger.error({ err, conversationId }, "Stranded inbox flush failed")
      )
  }
  // A turn run that read its batch, or went on after a pause on approvals,
  // but was never claimed: the process died between the run's commit and its
  // job's enqueue. Same jobId, so a turn job that still exists is not added
  // twice. Compaction runs are neither and are left alone.
  const unclaimed = await db
    .select({
      runId: schema.agentRun.id,
      conversationId: schema.agentRun.conversationId,
    })
    .from(schema.agentRun)
    .where(
      and(
        eq(schema.agentRun.state, "queued"),
        isNotNull(schema.agentRun.conversationId),
        isNull(schema.agentRun.deadlineAt),
        lt(schema.agentRun.createdAt, before),
        or(
          sql`exists (select 1 from agent_inbox i where i.run_id = ${schema.agentRun.id})`,
          sql`(select p.stop_reason from agent_run p where p.scope_key = ${schema.agentRun.scopeKey} and p.created_at < ${schema.agentRun.createdAt} order by p.created_at desc limit 1) = 'awaiting_approval'`
        )
      )
    )
    .limit(200)
  for (const run of unclaimed) {
    if (!run.conversationId) continue
    await queue
      .add(
        AGENT_TURN_JOB,
        { conversationId: run.conversationId, runId: run.runId },
        { ...TURN_JOB_OPTIONS, jobId: run.runId }
      )
      .catch((err) =>
        logger.error({ err, runId: run.runId }, "Stranded turn enqueue failed")
      )
  }
  return conversationIds.size + unclaimed.length
}

// The agent's check-in (reference/agents-and-chats.md, decision 26): wakes
// an agent's own conversation when something waits unread in a channel it is
// in, its last look was at least CHECK_IN_MINUTES ago and nothing else is
// about to wake it (a wake waiting, a turn running, a wake-up due soon). A
// quiet agent is never woken.
export async function sweepCheckIns(
  queue: Queue<AgentQueueData>
): Promise<number> {
  const due = await db.execute<{
    conversation_id: string
    workspace_id: string
    channel_id: string | null
  }>(sql`
    select c.id as conversation_id, c.workspace_id,
      -- The channel of the oldest unread item the agent can still answer in.
      (
        select i.channel_id from agent_inbox i
        join channel ch on ch.id = i.channel_id and ch.archived_at is null
        join channel_agent ca
          on ca.channel_id = i.channel_id and ca.agent_id = c.agent_id
        where i.conversation_id = c.id and i.status = 'pending'
          and i.lane = 'wait'
        order by i.created_at
        limit 1
      ) as channel_id
    from agent_conversation c
    where c.kind = 'own'
      and (
        c.checked_in_at is null
        or c.checked_in_at < now() - make_interval(mins => ${CHECK_IN_MINUTES})
      )
      and exists (
        select 1 from agent_inbox i
        where i.conversation_id = c.id and i.status = 'pending'
          and i.lane = 'wait'
      )
      and not exists (
        select 1 from agent_inbox i
        where i.conversation_id = c.id and i.status = 'pending'
          and i.lane = 'wake'
      )
      and not exists (
        select 1 from agent_run r
        where r.scope_key = c.id
          and r.state in ('queued', 'working', 'finalizing')
      )
    order by random()
    limit 200
  `)
  // One note per agent per window, however many sweeps see it due.
  const window = Math.floor(Date.now() / (CHECK_IN_MINUTES * 60_000))
  let woken = 0
  for (const row of due) {
    if (!row.channel_id) continue
    if (await wakeUpDueSoon(row.conversation_id)) continue
    const added = await addInboxNote({
      workspaceId: row.workspace_id,
      channelId: row.channel_id,
      conversationId: row.conversation_id,
      source: "check_in",
      sourceId: String(window),
      note: CHECK_IN_NOTE,
      lane: "wake",
    }).catch((err) => {
      logger.error({ err, row }, "Agent check-in failed")
      return null
    })
    if (!added) continue
    woken += 1
    await queue
      .add(AGENT_INBOX_FLUSH_JOB, { conversationId: row.conversation_id })
      .catch((err) => logger.error({ err, row }, "Agent check-in flush failed"))
  }
  return woken
}
