import {
  and,
  db,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  isUniqueViolation,
  MERLIN_USER_ID,
  schema,
} from "@repo/db"
import type { Task } from "@repo/db/schema"
import { env } from "@repo/env/server"
import type { PlacementTurn } from "@repo/merlin/placement"
import { extractDirectMentionUserIds } from "@repo/messaging"
import type { RealtimeMessage } from "@repo/realtime-types"
import { logger } from "@/lib/logger"
import type { AccessibleChannel } from "@/services/channel-access"
import { createMessage } from "@/services/messages"

const PLACEMENT_CONTEXT_LIMIT = 12

export function isMerlinMentioned(content: string | null | undefined): boolean {
  if (!content) return false
  return extractDirectMentionUserIds(content).has(MERLIN_USER_ID)
}

// Whether the message addresses a teammate (any non-Merlin mention). Used to
// end an open Merlin session — talking to a person isn't talking to Merlin.
export function mentionsOtherUser(content: string | null | undefined): boolean {
  if (!content) return false
  for (const id of extractDirectMentionUserIds(content)) {
    if (id !== MERLIN_USER_ID) return true
  }
  return false
}

// Has Merlin posted in this thread? If so the thread is an ongoing Merlin
// conversation, so plain replies go to it without a mention or session window.
export async function isMerlinThread(threadRootId: string): Promise<boolean> {
  const row = await db
    .select({ id: schema.message.id })
    .from(schema.message)
    .where(
      and(
        eq(schema.message.authorId, MERLIN_USER_ID),
        eq(schema.message.threadRootId, threadRootId)
      )
    )
    .limit(1)
    .then((r) => r[0])
  return !!row
}

// Recent channel-level messages (oldest→newest) used to decide reply placement.
export async function loadRecentChannelMessages(
  channelId: string
): Promise<PlacementTurn[]> {
  const rows = await db
    .select({
      content: schema.message.content,
      authorName: schema.user.name,
    })
    .from(schema.message)
    .innerJoin(schema.user, eq(schema.message.authorId, schema.user.id))
    .where(
      and(
        eq(schema.message.channelId, channelId),
        isNull(schema.message.threadRootId),
        isNotNull(schema.message.content)
      )
    )
    .orderBy(desc(schema.message.createdAt))
    .limit(PLACEMENT_CONTEXT_LIMIT)

  return rows
    .reverse()
    .map((r) => ({ authorName: r.authorName, content: r.content ?? "" }))
}

// Empty Merlin placeholder the worker streams into; no fanout (fires on completion).
export async function createMerlinPlaceholder(args: {
  accessibleChannel: AccessibleChannel
  channelId: string
  threadRootId: string | null
}): Promise<RealtimeMessage> {
  const result = await createMessage({
    userId: MERLIN_USER_ID,
    payload: {
      channelId: args.channelId,
      threadRootId: args.threadRootId ?? undefined,
    },
    accessibleChannel: args.accessibleChannel,
    status: "pending",
  })
  return result.message
}

// A task and its card message. The card is a channel-level message that
// acts as the thread root of all the task's runs — steering, queueing, stop,
// and replay reuse the thread-scope machinery unchanged. Returns null on any
// failure so the caller can fall back to a plain threaded answer.
export async function createTaskWithCard(args: {
  accessibleChannel: AccessibleChannel
  workspaceId: string
  channelId: string
  creatorId: string
  goal: string
  // Short issue-style title from the placement call; falls back to the goal.
  title?: string | null
}): Promise<{ card: RealtimeMessage; task: Task } | null> {
  try {
    // Code-point slice: a UTF-16 slice can cut an emoji in half.
    const truncate = (value: string) => Array.from(value).slice(0, 80).join("")
    const title =
      truncate(args.title?.trim() ?? "") ||
      truncate(
        args.goal
          .replace(/<@[0-9a-fA-F-]+>/g, "")
          .replace(/\s+/g, " ")
          .trim()
      ) ||
      "Task"
    const { message: card } = await createMessage({
      userId: MERLIN_USER_ID,
      payload: { channelId: args.channelId, content: args.goal },
      accessibleChannel: args.accessibleChannel,
      type: "task_card",
    })
    const task = await db
      .insert(schema.task)
      .values({
        workspaceId: args.workspaceId,
        channelId: args.channelId,
        cardMessageId: card.id,
        creatorId: args.creatorId,
        title,
        goal: args.goal,
      })
      .returning()
      .then((rows) => rows[0] ?? null)
    if (!task) {
      await db.delete(schema.message).where(eq(schema.message.id, card.id))
      return null
    }
    return { card, task }
  } catch (err) {
    logger.error({ err, channelId: args.channelId }, "Task creation failed")
    return null
  }
}

// Durable agent_run row backing a Merlin response (see
// reference/agent-harness.md). Budgets are snapshotted from env here so
// an in-flight run keeps its ceilings across retries and config changes.
// "conflict" = the scope's one-active-run index rejected the insert (another
// mention won the race) — the caller re-routes at the winner. Other failures
// must never block the answer; the worker treats a missing runId as legacy.
export async function createAgentRun(args: {
  workspaceId: string
  channelId: string
  messageId: string
  threadRootId: string | null
  triggerMessageId: string
}): Promise<string | "conflict" | null> {
  try {
    const row = await db
      .insert(schema.agentRun)
      .values({
        workspaceId: args.workspaceId,
        channelId: args.channelId,
        messageId: args.messageId,
        threadRootId: args.threadRootId,
        triggerMessageId: args.triggerMessageId,
        scopeKey: args.threadRootId ?? args.channelId,
        budgetSteps: env.AGENT_RUN_MAX_STEPS,
        budgetInputTokens: env.AGENT_RUN_MAX_INPUT_TOKENS,
        budgetOutputTokens: env.AGENT_RUN_MAX_OUTPUT_TOKENS,
        budgetToolCalls: env.AGENT_RUN_MAX_TOOL_CALLS,
        budgetToolOutputBytes: env.AGENT_RUN_MAX_TOOL_OUTPUT_BYTES,
        budgetWallMs: env.AGENT_RUN_MAX_WALL_MS,
        budgetCredits: env.AGENT_RUN_MAX_CREDITS,
      })
      .returning({ id: schema.agentRun.id })
      .then((r) => r[0] ?? null)
    return row?.id ?? null
  } catch (err) {
    if (isUniqueViolation(err)) return "conflict"
    // The answer proceeds as a legacy (non-durable) job — worth surfacing,
    // since it silently loses replay/budgets/steering for this response.
    logger.error({ err, channelId: args.channelId }, "Agent run insert failed")
    return null
  }
}

export type RunRouteOutcome = {
  outcome: "steered" | "queued"
  runId: string
  merlinMessageId: string
}

// Route a triggering message at the scope's active run instead of starting a
// sibling. Channel scopes steer (injected at the next step boundary) while
// the run can still absorb it, else queue. Thread scopes always queue — the
// thread UI surfaces the queue with an explicit "steer" action (stop +
// reprompt) instead of silently redirecting the in-flight answer. Null =
// scope free.
export async function routeToActiveRun(args: {
  scopeKey: string
  threadScope: boolean
  messageId: string
  senderId: string
}): Promise<RunRouteOutcome | null> {
  const run = await db
    .select({
      id: schema.agentRun.id,
      state: schema.agentRun.state,
      messageId: schema.agentRun.messageId,
    })
    .from(schema.agentRun)
    .where(
      and(
        eq(schema.agentRun.scopeKey, args.scopeKey),
        inArray(schema.agentRun.state, ["queued", "working", "finalizing"])
      )
    )
    .limit(1)
    .then((r) => r[0])
  if (!run) return null

  // queued/working runs absorb the message (a queued run's snapshot hasn't
  // been taken yet; the claim-time sweep consumes rows the snapshot covers).
  // finalizing can't be steered — defer to the follow-up run.
  const state =
    run.state === "finalizing" || args.threadScope ? "queued" : "steered"
  const inserted = await db
    .insert(schema.agentRunQueue)
    .values({
      scopeKey: args.scopeKey,
      runId: run.id,
      messageId: args.messageId,
      senderId: args.senderId,
      state,
    })
    .onConflictDoNothing({ target: schema.agentRunQueue.messageId })
    .returning({ id: schema.agentRunQueue.id })
    .then((r) => r[0] ?? null)

  // Already routed (client resend): report the original outcome.
  if (!inserted) {
    const existing = await db
      .select({ state: schema.agentRunQueue.state })
      .from(schema.agentRunQueue)
      .where(eq(schema.agentRunQueue.messageId, args.messageId))
      .then((r) => r[0])
    if (!existing) return null
    return {
      outcome: existing.state === "queued" ? "queued" : "steered",
      runId: run.id,
      merlinMessageId: run.messageId,
    }
  }

  // The run may have moved on between the read and the insert.
  const now = await db
    .select({ state: schema.agentRun.state })
    .from(schema.agentRun)
    .where(eq(schema.agentRun.id, run.id))
    .then((r) => r[0])
  if (state === "steered" && now?.state === "finalizing") {
    // A steered row must never sit on a run that won't drain it.
    await db
      .update(schema.agentRunQueue)
      .set({ state: "queued" })
      .where(eq(schema.agentRunQueue.id, inserted.id))
    return {
      outcome: "queued",
      runId: run.id,
      merlinMessageId: run.messageId,
    }
  }
  if (
    !now ||
    now.state === "complete" ||
    now.state === "failed" ||
    now.state === "stopped"
  ) {
    // Terminal already — its completion drain may have run before our row
    // landed, which would strand it. Undo the row (unless the drain swept it
    // first) and let the caller start a fresh run.
    const undone = await db
      .delete(schema.agentRunQueue)
      .where(
        and(
          eq(schema.agentRunQueue.id, inserted.id),
          eq(schema.agentRunQueue.state, state)
        )
      )
      .returning({ id: schema.agentRunQueue.id })
    if (undone.length > 0) return null
    return {
      outcome: "queued",
      runId: run.id,
      merlinMessageId: run.messageId,
    }
  }

  return { outcome: state, runId: run.id, merlinMessageId: run.messageId }
}
