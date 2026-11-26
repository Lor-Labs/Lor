import { and, db, eq, inArray, schema, sql } from "@repo/db"
import { agentIdsByChannel } from "@repo/db/queries/agents"
import { clearAgentChannelInbox } from "@repo/lor/channel-agent"
import { AGENT_RUN_STOP_CHANNEL } from "@repo/realtime-types/queues"
import { channelRoom } from "@repo/realtime-types/rooms"
import { publishRealtime } from "@/lib/bot-messages"
import { logger } from "@/lib/logger"
import { completeLoopsForChannels } from "@/lib/loops"
import { getRedisClient } from "@/lib/redis"

// An archived chat's agents stop there (reference/agents-and-chats.md,
// decision 52): what waited for them from it is dropped, turns about it are
// stopped, its Loops end, its wake-ups are cancelled and the events that
// reported in it are switched off. A turn that starts later is skipped
// anyway (an archived chat takes no turns), so a step that fails here only
// leaves work that will not run.
export async function stopChatAgents(channelId: string): Promise<void> {
  const agentIds = (await agentIdsByChannel([channelId])).get(channelId) ?? []
  await Promise.all(
    agentIds.map((agentId) => clearAgentChannelInbox(agentId, channelId))
  )

  const running = await db
    .update(schema.agentRun)
    .set({
      stopRequestedAt: sql`coalesce(${schema.agentRun.stopRequestedAt}, now())`,
    })
    .where(
      and(
        eq(schema.agentRun.channelId, channelId),
        inArray(schema.agentRun.state, ["queued", "working", "finalizing"])
      )
    )
    .returning({ id: schema.agentRun.id })
  for (const run of running) {
    await getRedisClient()
      .then((redis) => redis.publish(AGENT_RUN_STOP_CHANNEL, run.id))
      .catch((err) => logger.warn({ err, runId: run.id }, "Run stop failed"))
  }

  await completeLoopsForChannels([channelId], "Its chat was archived")
  await db
    .update(schema.agentWakeUp)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(
      and(
        eq(schema.agentWakeUp.channelId, channelId),
        eq(schema.agentWakeUp.status, "pending")
      )
    )
  // The chat's Follow-ups list drops them.
  await publishRealtime((io) =>
    io.to(channelRoom(channelId)).emit("agent:wake-ups:updated", { channelId })
  ).catch(() => {})
  await db
    .update(schema.connectorTrigger)
    .set({ enabled: false })
    .where(eq(schema.connectorTrigger.channelId, channelId))
}
