import { randomUUID } from "node:crypto"
import {
  and,
  db,
  desc,
  eq,
  inArray,
  isUniqueViolation,
  LOR_USER_ID,
  schema,
} from "@repo/db"
import { assertHostedHarness } from "@repo/db/queries/beta-access"
import { hasPersonalAccount } from "@repo/db/queries/personal-accounts"
import { env } from "@repo/env/server"
import { allowedCodeRepo, isSafeBranch } from "@repo/lor/code-repo"
import { environmentForRepo } from "@repo/lor/dev-env/environments"
import { extractDirectMentionUserIds } from "@repo/messaging"
import {
  type RealtimeMessage,
  type SendMessagePayload,
  sessionTitleFromPrompt,
} from "@repo/realtime-types"
import { assertHarnessEnabled } from "@repo/utils/features"
import { isValidNewBranchName, lorBranchName } from "@repo/utils/github"
import { logger } from "@/lib/logger"
import type { AccessibleChannel } from "@/services/channel-access"
import { createMessage, type NewSessionInput } from "@/services/messages"

// How much of a continued session's newest talk the new one carries.
const CONTINUED_CONTEXT_LIMIT = 50

// "Continue in Code": the source session's newest messages become the new
// session's context. Context must come from the new session's own channel.
async function continuedSession(sessionId: string, channelId: string) {
  const source = await db
    .select({
      id: schema.agentSession.id,
      channelId: schema.agentSession.channelId,
      threadRootId: schema.agentSession.threadRootId,
    })
    .from(schema.agentSession)
    .where(eq(schema.agentSession.id, sessionId))
    .limit(1)
    .then((rows) => rows[0])
  if (!source || source.channelId !== channelId) {
    throw new Error("That session can't be continued here")
  }
  const replies = await db
    .select({ id: schema.message.id })
    .from(schema.message)
    .where(eq(schema.message.threadRootId, source.threadRootId))
    .orderBy(desc(schema.message.createdAt))
    .limit(CONTINUED_CONTEXT_LIMIT)
  return { ...source, contextMessageIds: replies.map((row) => row.id) }
}

// The picker only offers allowed repos, so a refusal here means the channel's
// tools or the GitHub connection changed since it loaded.
async function codeSessionStart(
  workspaceId: string,
  channelId: string,
  code: NonNullable<SendMessagePayload["code"]>,
  session: { id: string }
) {
  if (!isSafeBranch(code.branch)) {
    throw new Error(`"${code.branch}" can't be used as a base branch`)
  }
  const named = code.newBranch
    ? code.newBranch
    : code.autoBranch
      ? lorBranchName(session.id)
      : null
  const newBranch = named && named !== code.branch ? named : null
  if (newBranch && !isValidNewBranchName(newBranch)) {
    throw new Error(`"${newBranch}" can't be used as a branch name`)
  }
  // A session a person starts uses the workspace default tools.
  const allowed = await allowedCodeRepo(workspaceId, null, code.repo)
  if (!allowed) {
    throw new Error(
      `${code.repo} isn't available for code sessions in this channel`
    )
  }
  const environmentId = code.environmentId
    ? await environmentForRepo(
        workspaceId,
        code.environmentId,
        allowed.repo.fullName
      )
    : null
  if (code.environmentId && !environmentId) {
    throw new Error(
      `That environment isn't set up for ${allowed.repo.fullName}`
    )
  }
  return {
    repoFullName: allowed.repo.fullName,
    baseBranch: code.branch,
    newBranch,
    environmentId,
  }
}

// The repo and harness a session start from the New session view asked for,
// checked.
async function codeStartFor(
  payload: SendMessagePayload,
  workspaceId: string,
  senderId: string,
  session: { id: string; title: string }
) {
  // Sessions run on Claude Code or Codex (reference/always-on-agents.md,
  // decision 34); Lor's own agent no longer starts them.
  if (payload.harness !== "claude_code" && payload.harness !== "codex") {
    throw new Error("Code sessions run on Claude Code or Codex")
  }
  assertHostedHarness(payload.harness)
  assertHarnessEnabled(payload.harness)
  const code = payload.code
    ? await codeSessionStart(
        workspaceId,
        payload.channelId,
        payload.code,
        session
      )
    : undefined
  // On the starter's own Claude subscription or ChatGPT plan
  // (code-sessions-runbook.md chunks 7 and 8f).
  const claudeCode = payload.harness === "claude_code"
  if (!code) {
    throw new Error(
      `${claudeCode ? "Claude Code" : "Codex"} sessions need a repository`
    )
  }
  if (
    !(await hasPersonalAccount(senderId, claudeCode ? "claude" : "chatgpt"))
  ) {
    throw new Error(
      claudeCode
        ? "Connect your Claude subscription in Settings → Linked accounts to start a Claude Code session"
        : "Connect your ChatGPT plan in Settings → Linked accounts to start a Codex session"
    )
  }
  return { code, harness: payload.harness }
}

// A New session send starts a code session: one repository, one branch.
// Anything else is a normal send: `@Lor` in the chat or a human thread wakes
// the channel's agent (reference/always-on-agents.md, step 3.4). Undefined =
// a normal send.
export async function sessionStartFor(args: {
  payload: SendMessagePayload
  channel: AccessibleChannel
  senderId: string
}): Promise<NewSessionInput | undefined> {
  const { payload, channel } = args
  if (!channel.workspaceId || channel.type !== "text") return undefined
  if (!payload.startSession || payload.threadRootId || payload.forward) {
    return undefined
  }
  if (!payload.code) {
    throw new Error(
      "A session works on a repository. Ask Lor in the channel's chat for anything else."
    )
  }
  // Picked here when the client didn't, so an automatic branch's name
  // carries the session's own id.
  const ids = {
    id: payload.newSession?.id ?? randomUUID(),
    threadRootId: payload.newSession?.threadRootId,
  }
  const title = sessionTitleFromPrompt(payload.content ?? "")
  const start = await codeStartFor(
    payload,
    channel.workspaceId,
    args.senderId,
    { id: ids.id, title }
  )
  const source = payload.continueFrom
    ? await continuedSession(payload.continueFrom, payload.channelId)
    : null
  return {
    ...ids,
    origin: "new",
    ...start,
    ...(source
      ? {
          sourceSessionId: source.id,
          sourceThreadRootId: source.threadRootId,
        }
      : {}),
    title,
    contextMessageIds: [
      ...(source?.contextMessageIds ?? []),
      ...(payload.referencedMessageId ? [payload.referencedMessageId] : []),
    ],
    subscriberIds: [
      args.senderId,
      ...extractDirectMentionUserIds(payload.content ?? ""),
    ],
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
