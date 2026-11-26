import { db, eq, schema } from "@repo/db"
import { loopAgentFor } from "@repo/db/queries/agents"
import { describeLoopSchedule } from "@repo/lor/loop-schedule"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import type { Emitter } from "@socket.io/redis-emitter"
import type { createClient } from "redis"
import { emitLoopUpdated } from "@/lib/loop-session"
import { postLorMessage } from "@/lib/lor-messages"

type RedisClient = ReturnType<typeof createClient>

export type LorLoopDeps = {
  emitter: Emitter<ServerToClientEvents>
  redis: RedisClient
}

// A loop_card message + its loop row, with the card as the loop's anchor.
// A session's propose_loop makes a draft: nothing is scheduled until a
// person activates it (L2 activate route). An agent's create_loop passes
// `active`: its own Loop runs at once, with no approval
// (reference/agents-and-chats.md §9), and the card is the trace people
// see. The card content is a plain-text fallback (mobile, search, clients
// without the loop row); rich rendering reads the row via cardMessageId.
export async function createLoopCard(
  deps: LorLoopDeps,
  input: {
    workspaceId: string
    // Where the card is posted.
    channelId: string
    // The chat the Loop reports in, when that is not where the card is:
    // another chat, or null for none. Left out: the card's chat.
    reportsIn?: string | null
    // Set by an agent's create_loop: the Loop starts active, next due then.
    active?: { nextRunAt: Date }
    // The agent that proposed it, which it then belongs to. Left out (a
    // session proposed it): the chat's first agent.
    agentId?: string | null
    // The session Lor proposed it in; the draft card posts there.
    threadRootId: string | null
    creatorId: string | null
    name: string
    instructions: string
    schedule: string
    timezone: string | null
    endCondition: string | null
    endAt: Date | null
  }
): Promise<{ loopId: string }> {
  const { messageId: cardId } = await postLorMessage(
    { emitter: deps.emitter, redis: deps.redis },
    {
      channelId: input.channelId,
      content: `${input.name} — ${describeLoopSchedule(input.schedule, input.timezone)}`,
      type: "loop_card",
      ...(input.threadRootId ? { threadRootId: input.threadRootId } : {}),
      // The agent's own card: in a chat with several agents it is shown
      // under the one that proposed it, not the chat's first.
      ...(input.agentId ? { agentId: input.agentId } : {}),
    }
  )
  // Compensation: an orphan loop_card renders a benign fallback, but don't
  // leave one around when we know the insert failed (thrown or no row).
  const loop = await loopAgentFor(input.channelId, input.agentId)
    .then((agentId) =>
      db
        .insert(schema.loop)
        .values({
          workspaceId: input.workspaceId,
          channelId:
            input.reportsIn === undefined ? input.channelId : input.reportsIn,
          agentId,
          cardMessageId: cardId,
          creatorId: input.creatorId,
          name: input.name,
          instructions: input.instructions,
          schedule: input.schedule,
          timezone: input.timezone,
          endCondition: input.endCondition,
          endAt: input.endAt,
          ...(input.active
            ? {
                status: "active" as const,
                nextRunAt: input.active.nextRunAt,
                // The agent made it: shown on the Loop as who changed it.
                changedById: agentId,
                changedAt: new Date(),
              }
            : { status: "draft" as const }),
        })
        .returning()
    )
    .then((rows) => rows[0] ?? null)
    .catch(async (err) => {
      await db
        .delete(schema.message)
        .where(eq(schema.message.id, cardId))
        .catch(() => {})
      throw err
    })
  if (!loop) {
    await db
      .delete(schema.message)
      .where(eq(schema.message.id, cardId))
      .catch(() => {})
    throw new Error("Loop insert returned no row")
  }

  emitLoopUpdated(deps.emitter, loop)
  return { loopId: loop.id }
}
