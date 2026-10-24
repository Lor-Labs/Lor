import { recordUsage } from "@repo/billing"
import {
  and,
  asc,
  db,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  schema,
  sql,
} from "@repo/db"
import { resolveChannelAccess } from "@repo/db/queries/channel-access"
import type {
  SessionCommittedPayload,
  SessionPushedPayload,
} from "@repo/db/schema"
import { toRealtimeAgentSession } from "@repo/lor/agent-sessions"
import {
  attachCodeSandbox,
  type CodeSandbox,
  CodeSandboxMissingError,
  commitStaged,
  generateCommitMessage,
  markPushed,
  pullBranch,
  readChanges,
  readFileDiff,
  readRepoFile,
  readRepoTree,
  readUnpushedCommits,
  stagePaths,
} from "@repo/lor/code-changes"
import { channelEventContent } from "@repo/messaging"
import type { RealtimeMessage } from "@repo/realtime-types"
import { channelRoom, threadRoom } from "@repo/realtime-types/rooms"
import { getEmitter } from "@/lib/bot-messages"
import { githubAccountToken } from "@/lib/github-account"
import { pullRequestLink, pushCommits } from "@/lib/github-push"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { logger } from "@/lib/logger"
import { userCanAccessChannel } from "@/lib/queries/channel-access"
import { enqueueSessionSandboxDelete } from "@/lib/session-sandbox-queue"
import type { AppRouteHandler } from "@/lib/types/app-types"
import { notifyWorkspaceActivity } from "@/lib/workspace-activity"
import { requestRunStop } from "@/routes/v1/runs/handlers"
import type {
  CommitSessionChangesRoute,
  GenerateSessionCommitMessageRoute,
  GetAgentSessionRoute,
  GetRepoFileRoute,
  GetRepoTreeRoute,
  GetSessionChangeDiffRoute,
  GetSessionChangesRoute,
  ListChannelSessionsRoute,
  ListSessionFilesRoute,
  PullSessionChangesRoute,
  PushSessionChangesRoute,
  StageSessionChangesRoute,
  UpdateAgentSessionRoute,
} from "@/routes/v1/sessions/routes"

// Null for "doesn't exist" and "not allowed" alike, so session ids can't
// probe private channels.
async function findAccessibleSession(sessionId: string, userId: string) {
  const row = await db
    .select({
      session: schema.agentSession,
      channelName: schema.channel.name,
      channelWorkspaceId: schema.channel.workspaceId,
    })
    .from(schema.agentSession)
    .innerJoin(
      schema.channel,
      eq(schema.agentSession.channelId, schema.channel.id)
    )
    .where(eq(schema.agentSession.id, sessionId))
    .limit(1)
    .then((rows) => rows[0])
  if (
    !row ||
    row.channelWorkspaceId !== row.session.workspaceId ||
    !(await userCanAccessChannel(row.session.channelId, userId))
  ) {
    return null
  }
  return row
}

export const getAgentSession: AppRouteHandler<GetAgentSessionRoute> = async (
  c
) => {
  const { sessionId } = c.req.valid("param")
  const row = await findAccessibleSession(sessionId, c.var.user.id)
  if (!row) {
    return c.json(
      { success: false as const, message: "Session not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  const context = await db
    .select({
      id: schema.message.id,
      createdAt: schema.message.createdAt,
    })
    .from(schema.agentSessionContext)
    .innerJoin(
      schema.message,
      eq(schema.agentSessionContext.messageId, schema.message.id)
    )
    .where(eq(schema.agentSessionContext.sessionId, sessionId))
    .orderBy(asc(schema.message.createdAt))
  const sourceId = row.session.sourceSessionId
  const source = sourceId
    ? await db
        .select({
          id: schema.agentSession.id,
          title: schema.agentSession.title,
        })
        .from(schema.agentSession)
        .where(eq(schema.agentSession.id, sourceId))
        .limit(1)
        .then((rows) => rows[0] ?? null)
    : null

  return c.json(
    {
      session: toRealtimeAgentSession(row.session),
      channel: { id: row.session.channelId, name: row.channelName },
      context: context.map((message) => ({
        id: message.id,
        createdAt: message.createdAt.toISOString(),
      })),
      source,
    },
    HttpStatusCodes.OK
  )
}

export const listSessionFiles: AppRouteHandler<ListSessionFilesRoute> = async (
  c
) => {
  const { sessionId } = c.req.valid("param")
  const row = await findAccessibleSession(sessionId, c.var.user.id)
  if (!row) {
    return c.json(
      { success: false as const, message: "Session not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  const { threadRootId } = row.session

  const [outputs, messages] = await Promise.all([
    db
      .select({
        id: schema.artifact.id,
        path: schema.artifact.path,
        mime: schema.artifactVersion.contentType,
        size: schema.artifactVersion.size,
        version: schema.artifact.currentVersion,
      })
      .from(schema.artifact)
      .innerJoin(
        schema.artifactVersion,
        and(
          eq(schema.artifactVersion.artifactId, schema.artifact.id),
          eq(schema.artifactVersion.version, schema.artifact.currentVersion)
        )
      )
      .where(eq(schema.artifact.threadRootId, threadRootId))
      .orderBy(desc(schema.artifact.updatedAt)),
    db
      .select({
        id: schema.message.id,
        attachments: schema.message.attachments,
      })
      .from(schema.message)
      .where(
        and(
          or(
            eq(schema.message.threadRootId, threadRootId),
            eq(schema.message.id, threadRootId)
          ),
          sql`jsonb_array_length(coalesce(${schema.message.attachments}, '[]'::jsonb)) > 0`
        )
      )
      .orderBy(asc(schema.message.createdAt)),
  ])

  return c.json(
    {
      outputs,
      sources: messages.flatMap((message) =>
        (message.attachments ?? []).map((attachment, index) => ({
          url: attachment.url,
          filename: attachment.filename,
          size: attachment.size,
          contentType: attachment.contentType,
          messageId: message.id,
          index,
        }))
      ),
    },
    HttpStatusCodes.OK
  )
}

// Bounded for now; older sessions stay reachable from search.
const CHANNEL_SESSION_LIMIT = 100

export const listChannelSessions: AppRouteHandler<
  ListChannelSessionsRoute
> = async (c) => {
  const currentUser = c.var.user
  const { channelId } = c.req.valid("param")
  const archived = c.req.valid("query").archived === "true"

  const access = await resolveChannelAccess(currentUser.id, channelId)
  if (!access.ok) {
    return c.json(
      { success: false as const, message: "Channel not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  const session = schema.agentSession
  const lastActivityAt =
    sql<Date>`greatest(${session.createdAt}, (select max(m.created_at) from message m where m.thread_root_id = ${session.threadRootId}))`.mapWith(
      session.createdAt
    )
  const rows = await db
    .select({
      id: session.id,
      title: session.title,
      titleEditedAt: session.titleEditedAt,
      loopId: session.loopId,
      repoFullName: session.repoFullName,
      archivedAt: session.archivedAt,
      lastActivityAt,
      creatorId: schema.user.id,
      creatorName: schema.user.name,
      creatorImage: schema.user.image,
      creatorAvatarColor: schema.workspaceMember.avatarColor,
      running: sql<boolean>`exists (select 1 from agent_run r where r.thread_root_id = ${session.threadRootId} and r.state in ('queued', 'working', 'finalizing'))`,
      subscribed: sql<boolean>`exists (select 1 from thread_subscription s where s.thread_root_id = ${session.threadRootId} and s.user_id = ${currentUser.id}::uuid)`,
    })
    .from(session)
    .leftJoin(schema.user, eq(schema.user.id, session.creatorId))
    .leftJoin(
      schema.workspaceMember,
      and(
        eq(schema.workspaceMember.userId, session.creatorId),
        eq(schema.workspaceMember.workspaceId, session.workspaceId)
      )
    )
    .where(
      and(
        eq(session.channelId, channelId),
        archived ? isNotNull(session.archivedAt) : isNull(session.archivedAt)
      )
    )
    .orderBy(archived ? desc(session.archivedAt) : desc(lastActivityAt))
    .limit(CHANNEL_SESSION_LIMIT)

  return c.json(
    {
      sessions: rows.map((row) => ({
        id: row.id,
        title: row.title,
        titleEdited: row.titleEditedAt !== null,
        loop: row.loopId !== null,
        repoFullName: row.repoFullName,
        creator:
          row.creatorId && row.creatorName
            ? {
                id: row.creatorId,
                name: row.creatorName,
                image: row.creatorImage,
                avatarColor: row.creatorAvatarColor,
              }
            : null,
        archivedAt: row.archivedAt?.toISOString() ?? null,
        lastActivityAt: row.lastActivityAt.toISOString(),
        running: row.running,
        subscribed: row.subscribed,
      })),
    },
    HttpStatusCodes.OK
  )
}

// Rename (stops generated titles), archive (closes the session for everyone
// and stops Lor), unarchive. Anyone who can write in the channel.
export const updateAgentSession: AppRouteHandler<
  UpdateAgentSessionRoute
> = async (c) => {
  const currentUser = c.var.user
  const { sessionId } = c.req.valid("param")
  const body = c.req.valid("json")

  const session = await db
    .select()
    .from(schema.agentSession)
    .where(eq(schema.agentSession.id, sessionId))
    .limit(1)
    .then((rows) => rows[0])
  const access = session
    ? await resolveChannelAccess(currentUser.id, session.channelId)
    : null
  if (!session || !access?.ok) {
    return c.json(
      { success: false as const, message: "Session not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  if (!access.access.canWrite) {
    return c.json(
      { success: false as const, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }

  const now = new Date()
  const archiving = body.archived === true && !session.archivedAt
  const patch = {
    ...(body.title !== undefined && {
      title: body.title,
      titleEditedAt: now,
    }),
    ...(archiving && { archivedAt: now, archivedById: currentUser.id }),
    ...(body.archived === false && { archivedAt: null, archivedById: null }),
  }
  // Archiving an already archived session changes nothing, and Drizzle
  // rejects an empty set.
  const updated =
    Object.keys(patch).length === 0
      ? session
      : await db
          .update(schema.agentSession)
          .set(patch)
          .where(eq(schema.agentSession.id, sessionId))
          .returning()
          .then((rows) => rows[0] ?? session)

  // The queue drain drops what is still queued once the session is archived.
  if (archiving) {
    const activeRuns = await db
      .select({
        id: schema.agentRun.id,
        messageId: schema.agentRun.messageId,
        channelId: schema.agentRun.channelId,
        threadRootId: schema.agentRun.threadRootId,
        state: schema.agentRun.state,
      })
      .from(schema.agentRun)
      .where(
        and(
          eq(schema.agentRun.threadRootId, session.threadRootId),
          inArray(schema.agentRun.state, ["queued", "working", "finalizing"]),
          isNotNull(schema.agentRun.messageId)
        )
      )
    for (const run of activeRuns) {
      if (!run.messageId) continue
      await requestRunStop(
        { ...run, messageId: run.messageId },
        currentUser.id
      ).catch((err) =>
        logger.warn({ err, runId: run.id }, "Archive run stop failed")
      )
    }
    // Loop sessions keep theirs: archiving one only dismisses it, and the
    // loop keeps running there.
    if (!session.loopId && updated.archivedAt) {
      void enqueueSessionSandboxDelete({
        sessionId,
        archivedAt: updated.archivedAt.toISOString(),
      }).catch((err) =>
        logger.warn({ err, sessionId }, "Session sandbox delete enqueue failed")
      )
    }
  }

  const realtimeSession = toRealtimeAgentSession(updated)
  void getEmitter()
    .then((io) =>
      io
        .to(channelRoom(session.channelId))
        .emit("session:updated", { session: realtimeSession })
    )
    .catch((err) =>
      logger.warn({ err, sessionId }, "Session update broadcast failed")
    )
  notifyWorkspaceActivity(session.workspaceId)
  return c.json({ session: realtimeSession }, HttpStatusCodes.OK)
}

// ── Code session Changes panel ─────────────────────────

const LOR_ACTIVE_RUN_STATES = ["queued", "working", "finalizing"] as const

// A code session the caller can see. Null otherwise, like findAccessibleSession.
async function findCodeSession(sessionId: string, userId: string) {
  const session = (await findAccessibleSession(sessionId, userId))?.session
  if (
    !session ||
    session.mode !== "code" ||
    !session.repoFullName ||
    !session.baseBranch
  ) {
    return null
  }
  return {
    ...session,
    repoFullName: session.repoFullName,
    baseBranch: session.baseBranch,
  }
}

type CodeSession = NonNullable<Awaited<ReturnType<typeof findCodeSession>>>

async function lorWorkingIn(threadRootId: string): Promise<boolean> {
  const [run] = await db
    .select({ id: schema.agentRun.id })
    .from(schema.agentRun)
    .where(
      and(
        eq(schema.agentRun.threadRootId, threadRootId),
        inArray(schema.agentRun.state, [...LOR_ACTIVE_RUN_STATES])
      )
    )
    .limit(1)
  return Boolean(run)
}

// "gone" when the sandbox or its repository folder no longer exists.
async function withCodeSandbox<T>(
  sessionId: string,
  use: (sandbox: CodeSandbox) => Promise<T>
): Promise<T | "gone"> {
  const sandbox = await attachCodeSandbox(sessionId)
  if (!sandbox) return "gone"
  try {
    return await use(sandbox)
  } catch (err) {
    if (err instanceof CodeSandboxMissingError) return "gone"
    throw err
  } finally {
    sandbox.close()
  }
}

async function changesBody(session: CodeSession, sandbox: CodeSandbox) {
  const [changes, lorWorking] = await Promise.all([
    readChanges(sandbox, session.baseBranch),
    lorWorkingIn(session.threadRootId),
  ])
  return {
    state: "ready" as const,
    repoFullName: session.repoFullName,
    baseBranch: session.baseBranch,
    lorWorking,
    ...changes,
  }
}

const codeSessionNotFound = {
  success: false as const,
  message: "Code session not found",
}

export const getSessionChanges: AppRouteHandler<
  GetSessionChangesRoute
> = async (c) => {
  const { sessionId } = c.req.valid("param")
  const session = await findCodeSession(sessionId, c.var.user.id)
  if (!session) return c.json(codeSessionNotFound, HttpStatusCodes.NOT_FOUND)
  const body = await withCodeSandbox(sessionId, (sandbox) =>
    changesBody(session, sandbox)
  )
  return c.json(
    body === "gone" ? { state: "gone" as const } : body,
    HttpStatusCodes.OK
  )
}

export const getSessionChangeDiff: AppRouteHandler<
  GetSessionChangeDiffRoute
> = async (c) => {
  const { sessionId } = c.req.valid("param")
  const query = c.req.valid("query")
  const session = await findCodeSession(sessionId, c.var.user.id)
  if (!session) return c.json(codeSessionNotFound, HttpStatusCodes.NOT_FOUND)
  const diff = await withCodeSandbox(sessionId, (sandbox) =>
    readFileDiff(
      sandbox,
      { path: query.path, oldPath: query.oldPath ?? null },
      query.untracked === "true"
    )
  )
  return c.json(
    diff === "gone" ? { kind: "gone" as const } : diff,
    HttpStatusCodes.OK
  )
}

export const stageSessionChanges: AppRouteHandler<
  StageSessionChangesRoute
> = async (c) => {
  const { sessionId } = c.req.valid("param")
  const body = c.req.valid("json")
  const session = await findCodeSession(sessionId, c.var.user.id)
  if (!session) return c.json(codeSessionNotFound, HttpStatusCodes.NOT_FOUND)
  // Lor's own edits and git would race a person's staging.
  if (await lorWorkingIn(session.threadRootId)) {
    return c.json(
      {
        success: false as const,
        message: "Lor is working in this session. Try again when it finishes.",
      },
      HttpStatusCodes.CONFLICT
    )
  }
  const result = await withCodeSandbox(sessionId, async (sandbox) => {
    await stagePaths(sandbox, {
      paths: body.all ? "all" : (body.paths ?? []),
      staged: body.staged,
    })
    return changesBody(session, sandbox)
  })
  if (result !== "gone") broadcastChangesUpdated(session, c.var.user.id)
  return c.json(
    result === "gone" ? { state: "gone" as const } : result,
    HttpStatusCodes.OK
  )
}

// Everyone else with the session open refetches its changes.
function broadcastChangesUpdated(
  session: CodeSession,
  byUserId: string,
  options?: { filesChanged: boolean }
) {
  void getEmitter()
    .then((io) =>
      io.to(threadRoom(session.threadRootId)).emit("session:changes:updated", {
        sessionId: session.id,
        threadRootId: session.threadRootId,
        byUserId,
        ...(options?.filesChanged ? { filesChanged: true } : {}),
      })
    )
    .catch((err) =>
      logger.warn({ err, sessionId: session.id }, "Changes broadcast failed")
    )
}

function linkedGithubAccount(userId: string) {
  return db
    .select({
      externalId: schema.personalAccount.externalId,
      login: schema.personalAccount.login,
      name: schema.personalAccount.name,
      email: schema.personalAccount.email,
    })
    .from(schema.personalAccount)
    .where(
      and(
        eq(schema.personalAccount.userId, userId),
        eq(schema.personalAccount.provider, "github")
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

// Commits show as the person on GitHub through their email; the noreply
// address when GitHub didn't share one.
function commitIdentity(account: {
  externalId: string
  login: string
  name: string | null
  email: string | null
}) {
  return {
    name: account.name || account.login,
    email:
      account.email ??
      `${account.externalId}+${account.login}@users.noreply.github.com`,
  }
}

export const commitSessionChanges: AppRouteHandler<
  CommitSessionChangesRoute
> = async (c) => {
  const { sessionId } = c.req.valid("param")
  const { message } = c.req.valid("json")
  const user = c.var.user
  const session = await findCodeSession(sessionId, user.id)
  if (!session) return c.json(codeSessionNotFound, HttpStatusCodes.NOT_FOUND)
  const refuse = (text: string) =>
    c.json(
      { success: false as const, message: text },
      HttpStatusCodes.BAD_REQUEST
    )
  if (await lorWorkingIn(session.threadRootId)) {
    return c.json(
      {
        success: false as const,
        message: "Lor is working in this session. Try again when it finishes.",
      },
      HttpStatusCodes.CONFLICT
    )
  }
  const account = await linkedGithubAccount(user.id)
  if (!account) return refuse("Link your GitHub account to commit as yourself")

  const result = await withCodeSandbox(sessionId, async (sandbox) => {
    const commit = await commitStaged(sandbox, {
      message,
      ...commitIdentity(account),
    })
    return commit.ok
      ? { commit, changes: await changesBody(session, sandbox) }
      : { commit, changes: null }
  })
  if (result === "gone") {
    return refuse("This session's sandbox no longer exists")
  }
  if (!result.commit.ok) return refuse(result.commit.detail)

  const { commit, changes } = result
  broadcastChangesUpdated(session, user.id)
  const author = eventAuthor(user)
  const eventPayload = {
    sessionId,
    sha: commit.sha,
    subject: commit.subject,
    branch: commit.branch,
    fileCount: commit.fileCount,
  }
  void postSessionEvent(
    session,
    author,
    { eventType: "session_committed", eventPayload },
    channelEventContent({
      eventType: "session_committed",
      actorName: author.name,
      ...eventPayload,
    })
  ).catch((err) => logger.error({ err, sessionId }, "Commit event failed"))
  return c.json(
    {
      commit: { sha: commit.sha, subject: commit.subject },
      changes: changes ?? { state: "gone" as const },
    },
    HttpStatusCodes.OK
  )
}

// Pushing doesn't touch the working tree, so it may run while Lor works.
export const pushSessionChanges: AppRouteHandler<
  PushSessionChangesRoute
> = async (c) => {
  const { sessionId } = c.req.valid("param")
  const user = c.var.user
  const session = await findCodeSession(sessionId, user.id)
  if (!session) return c.json(codeSessionNotFound, HttpStatusCodes.NOT_FOUND)
  const refuse = (text: string) =>
    c.json(
      { success: false as const, message: text },
      HttpStatusCodes.BAD_REQUEST
    )
  const account = await githubAccountToken(user.id)
  if (account.status === "missing") {
    return refuse("Link your GitHub account to push as yourself")
  }
  if (account.status === "expired") {
    return refuse(
      "Your GitHub link expired. Link it again in Settings → Linked accounts"
    )
  }

  const result = await withCodeSandbox(sessionId, async (sandbox) => {
    const unpushed = await readUnpushedCommits(sandbox, session.baseBranch)
    const failed = (error: string, behind = false) => ({
      ok: false as const,
      error,
      behind,
    })
    if (!unpushed.ok) return failed(unpushed.detail)
    if (unpushed.commits.length === 0) return failed("Nothing to push")
    const pushed = await pushCommits({
      token: account.token,
      repoFullName: session.repoFullName,
      branch: unpushed.branch,
      upstreamSha: unpushed.upstreamSha,
      commits: unpushed.commits,
      sandbox,
    })
    if (!pushed.ok) return failed(pushed.detail, pushed.behind)
    await markPushed(sandbox, unpushed.branch, pushed.headSha)
    return {
      ok: true as const,
      pushed: {
        branch: unpushed.branch,
        commitCount: unpushed.commits.length,
        headSha: pushed.headSha,
      },
      changes: await changesBody(session, sandbox),
    }
  })
  if (result === "gone") {
    return refuse("This session's sandbox no longer exists")
  }
  if (!result.ok) {
    // The client offers to pull, then push again.
    return result.behind
      ? c.json(
          { success: false as const, message: result.error },
          HttpStatusCodes.CONFLICT
        )
      : refuse(result.error)
  }

  const pullRequest = await pullRequestLink({
    token: account.token,
    repoFullName: session.repoFullName,
    branch: result.pushed.branch,
  })
  broadcastChangesUpdated(session, user.id)
  const author = eventAuthor(user)
  const eventPayload = {
    sessionId,
    repoFullName: session.repoFullName,
    ...result.pushed,
  }
  void postSessionEvent(
    session,
    author,
    { eventType: "session_pushed", eventPayload },
    channelEventContent({
      eventType: "session_pushed",
      actorName: author.name,
      ...eventPayload,
    })
  ).catch((err) => logger.error({ err, sessionId }, "Push event failed"))
  return c.json(
    { pushed: result.pushed, pullRequest, changes: result.changes },
    HttpStatusCodes.OK
  )
}

// Changes files, so it waits for Lor like staging does.
export const pullSessionChanges: AppRouteHandler<
  PullSessionChangesRoute
> = async (c) => {
  const { sessionId } = c.req.valid("param")
  const user = c.var.user
  const session = await findCodeSession(sessionId, user.id)
  if (!session) return c.json(codeSessionNotFound, HttpStatusCodes.NOT_FOUND)
  const refuse = (text: string) =>
    c.json(
      { success: false as const, message: text },
      HttpStatusCodes.BAD_REQUEST
    )
  if (await lorWorkingIn(session.threadRootId)) {
    return c.json(
      {
        success: false as const,
        message: "Lor is working in this session. Try again when it finishes.",
      },
      HttpStatusCodes.CONFLICT
    )
  }
  // A merge commit is made as the person, like Commit.
  const account = await linkedGithubAccount(user.id)
  if (!account) return refuse("Link your GitHub account to pull as yourself")

  const result = await withCodeSandbox(sessionId, async (sandbox) => {
    const pulled = await pullBranch(sandbox, {
      workspaceId: session.workspaceId,
      repoFullName: session.repoFullName,
      ...commitIdentity(account),
    })
    if (!pulled.ok) return pulled
    return {
      ok: true as const,
      pulled: {
        outcome: pulled.outcome,
        commitCount: pulled.commitCount,
        conflicts: pulled.outcome === "conflicts" ? pulled.conflicts : [],
      },
      changes: await changesBody(session, sandbox),
    }
  })
  if (result === "gone") {
    return refuse("This session's sandbox no longer exists")
  }
  if (!result.ok) return refuse(result.detail)
  if (result.pulled.commitCount > 0) {
    broadcastChangesUpdated(session, user.id, { filesChanged: true })
  }
  return c.json(
    { pulled: result.pulled, changes: result.changes },
    HttpStatusCodes.OK
  )
}

type EventAuthor = { id: string; name: string; image: string | null }

const eventAuthor = (user: {
  id: string
  name: string
  image?: string | null
}): EventAuthor => ({ id: user.id, name: user.name, image: user.image ?? null })

// A commit or push as a line in the session, for its people and for Lor there.
async function postSessionEvent(
  session: CodeSession,
  author: EventAuthor,
  event:
    | { eventType: "session_committed"; eventPayload: SessionCommittedPayload }
    | { eventType: "session_pushed"; eventPayload: SessionPushedPayload },
  content: string
) {
  const [row] = await db
    .insert(schema.message)
    .values({
      channelId: session.channelId,
      authorId: author.id,
      type: "event",
      ...event,
      content,
      threadRootId: session.threadRootId,
      excludedFromMemory: true,
    })
    .returning({ id: schema.message.id, createdAt: schema.message.createdAt })
  if (!row) return
  const message: RealtimeMessage = {
    id: row.id,
    channelId: session.channelId,
    content,
    type: "event",
    ...event,
    pinned: false,
    createdAt: row.createdAt.toISOString(),
    author,
    overrideName: null,
    overrideAvatarUrl: null,
    mentions: [],
    reactions: [],
    attachments: [],
    embeds: [],
    referencedMessage: null,
    threadRootId: session.threadRootId,
  }
  const io = await getEmitter()
  io.to(threadRoom(session.threadRootId)).emit("message:created", message)
  notifyWorkspaceActivity(session.workspaceId)
}

export const getRepoTree: AppRouteHandler<GetRepoTreeRoute> = async (c) => {
  const { sessionId } = c.req.valid("param")
  const session = await findCodeSession(sessionId, c.var.user.id)
  if (!session) return c.json(codeSessionNotFound, HttpStatusCodes.NOT_FOUND)
  const tree = await withCodeSandbox(sessionId, readRepoTree)
  return c.json(
    tree === "gone"
      ? { state: "gone" as const }
      : { state: "ready" as const, ...tree },
    HttpStatusCodes.OK
  )
}

export const getRepoFile: AppRouteHandler<GetRepoFileRoute> = async (c) => {
  const { sessionId } = c.req.valid("param")
  const { path } = c.req.valid("query")
  const session = await findCodeSession(sessionId, c.var.user.id)
  if (!session) return c.json(codeSessionNotFound, HttpStatusCodes.NOT_FOUND)
  const file = await withCodeSandbox(sessionId, (sandbox) =>
    readRepoFile(sandbox, path)
  )
  return c.json(
    file === "gone" ? { kind: "gone" as const } : file,
    HttpStatusCodes.OK
  )
}

export const generateSessionCommitMessage: AppRouteHandler<
  GenerateSessionCommitMessageRoute
> = async (c) => {
  const { sessionId } = c.req.valid("param")
  const session = await findCodeSession(sessionId, c.var.user.id)
  if (!session) return c.json(codeSessionNotFound, HttpStatusCodes.NOT_FOUND)
  const message = await withCodeSandbox(sessionId, (sandbox) =>
    generateCommitMessage(
      sandbox,
      { workspaceId: session.workspaceId, sessionTitle: session.title },
      (usage) => void recordUsage(usage, { channelId: session.channelId })
    )
  )
  return c.json(
    { message: message === "gone" ? null : message },
    HttpStatusCodes.OK
  )
}
