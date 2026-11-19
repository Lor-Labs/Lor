import { randomUUID } from "node:crypto"
import {
  and,
  count,
  db,
  desc,
  eq,
  inArray,
  LOR_USER_ID,
  schema,
  sql,
} from "@repo/db"
import { listChannelAudienceUserIds } from "@repo/db/queries/channel-access"
import { createSession, toRealtimeAgentSession } from "@repo/lor/agent-sessions"
import { type AgentSessionTools, addInboxNote } from "@repo/lor/channel-agent"
import { channelCodeRepo, isSafeBranch } from "@repo/lor/code-repo"
import { resolveWorkspaceGithub } from "@repo/lor/github"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import {
  AGENT_INBOX_BATCH_MS,
  AGENT_INBOX_FLUSH_JOB,
  AGENT_RUN_STOP_CHANNEL,
  type AgentInboxFlushJobData,
  type LorRespondJobData,
} from "@repo/realtime-types/queues"
import { channelRoom } from "@repo/realtime-types/rooms"
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
  })
  if (started !== "started") {
    await db
      .delete(schema.message)
      .where(eq(schema.message.id, messageId))
      .catch(() => {})
  }
  return started
}

export function agentSessionExecutors(
  deps: SessionToolDeps,
  args: {
    workspaceId: string
    channelId: string
    channelName: string | null
    // Who woke the agent: they follow the sessions it starts for them.
    askerId: string | null
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
    start: async ({ repo, baseBranch, title, task }) => {
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
          creatorId: null,
          origin: "agent",
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
      const started = await runTask(deps, session, channelName, task)
      if (started !== "started") {
        logger.warn({ sessionId, started }, "Agent session did not start")
        return {
          error:
            "The session was created but its first turn did not start. Try message_session.",
          sessionId,
        }
      }
      return {
        sessionId,
        title,
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
  queue: Queue<AgentInboxFlushJobData>,
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
  if (!added) return
  await queue.add(
    AGENT_INBOX_FLUSH_JOB,
    { channelId: args.channelId },
    { delay: AGENT_INBOX_BATCH_MS, removeOnComplete: true, removeOnFail: 100 }
  )
}
