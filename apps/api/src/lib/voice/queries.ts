import {
  and,
  db,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
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
  replyCount: number
  unreadCount: number
  mentionCount: number
}

const replyCount = sql<number>`(select count(*) from ${message} where ${message.threadRootId} = ${voiceSession.threadRootId})::int`
const participantCount = sql<number>`(select count(*) from ${voiceSessionParticipant} where ${voiceSessionParticipant.sessionId} = ${voiceSession.id})::int`

const sessionColumns = {
  id: voiceSession.id,
  threadRootId: voiceSession.threadRootId,
  startedAt: voiceSession.startedAt,
  endedAt: voiceSession.endedAt,
  replyCount,
}

// History badges. The read cursor is the later of the viewer's thread read
// state and their own last reply. New replies count only in chats the viewer
// followed (read, posted in, or was in the call); mentions always count.
function viewerColumns(viewerId: string) {
  const readAt = sql`greatest(
    (select ${threadReadState.lastReadAt} from ${threadReadState}
      where ${threadReadState.threadRootId} = ${voiceSession.threadRootId}
        and ${threadReadState.userId} = ${viewerId}),
    (select max(${message.createdAt}) from ${message}
      where ${message.threadRootId} = ${voiceSession.threadRootId}
        and ${message.authorId} = ${viewerId})
  )`
  const since = sql`coalesce(${readAt}, 'epoch'::timestamp)`
  const followed = sql`(${readAt} is not null or exists (
    select 1 from ${voiceSessionParticipant}
      where ${voiceSessionParticipant.sessionId} = ${voiceSession.id}
        and ${voiceSessionParticipant.userId} = ${viewerId}))`
  return {
    unreadCount: sql<number>`(case when ${followed} then (
      select count(*) from ${message}
        where ${message.threadRootId} = ${voiceSession.threadRootId}
          and ${message.authorId} <> ${viewerId}
          and ${message.createdAt} > ${since}
    ) else 0 end)::int`,
    mentionCount: sql<number>`(
      select count(*) from ${messageMention}
        join ${message} on ${message.id} = ${messageMention.messageId}
        where ${message.threadRootId} = ${voiceSession.threadRootId}
          and ${messageMention.mentionedUserId} = ${viewerId}
          and ${messageMention.mentionType} = 'direct'
          and ${message.createdAt} > ${since}
    )::int`,
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
        or(
          isNull(voiceSession.endedAt),
          gte(participantCount, 2),
          gt(replyCount, 0)
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
