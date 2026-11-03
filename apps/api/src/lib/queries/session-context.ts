import { db, schema } from "@repo/db"
import type { AgentSession } from "@repo/db/schema"
import { and, asc, desc, eq, inArray, lte } from "drizzle-orm"
import {
  type BareMessageRow,
  hydrateMessages,
  messageSelect,
} from "@/lib/queries/messages"

// What a session started with, as the messages people can read: the chat
// before `@Lor`, an "Ask Lor about this" message, a continued session's
// newest messages, or a fork's conversation up to the reply it forked from
// (walked up the fork chain). Shown folded at the top of the session.

// Newest messages across all segments; older ones are counted, not sent.
const CONTEXT_MESSAGES_MAX = 150
const FORK_DEPTH_MAX = 5

export type ContextSegmentKind = "fork" | "continued" | "asked" | "conversation"

type SessionRow = Pick<
  AgentSession,
  | "id"
  | "title"
  | "channelId"
  | "threadRootId"
  | "origin"
  | "sourceSessionId"
  | "forkedFromMessageId"
>

const sessionColumns = {
  id: schema.agentSession.id,
  title: schema.agentSession.title,
  channelId: schema.agentSession.channelId,
  threadRootId: schema.agentSession.threadRootId,
  origin: schema.agentSession.origin,
  sourceSessionId: schema.agentSession.sourceSessionId,
  forkedFromMessageId: schema.agentSession.forkedFromMessageId,
}

type PlannedSegment = {
  kind: ContextSegmentKind
  session: { id: string; title: string } | null
  ids: string[]
}

async function loadSession(id: string): Promise<SessionRow | null> {
  const [row] = await db
    .select(sessionColumns)
    .from(schema.agentSession)
    .where(eq(schema.agentSession.id, id))
    .limit(1)
  return row ?? null
}

// The source's thread up to the forked reply, without the turns a rewind set
// aside (Lor's branched log doesn't have them either).
async function forkedConversationIds(source: SessionRow, replyId: string) {
  const [reply] = await db
    .select({ createdAt: schema.message.createdAt })
    .from(schema.message)
    .where(eq(schema.message.id, replyId))
    .limit(1)
  if (!reply) return []
  const rows = await db
    .select({
      id: schema.message.id,
      type: schema.message.type,
      eventType: schema.message.eventType,
      eventPayload: schema.message.eventPayload,
    })
    .from(schema.message)
    .where(
      and(
        eq(schema.message.threadRootId, source.threadRootId),
        lte(schema.message.createdAt, reply.createdAt)
      )
    )
    .orderBy(asc(schema.message.createdAt), asc(schema.message.id))
  const setAside = new Set<number>()
  rows.forEach((row, end) => {
    if (row.type !== "event" || row.eventType !== "session_rewound") return
    const to = (row.eventPayload as { toMessageId?: string } | null)
      ?.toMessageId
    const start = rows.findIndex((candidate) => candidate.id === to) + 1
    for (let i = start; i <= end; i++) setAside.add(i)
  })
  const kept = rows.filter((_, index) => !setAside.has(index))
  // Same-millisecond rows after the reply aren't part of its turn.
  const at = kept.findIndex((row) => row.id === replyId)
  return (at >= 0 ? kept.slice(0, at + 1) : kept).map((row) => row.id)
}

async function startingContextIds(sessionId: string) {
  const rows = await db
    .select({ id: schema.agentSessionContext.messageId })
    .from(schema.agentSessionContext)
    .innerJoin(
      schema.message,
      eq(schema.agentSessionContext.messageId, schema.message.id)
    )
    .where(eq(schema.agentSessionContext.sessionId, sessionId))
    .orderBy(asc(schema.message.createdAt), asc(schema.message.id))
  return rows.map((row) => row.id)
}

// Newest first. Every session in the chain is in the session's own channel
// (forks and continuations can't leave it), so its audience sees all of it.
async function planSegments(session: SessionRow): Promise<PlannedSegment[]> {
  const segments: PlannedSegment[] = []
  let current = session
  for (let depth = 0; depth < FORK_DEPTH_MAX; depth++) {
    const source = current.sourceSessionId
      ? await loadSession(current.sourceSessionId)
      : null
    if (source && source.channelId !== session.channelId) break
    if (source && current.forkedFromMessageId) {
      segments.push({
        kind: "fork",
        session: { id: source.id, title: source.title },
        ids: await forkedConversationIds(source, current.forkedFromMessageId),
      })
      current = source
      continue
    }
    const ids = await startingContextIds(current.id)
    if (ids.length > 0) {
      segments.push({
        kind: source
          ? "continued"
          : current.origin === "chat"
            ? "conversation"
            : "asked",
        session: source ? { id: source.id, title: source.title } : null,
        ids,
      })
    }
    break
  }
  return segments
}

export async function fetchSessionContext(
  session: SessionRow,
  currentUserId: string
) {
  const planned = await planSegments(session)
  let budget = CONTEXT_MESSAGES_MAX
  const trimmed: (PlannedSegment & { omitted: number })[] = []
  for (const segment of planned) {
    if (budget <= 0) break
    const shown = segment.ids.slice(-budget)
    budget -= shown.length
    trimmed.push({
      ...segment,
      ids: shown,
      omitted: segment.ids.length - shown.length,
    })
  }
  const ids = trimmed.flatMap((segment) => segment.ids)
  const rows: BareMessageRow[] =
    ids.length > 0
      ? await db
          .select(messageSelect)
          .from(schema.message)
          .innerJoin(schema.user, eq(schema.message.authorId, schema.user.id))
          .where(inArray(schema.message.id, ids))
          .orderBy(desc(schema.message.createdAt))
      : []
  const hydrated = await hydrateMessages(rows, {
    channelId: session.channelId,
    currentUserId,
    threadSummaries: false,
  })
  const byId = new Map(hydrated.map((message) => [message.id, message]))
  return trimmed.reverse().map((segment) => ({
    kind: segment.kind,
    session: segment.session,
    omitted: segment.omitted,
    messages: segment.ids.flatMap((id) => {
      const message = byId.get(id)
      return message ? [message] : []
    }),
  }))
}
