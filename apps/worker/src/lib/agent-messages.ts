import { and, asc, db, desc, eq, isNull, ne, schema, sql } from "@repo/db"
import { ownConversation } from "@repo/db/queries/agent-conversations"
import type { AgentMessagedPayload } from "@repo/db/schema"
import {
  addInboxNote,
  agentMessageInboxNote,
  type MessageAgentExecutor,
} from "@repo/lor/channel-agent"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import {
  AGENT_INBOX_BATCH_MS,
  AGENT_INBOX_FLUSH_JOB,
  type AgentInboxFlushJobData,
} from "@repo/realtime-types/queues"
import { channelRoom } from "@repo/realtime-types/rooms"
import type { Emitter } from "@socket.io/redis-emitter"
import type { Queue } from "bullmq"
import { logger } from "@/lib/logger"
import { type LorMessageDeps, postLorMessage } from "@/lib/lor-messages"

// Agents messaging each other (reference/agents-and-chats.md, decision 39).
// `message_agent` saves what was said in `agent_message`, wakes the other
// agent with it, and leaves one quiet "messaged" line in the chat's feed.
// There are no caps and no rules about who may message whom: prompting, and
// what bounds any turn (spend, a person stopping it). Nothing here is posted
// to a chat that lives in Slack or Discord.

const LIST = new Intl.ListFormat("en", { type: "conjunction" })

type Deps = LorMessageDeps & {
  emitter: Emitter<ServerToClientEvents>
  // Typed loosely: the agent queue carries other jobs too.
  queue: Pick<Queue<AgentInboxFlushJobData>, "add">
}

export function agentMessenger(
  deps: Deps,
  from: {
    workspaceId: string
    channelId: string
    channelName: string | null
    agentId: string
    conversationId: string
  }
): MessageAgentExecutor {
  return async ({ agent, content }) => {
    const here = await db
      .select({
        id: schema.agent.id,
        name: schema.agent.name,
        role: schema.agent.role,
        archivedAt: schema.channel.archivedAt,
      })
      .from(schema.channelAgent)
      .innerJoin(schema.agent, eq(schema.agent.id, schema.channelAgent.agentId))
      .innerJoin(
        schema.channel,
        eq(schema.channel.id, schema.channelAgent.channelId)
      )
      .where(eq(schema.channelAgent.channelId, from.channelId))
      .orderBy(asc(schema.channelAgent.createdAt))
    const me = here.find((row) => row.id === from.agentId)
    const others = here.filter((row) => row.id !== from.agentId)
    const wanted = agent.trim().replace(/^@/, "").toLowerCase()
    const to = others.find(
      (row) => row.id === agent.trim() || row.name.toLowerCase() === wanted
    )
    if (!me || !to) {
      return {
        ok: false,
        error:
          others.length > 0
            ? `No agent by that name is in this chat with you. You can message ${others.map((row) => row.name).join(", ")}.`
            : "No other agent is in this chat.",
      }
    }
    if (me.archivedAt) {
      return { ok: false, error: "This chat is archived." }
    }

    const [saved] = await db
      .insert(schema.agentMessage)
      .values({
        workspaceId: from.workspaceId,
        channelId: from.channelId,
        fromAgentId: from.agentId,
        toAgentId: to.id,
        fromConversationId: from.conversationId,
        content,
      })
      .returning({
        id: schema.agentMessage.id,
        createdAt: schema.agentMessage.createdAt,
      })
    if (!saved) return { ok: false, error: "The message could not be saved." }

    // An answer goes back to the conversation the other agent last wrote
    // from here, where it has the context; a first message goes to its own.
    const [asked] = await db
      .select({ conversationId: schema.agentMessage.fromConversationId })
      .from(schema.agentMessage)
      .where(
        and(
          eq(schema.agentMessage.channelId, from.channelId),
          eq(schema.agentMessage.fromAgentId, to.id),
          eq(schema.agentMessage.toAgentId, from.agentId)
        )
      )
      .orderBy(desc(schema.agentMessage.createdAt))
      .limit(1)
    const conversationId =
      asked?.conversationId ??
      (
        await ownConversation({
          workspaceId: from.workspaceId,
          agentId: to.id,
        })
      ).id
    const delivered = await addInboxNote({
      workspaceId: from.workspaceId,
      channelId: from.channelId,
      conversationId,
      source: "agent",
      sourceId: saved.id,
      lane: "wake",
      note: agentMessageInboxNote({
        fromName: me.name,
        fromRole: me.role,
        channelName: from.channelName,
        content,
      }),
    })
    if (delivered) {
      await deps.queue
        .add(
          AGENT_INBOX_FLUSH_JOB,
          { conversationId: delivered },
          {
            delay: AGENT_INBOX_BATCH_MS,
            removeOnComplete: true,
            removeOnFail: 100,
          }
        )
        // The stranded-inbox sweep flushes one whose enqueue failed.
        .catch((err) =>
          logger.warn({ err, agentMessageId: saved.id }, "Agent wake failed")
        )
    }

    deps.emitter.to(channelRoom(from.channelId)).emit("agent-message:created", {
      channelId: from.channelId,
      message: {
        id: saved.id,
        fromAgentId: from.agentId,
        toAgentId: to.id,
        content,
        createdAt: saved.createdAt.toISOString(),
      },
    })

    // One line in the feed for a run of messages between the chat's
    // agents, until something else is said there: a message that follows
    // one updates the line ("Quill messaged Inky and Rusty"). Under a lock,
    // so messages sent at once share a line.
    await db
      .transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`agent-line:${from.channelId}`}, 0))`
        )
        const [newest] = await tx
          .select({
            id: schema.message.id,
            eventType: schema.message.eventType,
            eventPayload: schema.message.eventPayload,
          })
          .from(schema.message)
          .where(
            and(
              eq(schema.message.channelId, from.channelId),
              isNull(schema.message.threadRootId),
              ne(schema.message.type, "loop_fire")
            )
          )
          .orderBy(desc(schema.message.createdAt))
          .limit(1)
        const line =
          newest?.eventType === "agent_messaged"
            ? (newest.eventPayload as AgentMessagedPayload | null)
            : null
        if (!newest || !line) {
          await postLorMessage(deps, {
            channelId: from.channelId,
            content: `${me.name} messaged ${to.name}`,
            type: "event",
            eventType: "agent_messaged",
            eventPayload: {
              fromAgentId: from.agentId,
              toAgentId: to.id,
              agentMessageId: saved.id,
              agentIds: [from.agentId, to.id],
              senderIds: [from.agentId],
            },
            agentId: from.agentId,
            // A quiet line: no unread mark and no notification.
            silent: true,
          })
          return
        }
        const agentIds = [
          ...new Set([
            ...(line.agentIds ?? [line.fromAgentId, line.toAgentId]),
            from.agentId,
            to.id,
          ]),
        ]
        // An answer to the agent that started the run does not make its
        // writer a sender: "Quill messaged Inky and Rusty" stays true until
        // two of the others message each other.
        const senderIds = [
          ...new Set([
            ...(line.senderIds ?? [line.fromAgentId]),
            ...(to.id === line.fromAgentId ? [] : [from.agentId]),
          ]),
        ]
        if (
          agentIds.length === (line.agentIds?.length ?? 2) &&
          senderIds.length === (line.senderIds?.length ?? 1)
        ) {
          return
        }
        const payload: AgentMessagedPayload = { ...line, agentIds, senderIds }
        const names = new Map(here.map((row) => [row.id, row.name]))
        const named = (ids: string[]) =>
          LIST.format(ids.map((id) => names.get(id) ?? "an agent"))
        const content =
          senderIds.length === 1
            ? `${named(senderIds)} messaged ${named(agentIds.filter((id) => !senderIds.includes(id)))}`
            : `${named(agentIds)} talked`
        await tx
          .update(schema.message)
          .set({ eventPayload: payload, content })
          .where(eq(schema.message.id, newest.id))
        deps.emitter.to(channelRoom(from.channelId)).emit("message:updated", {
          channelId: from.channelId,
          messageId: newest.id,
          content,
          editedAt: new Date().toISOString(),
          mentions: [],
          eventPayload: payload,
        })
      })
      .catch((err) =>
        logger.warn({ err, agentMessageId: saved.id }, "Messaged line failed")
      )
    return { ok: true }
  }
}
