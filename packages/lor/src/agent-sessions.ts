import {
  and,
  db,
  eq,
  inArray,
  isUniqueViolation,
  LOR_USER_ID,
  schema,
} from "@repo/db"
import { listChannelAudienceUserIds } from "@repo/db/queries/channel-access"
import { subscribeToThread } from "@repo/db/queries/thread-subscriptions"
import type { AgentSession, Loop } from "@repo/db/schema"
import type { RealtimeAgentSession } from "@repo/realtime-types/events"
import { assertHarnessEnabled } from "@repo/utils/features"
import type { Exact, SerializedDates } from "./wire-guard"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const _realtimeAgentSessionMirrorsDbRow: Exact<
  SerializedDates<AgentSession>,
  RealtimeAgentSession
> = true
void _realtimeAgentSessionMirrorsDbRow

export function toRealtimeAgentSession(
  row: AgentSession
): RealtimeAgentSession {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    channelId: row.channelId,
    threadRootId: row.threadRootId,
    creatorId: row.creatorId,
    origin: row.origin,
    mode: row.mode,
    harness: row.harness,
    repoFullName: row.repoFullName,
    baseBranch: row.baseBranch,
    sourceSessionId: row.sourceSessionId,
    forkedFromMessageId: row.forkedFromMessageId,
    title: row.title,
    titleEditedAt: row.titleEditedAt?.toISOString() ?? null,
    loopId: row.loopId,
    triggerId: row.triggerId,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    archivedById: row.archivedById,
    lastActivityAt: row.lastActivityAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export type CreateSessionArgs = {
  // Client-chosen ids for an optimistic start; generated when unset.
  id?: string
  threadRootId?: string
  workspaceId: string
  channelId: string
  // Anchor author: the person who started it, or Lor for loops and triggers.
  authorId: string
  creatorId: string | null
  origin: AgentSession["origin"]
  // Set for a code session; checked against the channel's repos by the caller.
  code?: { repoFullName: string; baseBranch: string }
  // Claude Code: checked against the starter's Claude account by the caller.
  harness?: AgentSession["harness"]
  // "Continue in Code" or a fork: checked to be in the same channel by the
  // caller.
  sourceSessionId?: string
  forkedFromMessageId?: string
  title: string
  loopId?: string
  triggerId?: string
  contextMessageIds?: string[]
  subscriberIds?: string[]
}

// Anchor, session row, context and subscriptions in the caller's
// transaction, so a retried send (same nonce) can't leave an orphan session.
export async function createSession(
  tx: Tx,
  args: CreateSessionArgs
): Promise<AgentSession> {
  assertHarnessEnabled(args.harness ?? "pi")
  const [anchor] = await tx
    .insert(schema.message)
    .values({
      id: args.threadRootId,
      channelId: args.channelId,
      authorId: args.authorId,
      type: "agent_session",
    })
    .returning({ id: schema.message.id })
  if (!anchor) throw new Error("Failed to create session anchor")

  const [session] = await tx
    .insert(schema.agentSession)
    .values({
      id: args.id,
      workspaceId: args.workspaceId,
      channelId: args.channelId,
      threadRootId: anchor.id,
      creatorId: args.creatorId,
      origin: args.origin,
      mode: args.code ? "code" : "chat",
      harness: args.harness ?? "pi",
      repoFullName: args.code?.repoFullName ?? null,
      baseBranch: args.code?.baseBranch ?? null,
      sourceSessionId: args.sourceSessionId ?? null,
      forkedFromMessageId: args.forkedFromMessageId ?? null,
      title: args.title,
      loopId: args.loopId ?? null,
      triggerId: args.triggerId ?? null,
    })
    .returning()
  if (!session) throw new Error("Failed to create session")

  const requested = args.contextMessageIds ?? []
  if (requested.length > 0) {
    // Context comes only from the session's own channel, so it never carries
    // anything the session's audience can't already see.
    const inChannel = await tx
      .select({ id: schema.message.id })
      .from(schema.message)
      .where(
        and(
          inArray(schema.message.id, requested),
          eq(schema.message.channelId, args.channelId)
        )
      )
    if (inChannel.length > 0) {
      await tx
        .insert(schema.agentSessionContext)
        .values(
          inChannel.map((row) => ({ sessionId: session.id, messageId: row.id }))
        )
    }
  }

  if (args.subscriberIds?.length) {
    const audience = new Set(
      await listChannelAudienceUserIds(args.channelId, tx)
    )
    await subscribeToThread(
      anchor.id,
      args.subscriberIds.filter((userId) => audience.has(userId)),
      tx
    )
  }

  return session
}

async function findLoopSession(loopId: string) {
  const [row] = await db
    .select()
    .from(schema.agentSession)
    .where(eq(schema.agentSession.loopId, loopId))
    .limit(1)
  return row ?? null
}

// A loop's one recurring session, created on its first fire. Archive only
// dismisses a loop's session, so each fire brings it back.
export async function ensureLoopSession(
  loop: Pick<Loop, "id" | "workspaceId" | "channelId" | "creatorId" | "name">
): Promise<AgentSession> {
  const existing = await findLoopSession(loop.id)
  if (existing) {
    if (!existing.archivedAt) return existing
    const [unarchived] = await db
      .update(schema.agentSession)
      .set({ archivedAt: null, archivedById: null })
      .where(eq(schema.agentSession.id, existing.id))
      .returning()
    return unarchived ?? existing
  }

  try {
    return await db.transaction((tx) =>
      createSession(tx, {
        workspaceId: loop.workspaceId,
        channelId: loop.channelId,
        authorId: LOR_USER_ID,
        creatorId: null,
        origin: "loop",
        title: loop.name,
        loopId: loop.id,
        subscriberIds: loop.creatorId ? [loop.creatorId] : [],
      })
    )
  } catch (err) {
    // A concurrent fire created it first (agent_session_loopId_uidx).
    if (!isUniqueViolation(err)) throw err
    const winner = await findLoopSession(loop.id)
    if (!winner) throw err
    return winner
  }
}
