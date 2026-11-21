import { randomUUID } from "node:crypto"
import {
  and,
  count,
  db,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  LOR_USER_ID,
  lt,
  notExists,
  schema,
  sql,
} from "@repo/db"
import { listChannelAudienceUserIds } from "@repo/db/queries/channel-access"
import { hasPersonalAccount } from "@repo/db/queries/personal-accounts"
import { createSession, toRealtimeAgentSession } from "@repo/lor/agent-sessions"
import { type AgentSessionTools, addInboxNote } from "@repo/lor/channel-agent"
import { channelCodeRepo, isSafeBranch } from "@repo/lor/code-repo"
import { resolveWorkspaceGithub } from "@repo/lor/github"
import { loadThreadSummary } from "@repo/messaging"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import {
  AGENT_INBOX_BATCH_MS,
  AGENT_INBOX_FLUSH_JOB,
  AGENT_RUN_STOP_CHANNEL,
  type AgentInboxFlushJobData,
  type LorRespondJobData,
} from "@repo/realtime-types/queues"
import { channelRoom, threadRoom } from "@repo/realtime-types/rooms"
import { isHarnessEnabled } from "@repo/utils/features"
import { lorBranchName } from "@repo/utils/github"
import type { Emitter } from "@socket.io/redis-emitter"
import type { Queue } from "bullmq"
import type { createClient } from "redis"
import { logger } from "@/lib/logger"
import { postLorMessage } from "@/lib/lor-messages"
import { startScopeRun } from "@/lib/run-queue"
import { notifyWorkspaceActivity } from "@/lib/workspace-activity"

// Code sessions the channel's agent runs as helpers
// (reference/always-on-agents.md §6). The agent's brief opens the session as
// an `agent_task` line, the session's own Lor works on it like any turn, and
// each turn's end reports back to the agent's inbox.

// A runaway guard, not a product limit (decision 26).
const ACTIVE_SESSIONS_MAX = 15
const REPLY_CHARS = 3_000
const REPORT_REPLY_CHARS = 1_500
const ACTIVE_RUN_STATES = ["queued", "working", "finalizing"] as const

type SessionToolDeps = {
  emitter: Emitter<ServerToClientEvents>
  redis: ReturnType<typeof createClient>
  respondQueue: Queue<LorRespondJobData>
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

// The repositories a session can use here, or why there are none.
async function reposForChannel(
  workspaceId: string,
  channelId: string
): Promise<
  { repos: { repo: string; defaultBranch: string }[] } | { error: string }
> {
  const github = await resolveWorkspaceGithub(workspaceId).catch(() => null)
  if (!github) {
    return {
      error:
        "GitHub is not connected. A workspace admin can connect it in Settings → Connectors.",
    }
  }
  if (github.repos.length === 0) {
    return {
      error:
        "GitHub is connected, but Lor can't list its repositories right now. Say so; it may be a connection problem.",
    }
  }
  const allowed = await Promise.all(
    github.repos.map((repo) =>
      channelCodeRepo(workspaceId, channelId, repo.fullName).catch(() => null)
    )
  )
  const repos = allowed.flatMap((found) =>
    found
      ? [{ repo: found.repo.fullName, defaultBranch: found.repo.defaultBranch }]
      : []
  )
  return repos.length > 0
    ? { repos }
    : {
        error:
          "This channel's agent profile does not allow code. A workspace admin can allow it in the channel's Agent settings.",
      }
}

async function agentSession(channelId: string, sessionId: string) {
  const [session] = await db
    .select()
    .from(schema.agentSession)
    .where(
      and(
        eq(schema.agentSession.id, sessionId),
        eq(schema.agentSession.channelId, channelId),
        eq(schema.agentSession.origin, "agent")
      )
    )
  return session ?? null
}

async function activeRun(threadRootId: string) {
  const [run] = await db
    .select({ id: schema.agentRun.id, state: schema.agentRun.state })
    .from(schema.agentRun)
    .where(
      and(
        eq(schema.agentRun.scopeKey, threadRootId),
        inArray(schema.agentRun.state, [...ACTIVE_RUN_STATES])
      )
    )
    .limit(1)
  return run ?? null
}

// The agent's brief or follow-up, as the session's next turn.
async function runTask(
  deps: SessionToolDeps,
  session: {
    workspaceId: string
    channelId: string
    threadRootId: string
  },
  channelName: string | null,
  task: string
): Promise<"started" | "busy" | "failed"> {
  const { messageId } = await postLorMessage(deps, {
    channelId: session.channelId,
    threadRootId: session.threadRootId,
    content: task,
    type: "event",
    eventType: "agent_task",
    eventPayload: { channelName },
    silent: true,
  })
  const started = await startScopeRun(deps, {
    workspaceId: session.workspaceId,
    channelId: session.channelId,
    threadRootId: session.threadRootId,
    scopeKey: session.threadRootId,
    triggerMessageId: messageId,
  }).catch(async (err: unknown) => {
    // Failed before a run took the brief: remove it. Once a run exists it
    // may point at the brief as its trigger, so it stays.
    const [accepted] = await db
      .select({ id: schema.agentRun.id })
      .from(schema.agentRun)
      .where(eq(schema.agentRun.triggerMessageId, messageId))
      .limit(1)
    if (accepted) throw err
    logger.warn({ err, messageId }, "Agent task start failed")
    return "failed" as const
  })
  if (started !== "started") {
    const deleted = await db
      .delete(schema.message)
      .where(eq(schema.message.id, messageId))
      .then(() => true)
      .catch(() => false)
    if (deleted) {
      deps.emitter
        .to(threadRoom(session.threadRootId))
        .emit("message:deleted", { channelId: session.channelId, messageId })
      await loadThreadSummary(session.channelId, session.threadRootId)
        .then((summary) =>
          deps.emitter
            .to(channelRoom(session.channelId))
            .emit("message:thread:updated", summary)
        )
        .catch((err) =>
          logger.warn({ err, messageId }, "Thread summary emit failed")
        )
    }
  }
  return started
}

// The harness and plan a session the agent starts runs on: Claude Code when
// the person has Claude connected, else Codex, unless the agent asked for
// one. An error the agent reads when there is no such plan.
async function planFor(
  userId: string | null,
  wanted: "claude_code" | "codex" | undefined
): Promise<
  | { userId: string; name: string; harness: "claude_code" | "codex" }
  | { error: string }
> {
  if (!userId) {
    return {
      error:
        "No person started this turn, so there is no Claude or ChatGPT plan to run a session on. Ask someone in the chat to start it with you.",
    }
  }
  const [[person], claude, chatgpt] = await Promise.all([
    db
      .select({ name: schema.user.name })
      .from(schema.user)
      .where(eq(schema.user.id, userId)),
    hasPersonalAccount(userId, "claude"),
    hasPersonalAccount(userId, "chatgpt"),
  ])
  const name = person?.name ?? "This person"
  const offered = (harness: "claude_code" | "codex") =>
    isHarnessEnabled(harness)
  const harness =
    wanted ??
    (claude && offered("claude_code")
      ? "claude_code"
      : chatgpt && offered("codex")
        ? "codex"
        : null)
  const codexToo = chatgpt && offered("codex")
  const claudeToo = claude && offered("claude_code")
  if (harness === "claude_code" && !offered("claude_code")) {
    return {
      error: `Claude Code is switched off on this Lor server${codexToo ? `, but you can use Codex on ${name}'s ChatGPT plan` : ""}.`,
    }
  }
  if (harness === "codex" && !offered("codex")) {
    return {
      error: `Codex is switched off on this Lor server${claudeToo ? `, but you can use Claude Code on ${name}'s Claude subscription` : ""}.`,
    }
  }
  if (harness === "claude_code" && !claude) {
    return {
      error: `${name} hasn't connected a Claude subscription, so Claude Code can't run for them. They can connect one in Settings → Linked accounts${codexToo ? ", or you can use Codex on their ChatGPT plan" : ""}.`,
    }
  }
  if (harness === "codex" && !chatgpt) {
    return {
      error: `${name} hasn't connected a ChatGPT plan, so Codex can't run for them. They can connect one in Settings → Linked accounts${claudeToo ? ", or you can use Claude Code on their Claude subscription" : ""}.`,
    }
  }
  if (!harness && (claude || chatgpt)) {
    return {
      error: `${claude ? "Claude Code" : "Codex"}${claude && chatgpt ? " and Codex are" : " is"} switched off on this Lor server, so ${name}'s linked plan can't run a code session.`,
    }
  }
  if (!harness) {
    return {
      error: `${name} hasn't connected a Claude or ChatGPT plan, and code sessions run on one. They can connect one in Settings → Linked accounts.`,
    }
  }
  return { userId, name, harness }
}

export function agentSessionExecutors(
  deps: SessionToolDeps,
  args: {
    workspaceId: string
    channelId: string
    channelName: string | null
    // Who woke the agent: they follow the sessions it starts for them.
    askerId: string | null
    // Whose Claude or ChatGPT plan runs the sessions it starts: the asker,
    // or on a turn no person started, whoever set up its Loop or trigger.
    planUserId: string | null
  }
): AgentSessionTools {
  const { workspaceId, channelId, channelName } = args
  const linkFor = async (sessionId: string) => {
    const [workspace] = await db
      .select({ slug: schema.workspace.slug })
      .from(schema.workspace)
      .where(eq(schema.workspace.id, workspaceId))
    return workspace ? `/${workspace.slug}/session/${sessionId}` : null
  }

  return {
    start: async ({ repo, baseBranch, title, task, harness: wanted }) => {
      const available = await reposForChannel(workspaceId, channelId)
      if ("error" in available) return available
      const { repos } = available
      if (!repo) return { repos }
      const allowed = await channelCodeRepo(workspaceId, channelId, repo).catch(
        () => null
      )
      if (!allowed) {
        return { error: `${repo} is not available here.`, repos }
      }
      const branch = baseBranch?.trim() || allowed.repo.defaultBranch
      if (!isSafeBranch(branch)) {
        return { error: `${branch} is not a branch name Lor can use.` }
      }
      const [running] = await db
        .select({ n: count() })
        .from(schema.agentRun)
        .innerJoin(
          schema.agentSession,
          eq(schema.agentSession.threadRootId, schema.agentRun.scopeKey)
        )
        .where(
          and(
            eq(schema.agentSession.channelId, channelId),
            eq(schema.agentSession.origin, "agent"),
            inArray(schema.agentRun.state, [...ACTIVE_RUN_STATES])
          )
        )
      if ((running?.n ?? 0) >= ACTIVE_SESSIONS_MAX) {
        return {
          error: `${ACTIVE_SESSIONS_MAX} of your sessions are working already. Wait for one to report, or stop one.`,
        }
      }

      // Sessions run on a person's own Claude Code or Codex plan
      // (reference/always-on-agents.md, decisions 16 and 34).
      const plan = await planFor(args.planUserId, wanted)
      if ("error" in plan) return plan

      const audience = args.askerId
        ? await listChannelAudienceUserIds(channelId)
        : []
      const sessionId = randomUUID()
      const newBranch = lorBranchName(sessionId)
      const session = await db.transaction((tx) =>
        createSession(tx, {
          id: sessionId,
          workspaceId,
          channelId,
          authorId: LOR_USER_ID,
          // The person whose plan runs its turns.
          creatorId: plan.userId,
          origin: "agent",
          harness: plan.harness,
          title,
          code: {
            repoFullName: allowed.repo.fullName,
            baseBranch: branch,
            newBranch,
          },
          subscriberIds:
            args.askerId && audience.includes(args.askerId)
              ? [args.askerId]
              : [],
        })
      )
      deps.emitter
        .to(channelRoom(channelId))
        .emit("session:updated", { session: toRealtimeAgentSession(session) })
      notifyWorkspaceActivity(workspaceId)
      // The session's line in the chat, linking to it.
      await postLorMessage(deps, {
        channelId,
        content: `Started a code session: ${title}`,
        type: "event",
        eventType: "agent_session_started",
        eventPayload: {
          sessionId,
          title,
          repoFullName: allowed.repo.fullName,
        },
        silent: true,
      }).catch((err) =>
        logger.warn({ err, sessionId }, "Agent session line failed")
      )
      const started = await runTask(deps, session, channelName, task).catch(
        (err: unknown) => {
          logger.warn({ err, sessionId }, "Agent session first turn failed")
          return "failed" as const
        }
      )
      if (started !== "started") {
        logger.warn({ sessionId, started }, "Agent session did not start")
        return {
          error:
            "The session was created but its first turn may not have started. Check it with check_session before sending the brief again with message_session.",
          // The session exists: a retried step replays this, not a new one.
          outcome: "unknown",
          sessionId,
        }
      }
      return {
        sessionId,
        title,
        runsOn: `${plan.harness === "codex" ? "Codex" : "Claude Code"} on ${plan.name}'s plan`,
        repo: allowed.repo.fullName,
        baseBranch: branch,
        branch: newBranch,
        link: await linkFor(sessionId),
      }
    },

    check: async ({ sessionId }) => {
      const session = await agentSession(channelId, sessionId)
      if (!session) return { error: "No session you started has that id." }
      const [run, pending, lastRun, reply] = await Promise.all([
        activeRun(session.threadRootId),
        db
          .select({ n: count() })
          .from(schema.approval)
          .innerJoin(
            schema.agentRun,
            eq(schema.agentRun.id, schema.approval.runId)
          )
          .where(
            and(
              eq(schema.agentRun.scopeKey, session.threadRootId),
              eq(schema.approval.status, "pending")
            )
          )
          .then((rows) => rows[0]?.n ?? 0),
        db
          .select({ state: schema.agentRun.state })
          .from(schema.agentRun)
          .where(eq(schema.agentRun.scopeKey, session.threadRootId))
          .orderBy(desc(schema.agentRun.createdAt))
          .limit(1)
          .then((rows) => rows[0] ?? null),
        db
          .select({ content: schema.message.content })
          .from(schema.message)
          .where(
            and(
              eq(schema.message.threadRootId, session.threadRootId),
              eq(schema.message.authorId, LOR_USER_ID),
              eq(schema.message.type, "default"),
              sql`${schema.message.content} is not null`
            )
          )
          .orderBy(desc(schema.message.createdAt))
          .limit(1)
          .then((rows) => rows[0]?.content ?? null),
      ])
      const status = run
        ? "working"
        : pending > 0
          ? "waiting for approval"
          : lastRun?.state === "failed"
            ? "failed"
            : lastRun?.state === "stopped"
              ? "stopped"
              : "idle"
      return {
        sessionId,
        title: session.title,
        status,
        repo: session.repoFullName,
        branch: session.newBranch,
        archived: session.archivedAt !== null,
        lastReply: reply ? clip(reply, REPLY_CHARS) : null,
        link: await linkFor(sessionId),
      }
    },

    message: async ({ sessionId, message }) => {
      const session = await agentSession(channelId, sessionId)
      if (!session) return { error: "No session you started has that id." }
      if (session.archivedAt) {
        return { error: "That session is archived. Start a new one." }
      }
      if (await activeRun(session.threadRootId)) {
        return {
          error:
            "The session is working. Wait for its report, or stop it first.",
        }
      }
      const started = await runTask(deps, session, channelName, message)
      if (started === "failed") {
        return {
          error: "The follow-up did not start. You can send it again.",
        }
      }
      return started === "started"
        ? { ok: true }
        : { error: "The session is busy. Wait for its report." }
    },

    stop: async ({ sessionId }) => {
      const session = await agentSession(channelId, sessionId)
      if (!session) return { error: "No session you started has that id." }
      const run = await activeRun(session.threadRootId)
      if (!run) return { ok: true, note: "It was not working." }
      if (run.state === "queued") {
        return { error: "Its turn has not started yet. Try again shortly." }
      }
      await db
        .update(schema.agentRun)
        .set({
          stopRequestedAt: sql`coalesce(${schema.agentRun.stopRequestedAt}, now())`,
        })
        .where(eq(schema.agentRun.id, run.id))
      await deps.redis.publish(AGENT_RUN_STOP_CHANNEL, run.id).catch(() => {})
      return { ok: true }
    },
  }
}

export type HelperOutcome = "finished" | "approval" | "failed" | "stopped"

const OUTCOME_TEXT: Record<HelperOutcome, string> = {
  finished: "finished its turn",
  approval: "is waiting for a person's approval",
  failed: "failed",
  stopped: "was stopped",
}

// A helper session's turn ended: the agent reads a short report next turn,
// and it wakes for it.
export async function reportHelperTurn(
  // Null: no flush here; the stranded-inbox sweep wakes the agent for it.
  queue: Queue<AgentInboxFlushJobData> | null,
  args: {
    workspaceId: string
    channelId: string
    runId: string
    session: { id: string; title: string; newBranch: string | null }
    outcome: HelperOutcome
    reply: string
    // The session's reply message, which read_thread reads in full.
    replyMessageId: string
  }
): Promise<void> {
  const reply = args.reply.trim()
  const cut = reply.length > REPORT_REPLY_CHARS
  const note = `Session "${args.session.title}" (session ${args.session.id}${args.session.newBranch ? `, branch ${args.session.newBranch}` : ""}) ${OUTCOME_TEXT[args.outcome]}.${reply ? `\nIts reply${cut ? ` (cut short here; read_thread with message ${args.replyMessageId} reads it in full)` : ""}:\n${clip(reply, REPORT_REPLY_CHARS)}` : ""}`
  const added = await addInboxNote({
    workspaceId: args.workspaceId,
    channelId: args.channelId,
    source: "session",
    sourceId: args.runId,
    note,
    lane: "wake",
  })
  // A repeated report adds no note but still asks for the flush, in case
  // the first one's enqueue failed.
  if (!added) logger.info({ runId: args.runId }, "Helper report already noted")
  await queue?.add(
    AGENT_INBOX_FLUSH_JOB,
    { channelId: args.channelId },
    { delay: AGENT_INBOX_BATCH_MS, removeOnComplete: true, removeOnFail: 100 }
  )
}

// A helper run's report rebuilt from its saved row, for runs that ended
// outside the turn's own report: attempts used up, a dead run, or a report
// insert that failed. The run id keeps it to one note.
export async function reportHelperRun(
  queue: Queue<AgentInboxFlushJobData> | null,
  runId: string
): Promise<void> {
  const [run] = await db
    .select({
      workspaceId: schema.agentRun.workspaceId,
      channelId: schema.agentRun.channelId,
      state: schema.agentRun.state,
      stopReason: schema.agentRun.stopReason,
      messageId: schema.agentRun.messageId,
      reply: schema.message.content,
      sessionId: schema.agentSession.id,
      title: schema.agentSession.title,
      newBranch: schema.agentSession.newBranch,
    })
    .from(schema.agentRun)
    .innerJoin(
      schema.agentSession,
      and(
        eq(schema.agentSession.threadRootId, schema.agentRun.scopeKey),
        eq(schema.agentSession.origin, "agent")
      )
    )
    .leftJoin(schema.message, eq(schema.message.id, schema.agentRun.messageId))
    .where(eq(schema.agentRun.id, runId))
  if (!run?.messageId) return
  const outcome: HelperOutcome | null =
    run.state === "failed"
      ? "failed"
      : run.state === "stopped"
        ? "stopped"
        : run.state === "complete"
          ? run.stopReason === "awaiting_approval"
            ? "approval"
            : "finished"
          : null
  if (!outcome) return
  await reportHelperTurn(queue, {
    workspaceId: run.workspaceId,
    channelId: run.channelId,
    runId,
    session: {
      id: run.sessionId,
      title: run.title ?? "Session",
      newBranch: run.newBranch,
    },
    outcome,
    reply: run.reply ?? "",
    replyMessageId: run.messageId,
  })
}

const UNREPORTED_AFTER_MS = 2 * 60_000
const UNREPORTED_WITHIN_MS = 24 * 60 * 60_000

// Helper runs that ended without a report note (the insert failed, or the
// worker died between the run's end and the report).
export async function sweepUnreportedHelperRuns(): Promise<void> {
  const now = Date.now()
  const runs = await db
    .select({ id: schema.agentRun.id })
    .from(schema.agentSession)
    .innerJoin(
      schema.agentRun,
      eq(schema.agentRun.scopeKey, schema.agentSession.threadRootId)
    )
    .where(
      and(
        eq(schema.agentSession.origin, "agent"),
        inArray(schema.agentRun.state, ["complete", "failed", "stopped"]),
        isNotNull(schema.agentRun.messageId),
        gt(schema.agentRun.finishedAt, new Date(now - UNREPORTED_WITHIN_MS)),
        lt(schema.agentRun.finishedAt, new Date(now - UNREPORTED_AFTER_MS)),
        notExists(
          db
            .select({ id: schema.agentInbox.id })
            .from(schema.agentInbox)
            .where(
              and(
                eq(schema.agentInbox.channelId, schema.agentRun.channelId),
                eq(schema.agentInbox.source, "session"),
                eq(schema.agentInbox.sourceId, sql`${schema.agentRun.id}::text`)
              )
            )
        )
      )
    )
    .limit(200)
  for (const run of runs) {
    await reportHelperRun(null, run.id).catch((err) =>
      logger.error({ err, runId: run.id }, "Unreported helper run sweep failed")
    )
  }
}
