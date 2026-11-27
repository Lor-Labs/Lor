import { randomUUID } from "node:crypto"
import {
  APP_USER_ID,
  and,
  count,
  db,
  desc,
  eq,
  inArray,
  isNotNull,
  LOR_USER_ID,
  lt,
  notExists,
  schema,
  sql,
} from "@repo/db"
import { sessionStartedByAgent } from "@repo/db/queries/agent-conversations"
import { channelAgentId } from "@repo/db/queries/agents"
import { listChannelAudienceUserIds } from "@repo/db/queries/channel-access"
import {
  getHarnessSettings,
  HarnessAccountLimitError,
  hasOwnRequestRoute,
  PLAN_LIMIT_AGENT_HINT,
  personalRequestHarness,
  resolveHarnessAccount,
} from "@repo/db/queries/personal-accounts"
import { createSession, toRealtimeAgentSession } from "@repo/lor/agent-sessions"
import { type AgentSessionTools, addInboxNote } from "@repo/lor/channel-agent"
import { allowedCodeRepo, isSafeBranch } from "@repo/lor/code-repo"
import {
  postSessionApprovals,
  postSessionCard,
  updateSessionCard,
} from "@repo/lor/discord-sessions"
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
async function reposForAgent(
  workspaceId: string,
  agentId: string
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
      allowedCodeRepo(workspaceId, agentId, repo.fullName).catch(() => null)
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

// A session one of the agent's conversations started: they all see the
// same sessions under "Open right now". Another agent's are not its own.
async function agentSession(agentId: string, sessionId: string) {
  const [session] = await db
    .select()
    .from(schema.agentSession)
    .where(
      and(eq(schema.agentSession.id, sessionId), sessionStartedByAgent(agentId))
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

type TaskRoute = Awaited<ReturnType<typeof resolveHarnessAccount>> | undefined

// The requester's own account, else the accounts of the agent in the
// channel. Throws when neither has one that can be used.
async function taskRoute(
  workspaceId: string,
  channelId: string,
  harness: "pi" | "claude_code" | "codex",
  requestUserId: string | null
): Promise<TaskRoute> {
  return harness === "pi"
    ? undefined
    : await resolveHarnessAccount(
        {
          workspaceId,
          userId: requestUserId,
          agentId: requestUserId ? null : await channelAgentId(channelId),
        },
        harness === "claude_code" ? "claude" : "chatgpt"
      )
}

// Why no account can pay, as the agent is told it. A plan at its usage
// limit is the asker's to know about: the agent tells them.
function routeError(err: unknown) {
  if (err instanceof HarnessAccountLimitError) {
    return err.userId ? `${err.message} ${PLAN_LIMIT_AGENT_HINT}` : err.message
  }
  return err instanceof Error
    ? err.message
    : "Couldn't select an account for this session."
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
  task: string,
  harnessAccount: TaskRoute
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
    harnessAccount,
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

export function agentSessionExecutors(
  deps: SessionToolDeps,
  args: {
    workspaceId: string
    agentId: string
    // The conversation that starts a session, which its turns report to.
    conversationId: string
    channelId: string
    channelName: string | null
    // Who woke the agent: they follow the sessions it starts for them.
    askerId: string | null
    planUserId: string | null
    // Set only for a direct request; automation attribution is not a payer.
    requestUserId: string | null
    // The turn's place in the chat: a session started in a Discord place
    // moves it into the thread its card opens.
    turn?: { threadRootId: string | null; triggerMessageId?: string | null }
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
      // From Discord (decision 51) only a person with a linked Lor account
      // starts one, and it runs on that person's own plan: they own it.
      const place = await isPlace(channelId)
      let requestUserId = args.requestUserId
      if (place) {
        const owner = await personAsking(args.askerId)
        if (!owner) {
          return {
            error:
              "Code sessions from Discord need the person asking to link their Lor account. Tell them to run /lor connect-account in Discord, then ask again.",
          }
        }
        if (!(await hasOwnRequestRoute(workspaceId, owner))) {
          return {
            error:
              "A code session from Discord runs on the asker's own plan, and they have none in Lor. Tell them to link their Claude or ChatGPT account in Lor's settings, then ask again.",
          }
        }
        requestUserId = owner
      }
      const available = await reposForAgent(workspaceId, args.agentId)
      if ("error" in available) return available
      const { repos } = available
      if (!repo) return { repos }
      const allowed = await allowedCodeRepo(
        workspaceId,
        args.agentId,
        repo
      ).catch(() => null)
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

      const settings = await getHarnessSettings({
        agentId: await channelAgentId(channelId),
      })
      const harness =
        wanted ??
        (requestUserId
          ? await personalRequestHarness(workspaceId, requestUserId)
          : settings.defaultHarness)
      if (!isHarnessEnabled(harness))
        return {
          error:
            "The selected coding agent is unavailable. Update your linked accounts or this agent's settings.",
        }
      let route: TaskRoute
      try {
        route = await taskRoute(workspaceId, channelId, harness, requestUserId)
      } catch (err) {
        return { error: routeError(err) }
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
          creatorId: args.askerId,
          origin: "agent",
          conversationId: args.conversationId,
          harness,
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
      // Its card in Discord, in the thread of the request, which the agent's
      // answers move into.
      if (place) {
        const card = await postSessionCard({
          sessionId,
          channelId,
          agentId: args.agentId,
          threadRootId: args.turn?.threadRootId ?? null,
          triggerMessageId: args.turn?.triggerMessageId ?? null,
        }).catch((err: unknown) => {
          logger.warn({ err, sessionId }, "Discord session card failed")
          return null
        })
        if (card?.threadRootId && args.turn) {
          args.turn.threadRootId = card.threadRootId
        }
      }
      const started = await runTask(
        deps,
        session,
        channelName,
        task,
        route
      ).catch(async (err: unknown) => {
        logger.warn({ err, sessionId }, "Agent session first turn failed")
        // A run that took the brief before the throw may still be working.
        const [accepted] = await db
          .select({ id: schema.agentRun.id })
          .from(schema.agentRun)
          .where(eq(schema.agentRun.scopeKey, session.threadRootId))
          .limit(1)
        return accepted ? ("unknown" as const) : ("failed" as const)
      })
      if (started !== "started") {
        logger.warn({ sessionId, started }, "Agent session did not start")
        // Its Discord card would say "working" forever.
        if (started === "failed") {
          void updateSessionCard(sessionId, { state: "failed" }).catch(
            (err: unknown) =>
              logger.warn({ err, sessionId }, "Session card failed")
          )
        }
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
        runsOn: `${harness === "pi" ? "Lor" : harness === "codex" ? "Codex" : "Claude Code"} with ${requestUserId && harness !== "pi" ? "the requester's personal subscription" : "workspace API or autonomous billing"}`,
        ...(place
          ? {
              discord:
                "A card in the Discord thread shows this session with a link to it and follows its state; no need to paste the link.",
            }
          : {}),
        repo: allowed.repo.fullName,
        baseBranch: branch,
        branch: newBranch,
        link: await linkFor(sessionId),
      }
    },

    check: async ({ sessionId }) => {
      const session = await agentSession(args.agentId, sessionId)
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
      const session = await agentSession(args.agentId, sessionId)
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
      // A session from Discord goes on on its owner's plan, wherever the
      // follow-up comes from.
      const payer = (await isPlace(session.channelId))
        ? session.creatorId
        : args.requestUserId
      let route: TaskRoute
      try {
        route = await taskRoute(
          workspaceId,
          session.channelId,
          session.harness,
          payer
        )
      } catch (err) {
        return { error: routeError(err) }
      }
      const started = await runTask(deps, session, channelName, message, route)
      if (started === "started") {
        void updateSessionCard(session.id, { state: "working" }).catch(() => {})
      }
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
      const session = await agentSession(args.agentId, sessionId)
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

async function isPlace(channelId: string) {
  const [row] = await db
    .select({ kind: schema.channel.kind })
    .from(schema.channel)
    .where(eq(schema.channel.id, channelId))
  return row?.kind === "place"
}

// The person behind a turn: someone who wrote in Discord without a linked
// account is the app, not a person.
async function personAsking(userId: string | null) {
  if (!userId || userId === LOR_USER_ID || userId === APP_USER_ID) return null
  const [row] = await db
    .select({ isBot: schema.user.isBot })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
  return row && !row.isBot ? userId : null
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
  const [started] = await db
    .select({
      conversationId: schema.agentSession.conversationId,
      threadRootId: schema.agentSession.threadRootId,
    })
    .from(schema.agentSession)
    .where(eq(schema.agentSession.id, args.session.id))
  // The conversation that started the session reads its report; a session
  // from before conversations (none recorded) reports to the agent's own.
  const added = await addInboxNote({
    workspaceId: args.workspaceId,
    channelId: args.channelId,
    conversationId: started?.conversationId ?? null,
    source: "session",
    sourceId: args.runId,
    note,
    lane: "wake",
  })
  // Its card in Discord follows the session's latest run only: a repeated
  // report of an older run must not undo a newer one's state.
  const [latest] = started
    ? await db
        .select({ id: schema.agentRun.id })
        .from(schema.agentRun)
        .where(eq(schema.agentRun.scopeKey, started.threadRootId))
        .orderBy(desc(schema.agentRun.createdAt))
        .limit(1)
    : []
  if (latest?.id === args.runId) {
    void updateSessionCard(args.session.id, {
      state: args.outcome,
      report: reply,
    }).catch((err: unknown) =>
      logger.warn({ err, sessionId: args.session.id }, "Session card failed")
    )
  }
  // It asks there for what it waits on, once (a repeated report adds no
  // note), whether or not the card edit worked.
  if (added && args.outcome === "approval") {
    void postSessionApprovals(args.session.id, args.runId).catch(
      (err: unknown) =>
        logger.warn(
          { err, sessionId: args.session.id },
          "Session approvals failed"
        )
    )
  }
  // A repeated report adds no note, and the stranded-inbox sweep flushes a
  // first one whose enqueue failed.
  if (!added) {
    logger.info({ runId: args.runId }, "Helper report already noted")
    return
  }
  await queue?.add(
    AGENT_INBOX_FLUSH_JOB,
    { conversationId: added },
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
  // A helper session's run is in its session's chat.
  const channelId = run?.channelId
  if (!run?.messageId || !channelId) return
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
    channelId,
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

// Helper runs that ended without a report note (the insert failed, or the
// worker died between the run's end and the report). No age limit: a run
// stays eligible until its note exists.
export async function sweepUnreportedHelperRuns(): Promise<void> {
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
        lt(
          schema.agentRun.finishedAt,
          new Date(Date.now() - UNREPORTED_AFTER_MS)
        ),
        notExists(
          db
            .select({ id: schema.agentInbox.id })
            .from(schema.agentInbox)
            .where(
              and(
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
