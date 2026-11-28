import { and, db, eq, gt, inArray, schema, sql } from "@repo/db"
import { agentIdsByChannel } from "@repo/db/queries/agents"
import { clearAgentChannelInbox } from "@repo/lor/channel-agent"
import { AGENT_RUN_STOP_CHANNEL } from "@repo/realtime-types/queues"
import { channelRoom } from "@repo/realtime-types/rooms"
import { publishRealtime } from "@/lib/bot-messages"
import { logger } from "@/lib/logger"
import {
  pauseLoopsForArchivedChat,
  resumeLoopsForUnarchivedChat,
} from "@/lib/loops"
import { getRedisClient } from "@/lib/redis"

const followUpsChanged = (channelId: string) =>
  publishRealtime((io) =>
    io.to(channelRoom(channelId)).emit("agent:wake-ups:updated", { channelId })
  ).catch(() => {})

// An archived chat's agents stop there (reference/agents-and-chats.md,
// decision 52): what waited for them from it is dropped, turns about it are
// stopped, its Loops pause and its wake-ups are cancelled, stamped with the
// archive time so unarchiving can bring them back. Its listeners stay set up
// and are skipped while it is archived (connector-triggers.ts). A turn that
// starts later is skipped anyway (an archived chat takes no turns).
export async function stopChatAgents(
  channelId: string,
  archivedAt: Date
): Promise<void> {
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

  await pauseLoopsForArchivedChat(channelId)
  await db
    .update(schema.agentWakeUp)
    .set({ status: "cancelled", cancelledAt: archivedAt })
    .where(
      and(
        eq(schema.agentWakeUp.channelId, channelId),
        eq(schema.agentWakeUp.status, "pending")
      )
    )
  await followUpsChanged(channelId)
}

// Unarchiving: the Loops archiving paused resume, and the wake-ups it
// cancelled that are not yet due are pending again. What waited in the
// agents' inboxes and stopped turns do not come back.
export async function restartChatAgents(
  channelId: string,
  archivedAt: Date
): Promise<void> {
  await resumeLoopsForUnarchivedChat(channelId)
  const restored = await db
    .update(schema.agentWakeUp)
    .set({ status: "pending", cancelledAt: null })
    .where(
      and(
        eq(schema.agentWakeUp.channelId, channelId),
        eq(schema.agentWakeUp.status, "cancelled"),
        eq(schema.agentWakeUp.cancelledAt, archivedAt),
        gt(schema.agentWakeUp.dueAt, new Date())
      )
    )
    .returning({ id: schema.agentWakeUp.id })
  if (restored.length > 0) await followUpsChanged(channelId)
}
