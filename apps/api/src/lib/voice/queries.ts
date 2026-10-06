import {
  and,
  count,
  db,
  desc,
  eq,
  exists,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  max,
  ne,
  or,
  schema,
  sql,
} from "@repo/db"

const {
  message,
  messageMention,
  threadReadState,
  user,
  voiceSession,
  voiceSessionParticipant,
  workspaceMember,
} = schema

export type VoiceParticipantSummary = {
  userId: string
  name: string
  image: string | null
  avatarColor: string | null
  connected: boolean
}

type SessionRow = {
  id: string
  threadRootId: string | null
  startedAt: Date
  endedAt: Date | null
  hasSummaryCard: boolean
  replyCount: number
  unreadCount: number
  mentionCount: number
}

// Correlated subqueries are built with the query builder, not raw sql:
// drizzle strips table names from columns placed directly in a single-table
// select list, which made `message.thread_root_id = voice_session.thread_root_id`
// render as `thread_root_id = thread_root_id`.
// People's chat only: Lor's summary card isn't counted as a message.
const replyCount = sql<number>`(${db
  .select({ value: count() })
  .from(message)
  .where(
    and(
      eq(message.threadRootId, voiceSession.threadRootId),
      ne(message.type, "call_summary")
    )
  )})::int`
const participantCount = sql<number>`(${db
  .select({ value: count() })
  .from(voiceSessionParticipant)
  .where(eq(voiceSessionParticipant.sessionId, voiceSession.id))})::int`

const sessionColumns = {
  id: voiceSession.id,
  threadRootId: voiceSession.threadRootId,
  startedAt: voiceSession.startedAt,
  endedAt: voiceSession.endedAt,
  hasSummaryCard: sql<boolean>`${voiceSession.summaryCardMessageId} is not null`,
  replyCount,
}

// History badges. The read cursor is the later of the viewer's thread read
// state and their own last reply. New replies count only in chats the viewer
// followed (read, posted in, or was in the call); mentions always count.
function viewerColumns(viewerId: string) {
  const readStateAt = db
    .select({ value: threadReadState.lastReadAt })
    .from(threadReadState)
    .where(
      and(
        eq(threadReadState.threadRootId, voiceSession.threadRootId),
        eq(threadReadState.userId, viewerId)
      )
    )
  const ownLastReplyAt = db
    .select({ value: max(message.createdAt) })
    .from(message)
    .where(
      and(
        eq(message.threadRootId, voiceSession.threadRootId),
        eq(message.authorId, viewerId)
      )
    )
  const readAt = sql`greatest((${readStateAt}), (${ownLastReplyAt}))`
  const since = sql`coalesce(${readAt}, 'epoch'::timestamp)`
  const wasInCall = exists(
    db
      .select({ value: sql`1` })
      .from(voiceSessionParticipant)
      .where(
        and(
          eq(voiceSessionParticipant.sessionId, voiceSession.id),
          eq(voiceSessionParticipant.userId, viewerId)
        )
      )
  )
  const newReplies = db
    .select({ value: count() })
    .from(message)
    .where(
      and(
        eq(message.threadRootId, voiceSession.threadRootId),
        ne(message.authorId, viewerId),
        gt(message.createdAt, since)
      )
    )
  const newMentions = db
    .select({ value: count() })
    .from(messageMention)
    .innerJoin(message, eq(message.id, messageMention.messageId))
    .where(
      and(
        eq(message.threadRootId, voiceSession.threadRootId),
        eq(messageMention.mentionedUserId, viewerId),
        eq(messageMention.mentionType, "direct"),
        gt(message.createdAt, since)
      )
    )
  return {
    unreadCount: sql<number>`(case when ${readAt} is not null or ${wasInCall} then (${newReplies}) else 0 end)::int`,
    mentionCount: sql<number>`(${newMentions})::int`,
  }
}

async function loadParticipants(sessionIds: string[], workspaceId: string) {
  const bySession = new Map<string, VoiceParticipantSummary[]>()
  if (sessionIds.length === 0) return bySession

  const rows = await db
    .select({
      sessionId: voiceSessionParticipant.sessionId,
      userId: voiceSessionParticipant.userId,
      name: user.name,
      image: user.image,
      avatarColor: workspaceMember.avatarColor,
      connectedAt: voiceSessionParticipant.connectedAt,
    })
    .from(voiceSessionParticipant)
    .innerJoin(user, eq(user.id, voiceSessionParticipant.userId))
    .leftJoin(
      workspaceMember,
      and(
        eq(workspaceMember.userId, voiceSessionParticipant.userId),
        eq(workspaceMember.workspaceId, workspaceId)
      )
    )
    .where(inArray(voiceSessionParticipant.sessionId, sessionIds))
    .orderBy(voiceSessionParticipant.firstJoinedAt)

  for (const row of rows) {
    const list = bySession.get(row.sessionId) ?? []
    list.push({
      userId: row.userId,
      name: row.name,
      image: row.image,
      avatarColor: row.avatarColor,
      connected: row.connectedAt !== null,
    })
    bySession.set(row.sessionId, list)
  }
  return bySession
}

function toSummary(
  row: SessionRow,
  participants: VoiceParticipantSummary[],
  viewerId: string
) {
  const live = row.endedAt === null
  // Live-only rule: a live session's chat activity shows only to the call.
  const inCall = participants.some(
    (participant) => participant.userId === viewerId && participant.connected
  )
  const hidden = live && !inCall
  return {
    id: row.id,
    threadRootId: row.threadRootId,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    live,
    replyCount: hidden ? 0 : row.replyCount,
    unreadCount: hidden ? 0 : row.unreadCount,
    mentionCount: hidden ? 0 : row.mentionCount,
    hasSummaryCard: row.hasSummaryCard,
    participants,
  }
}

export async function listSessionHistory(input: {
  channelId: string
  workspaceId: string
  viewerId: string
  before?: Date
  limit: number
}) {
  const rows = await db
    .select({ ...sessionColumns, ...viewerColumns(input.viewerId) })
    .from(voiceSession)
    .where(
      and(
        eq(voiceSession.channelId, input.channelId),
        input.before ? lt(voiceSession.startedAt, input.before) : undefined,
        // One-person sessions with nothing posted stay stored but hidden.
        // Lor's summary card counts as posted.
        or(
          isNull(voiceSession.endedAt),
          gte(participantCount, 2),
          gt(replyCount, 0),
          isNotNull(voiceSession.summaryCardMessageId)
        )
      )
    )
    .orderBy(desc(voiceSession.startedAt))
    .limit(input.limit + 1)

  const page = rows.slice(0, input.limit)
  const participants = await loadParticipants(
    page.map((row) => row.id),
    input.workspaceId
  )
  const last = page.at(-1)
  return {
    sessions: page.map((row) =>
      toSummary(row, participants.get(row.id) ?? [], input.viewerId)
    ),
    nextBefore:
      rows.length > input.limit && last ? last.startedAt.toISOString() : null,
  }
}

export async function getSessionSummary(sessionId: string, viewerId: string) {
  const [row] = await db
    .select({
      ...sessionColumns,
      ...viewerColumns(viewerId),
      channelId: voiceSession.channelId,
      workspaceId: voiceSession.workspaceId,
    })
    .from(voiceSession)
    .where(eq(voiceSession.id, sessionId))
    .limit(1)
  if (!row) return null

  const participants = await loadParticipants([row.id], row.workspaceId)
  return {
    channelId: row.channelId,
    session: toSummary(row, participants.get(row.id) ?? [], viewerId),
  }
}

// Sidebar presence: people connected to each live session the viewer can
// access. Never includes people who only view a channel.
export async function listWorkspacePresence(
  workspaceId: string,
  accessibleChannelIds: Set<string>
) {
  const live = await db
    .select({ id: voiceSession.id, channelId: voiceSession.channelId })
    .from(voiceSession)
    .where(
      and(
        eq(voiceSession.workspaceId, workspaceId),
        isNull(voiceSession.endedAt)
      )
    )
  const visible = live.filter((row) => accessibleChannelIds.has(row.channelId))
  const participants = await loadParticipants(
    visible.map((row) => row.id),
    workspaceId
  )

  return visible
    .map((row) => ({
      channelId: row.channelId,
      sessionId: row.id,
      participants: (participants.get(row.id) ?? []).filter(
        (participant) => participant.connected
      ),
    }))
    .filter((row) => row.participants.length > 0)
}
