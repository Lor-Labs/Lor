import { db, eq, schema } from "@repo/db"
import { describeLoopSchedule } from "@repo/merlin/loop-schedule"
import { toRealtimeLoop } from "@repo/merlin/loops"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import { channelRoom } from "@repo/realtime-types/rooms"
import type { Emitter } from "@socket.io/redis-emitter"
import type { createClient } from "redis"
import { logger } from "@/lib/logger"
import { postMerlinMessage } from "@/lib/merlin-messages"

type RedisClient = ReturnType<typeof createClient>

export type MerlinLoopDeps = {
  emitter: Emitter<ServerToClientEvents>
  redis: RedisClient
}

// The propose_loop executor: loop_card message + draft loop row, the same
// card-is-anchor shape as createMerlinTask. Nothing is scheduled here — the
// loop stays a draft until a human activates it (L2 activate route). The
// card content is a plain-text fallback (mobile, search, clients without the
// loop row); rich rendering reads the row via cardMessageId.
export async function createLoopCard(
  deps: MerlinLoopDeps,
  input: {
    workspaceId: string
    channelId: string
    creatorId: string | null
    name: string
    instructions: string
    schedule: string
    timezone: string | null
    endCondition: string | null
  }
): Promise<{ loopId: string }> {
  const { messageId: cardId } = await postMerlinMessage(
    { emitter: deps.emitter, redis: deps.redis },
    {
      channelId: input.channelId,
      content: `${input.name} — ${describeLoopSchedule(input.schedule, input.timezone)}`,
      type: "loop_card",
    }
  )
  const loop = await db
    .insert(schema.loop)
    .values({
      workspaceId: input.workspaceId,
      channelId: input.channelId,
      cardMessageId: cardId,
      creatorId: input.creatorId,
      name: input.name,
      instructions: input.instructions,
      schedule: input.schedule,
      timezone: input.timezone,
      endCondition: input.endCondition,
      status: "draft",
    })
    .returning()
    .then((rows) => rows[0] ?? null)
  if (!loop) {
    // Compensation: an orphan loop_card renders a benign fallback, but don't
    // leave one around when we know the insert failed.
    await db
      .delete(schema.message)
      .where(eq(schema.message.id, cardId))
      .catch(() => {})
    throw new Error("Loop insert returned no row")
  }

  try {
    deps.emitter
      .to(channelRoom(input.channelId))
      .emit("loop:updated", { loop: toRealtimeLoop(loop) })
  } catch (err) {
    logger.error({ err, loopId: loop.id }, "Loop card emit failed")
  }
  return { loopId: loop.id }
}
