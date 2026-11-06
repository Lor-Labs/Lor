import { db, eq, inArray, schema } from "@repo/db"
import { listChannelAudienceUserIds } from "@repo/db/queries/channel-access"
import type { ChangedFilesUpdate } from "@repo/lor/uncommitted-lines"
import {
  createOverlapTracker,
  createRedisStore,
  type OverlapTracker,
} from "@repo/overlap"
import type {
  ServerToClientEvents,
  SessionOverlap,
} from "@repo/realtime-types/events"
import { userRoom } from "@repo/realtime-types/rooms"
import type { Emitter } from "@socket.io/redis-emitter"
import type { createClient } from "redis"
import { logger } from "@/lib/logger"

// Live overlap alerts: two people's code sessions with uncommitted edits to
// the same files in the same repo. Detection lives in @repo/overlap; this
// file feeds it Lor's changed-file reads and sends the alerts.

type RedisClient = ReturnType<typeof createClient>

let tracker: OverlapTracker | null = null
let emitter: Emitter<ServerToClientEvents> | null = null

export function installOverlapDetection(
  e: Emitter<ServerToClientEvents>,
  redis: RedisClient
) {
  emitter = e
  tracker = createOverlapTracker({
    store: createRedisStore({
      hSet: (key, field, value) => redis.hSet(key, field, value),
      hGetAll: async (key) =>
        Object.fromEntries(
          Object.entries(await redis.hGetAll(key)).map(([field, value]) => [
            field,
            String(value),
          ])
        ),
      hDel: (key, field) => redis.hDel(key, field),
      pExpire: (key, ms) => redis.pExpire(key, ms),
      setNx: async (key, value, ms) =>
        (await redis.set(key, value, { NX: true, PX: ms })) === "OK",
    }),
  })
}

// Best-effort: an overlap check must never fail or slow a Lor turn.
export function reportChangedFiles(update: ChangedFilesUpdate) {
  if (!tracker) return
  void detectOverlaps(update).catch((err) =>
    logger.warn({ err, sessionId: update.sessionId }, "Overlap check failed")
  )
}

type SessionInfo = Awaited<ReturnType<typeof loadSessions>>[number]

function loadSessions(ids: string[]) {
  return db
    .select({
      id: schema.agentSession.id,
      workspaceId: schema.agentSession.workspaceId,
      channelId: schema.agentSession.channelId,
      title: schema.agentSession.title,
      repoFullName: schema.agentSession.repoFullName,
      creatorId: schema.agentSession.creatorId,
      archivedAt: schema.agentSession.archivedAt,
      ownerName: schema.user.name,
    })
    .from(schema.agentSession)
    .leftJoin(schema.user, eq(schema.user.id, schema.agentSession.creatorId))
    .where(inArray(schema.agentSession.id, ids))
}

async function detectOverlaps({ sessionId, files }: ChangedFilesUpdate) {
  if (!tracker) return
  const [me] = await loadSessions([sessionId])
  if (!me?.repoFullName || !me.creatorId) return
  const scope = `${me.workspaceId}:${me.repoFullName}`
  const overlaps = await tracker.report({
    sessionId,
    ownerId: me.creatorId,
    scope,
    // A rename's old path counts: moving a file away overlaps with a
    // teammate editing it.
    files: files.flatMap((file) =>
      file.oldPath ? [file.path, file.oldPath] : [file.path]
    ),
  })
  if (overlaps.length === 0) return

  const others = new Map(
    (await loadSessions(overlaps.map((o) => o.theirs.sessionId))).map((s) => [
      s.id,
      s,
    ])
  )
  for (const overlap of overlaps) {
    const them = others.get(overlap.theirs.sessionId)
    if (!them?.creatorId || them.archivedAt) {
      await tracker.clear(scope, overlap.theirs.sessionId)
      continue
    }
    await alert(me, them, overlap.paths)
    await alert(them, me, overlap.paths)
  }
}

// Tells `to`'s owner about `other`, hiding a session in a channel they can't
// see.
async function alert(to: SessionInfo, other: SessionInfo, paths: string[]) {
  if (!to.creatorId || !to.repoFullName) return
  const audience = await listChannelAudienceUserIds(other.channelId)
  const canSee = audience.includes(to.creatorId)
  const payload: SessionOverlap = {
    workspaceId: to.workspaceId,
    repoFullName: to.repoFullName,
    paths,
    mine: { sessionId: to.id, title: to.title },
    theirs: {
      sessionId: canSee ? other.id : null,
      title: canSee ? other.title : null,
      ownerName: other.ownerName ?? "A teammate",
    },
  }
  try {
    emitter?.to(userRoom(to.creatorId)).emit("session:overlap", payload)
  } catch {
    // swallow: delivery is best-effort by design
  }
}
