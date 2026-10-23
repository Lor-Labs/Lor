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
import { toRealtimeAgentSession } from "@repo/lor/agent-sessions"
import { channelRoom } from "@repo/realtime-types/rooms"
import { getEmitter } from "@/lib/bot-messages"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { logger } from "@/lib/logger"
import { userCanAccessChannel } from "@/lib/queries/channel-access"
import { enqueueSessionSandboxDelete } from "@/lib/session-sandbox-queue"
import type { AppRouteHandler } from "@/lib/types/app-types"
import { notifyWorkspaceActivity } from "@/lib/workspace-activity"
import { requestRunStop } from "@/routes/v1/runs/handlers"
import type {
  GetAgentSessionRoute,
  ListChannelSessionsRoute,
  ListSessionFilesRoute,
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
