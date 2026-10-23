import {
  and,
  db,
  desc,
  eq,
  inArray,
  isUniqueViolation,
  LOR_USER_ID,
  ne,
  schema,
} from "@repo/db"
import {
  chatFeedMessage,
  findAgentSessionByThreadRoot,
} from "@repo/db/queries/agent-sessions"
import { env } from "@repo/env/server"
import { channelCodeRepo, isSafeBranch } from "@repo/lor/code-repo"
import { extractDirectMentionUserIds } from "@repo/messaging"
import {
  type RealtimeMessage,
  type SendMessagePayload,
  sessionTitleFromPrompt,
} from "@repo/realtime-types"
import { logger } from "@/lib/logger"
import type { AccessibleChannel } from "@/services/channel-access"
import { isLorMentioned } from "@/services/lor-routing"
import { createMessage, type NewSessionInput } from "@/services/messages"

// How much chat a session started from `@Lor` carries as context; matches
// the pre-thread background Lor read before sessions.
const CHAT_CONTEXT_LIMIT = 10
const THREAD_CONTEXT_LIMIT = 50

async function loadChatContextIds(channelId: string) {
  const rows = await db
    .select({ id: schema.message.id })
    .from(schema.message)
    .where(
      and(
        eq(schema.message.channelId, channelId),
        chatFeedMessage(),
        ne(schema.message.type, "event")
      )
    )
    .orderBy(desc(schema.message.createdAt))
    .limit(CHAT_CONTEXT_LIMIT)
  return rows.map((row) => row.id)
}

async function loadThreadContextIds(threadRootId: string) {
  const replies = await db
    .select({ id: schema.message.id })
    .from(schema.message)
    .where(eq(schema.message.threadRootId, threadRootId))
    .orderBy(desc(schema.message.createdAt))
    .limit(THREAD_CONTEXT_LIMIT)
  return [threadRootId, ...replies.map((row) => row.id)]
}

// The picker only offers allowed repos, so a refusal here means the channel's
// tools or the GitHub connection changed since it loaded.
async function codeSessionStart(
  workspaceId: string,
  channelId: string,
  code: { repo: string; branch: string }
) {
  if (!isSafeBranch(code.branch)) {
    throw new Error(`"${code.branch}" can't be used as a base branch`)
  }
  const allowed = await channelCodeRepo(workspaceId, channelId, code.repo)
  if (!allowed) {
    throw new Error(
      `${code.repo} isn't available for code sessions in this channel`
    )
  }
  return { repoFullName: allowed.repo.fullName, baseBranch: code.branch }
}

// `@Lor` in channel chat or a human thread starts a session seeded with what
// led up to it, and nothing posts where it was sent
// (reference/workspace-model.md). Undefined = a normal send.
export async function sessionStartFor(args: {
  payload: SendMessagePayload
  channel: AccessibleChannel
  senderId: string
}): Promise<NewSessionInput | undefined> {
  const { payload, channel } = args
  if (!channel.workspaceId || channel.type !== "text") return undefined
  // A forward into chat is a post, even if its note says @Lor.
  if (payload.forward) return undefined
  const subscriberIds = [
    args.senderId,
    ...extractDirectMentionUserIds(payload.content ?? ""),
  ]
  const ids = {
    id: payload.newSession?.id,
    threadRootId: payload.newSession?.threadRootId,
  }
  if (payload.startSession && !payload.threadRootId) {
    const code = payload.code
      ? await codeSessionStart(
          channel.workspaceId,
          payload.channelId,
          payload.code
        )
      : undefined
    return {
      ...ids,
      origin: "new",
      ...(code ? { code } : {}),
      title: sessionTitleFromPrompt(payload.content ?? ""),
      // "Ask Lor about this": the quoted message is the only context.
      contextMessageIds: payload.referencedMessageId
        ? [payload.referencedMessageId]
        : [],
      subscriberIds,
    }
  }
  if (!payload.content || !isLorMentioned(payload.content)) return undefined
  if (
    payload.threadRootId &&
    (await findAgentSessionByThreadRoot(payload.threadRootId))
  ) {
    return undefined
  }

  const contextMessageIds = payload.threadRootId
    ? await loadThreadContextIds(payload.threadRootId)
    : await loadChatContextIds(payload.channelId)
  if (payload.referencedMessageId) {
    contextMessageIds.push(payload.referencedMessageId)
  }
  return {
    ...ids,
    origin: "chat",
    title: sessionTitleFromPrompt(payload.content),
    contextMessageIds,
    subscriberIds,
  }
}

// Empty Lor placeholder the worker streams into; no fanout (fires on completion).
export async function createLorPlaceholder(args: {
  accessibleChannel: AccessibleChannel
  channelId: string
  threadRootId: string | null
}): Promise<RealtimeMessage> {
  const result = await createMessage({
    userId: LOR_USER_ID,
    payload: {
      channelId: args.channelId,
      threadRootId: args.threadRootId ?? undefined,
    },
    accessibleChannel: args.accessibleChannel,
    status: "pending",
  })
  return result.message
}

// Durable agent_run row backing a Lor response (see
// reference/agent-harness.md). Limits are snapshotted from env here so an
// in-flight run keeps them across retries and config changes.
// "conflict" = the scope's one-active-run index rejected the insert (another
// mention won the race) — the caller re-routes at the winner. Other failures
// are propagated so the caller can compensate its placeholder.
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
        budgetWallMs: env.AGENT_RUN_MAX_WALL_MS,
        budgetCredits: env.AGENT_RUN_MAX_CREDITS,
      })
      .returning({ id: schema.agentRun.id })
      .then((r) => r[0] ?? null)
    return row?.id ?? null
  } catch (err) {
    if (isUniqueViolation(err)) return "conflict"
    logger.error({ err, channelId: args.channelId }, "Agent run insert failed")
    throw err
  }
}

export type RunRouteOutcome = {
  outcome: "steered" | "queued"
  runId: string
  lorMessageId: string
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
  // Conversational scopes always have a placeholder message — message-less
  // runs are headless triggered runs, which live on delivery-id scopes and
  // can never match here. Treat the impossible row as a free scope.
  const lorMessageId = run.messageId
  if (!lorMessageId) return null

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
      lorMessageId,
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
      lorMessageId,
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
      lorMessageId,
    }
  }

  return { outcome: state, runId: run.id, lorMessageId }
}
