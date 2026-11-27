import { recordUsage } from "@repo/billing"
import { and, asc, db, desc, eq, isNull, ne, or, schema, sql } from "@repo/db"
import { ownConversation } from "@repo/db/queries/agent-conversations"
import type { AgentMessagedPayload } from "@repo/db/schema"
import {
  addInboxNote,
  agentMessageInboxNote,
  type MessageAgentExecutor,
} from "@repo/lor/channel-agent"
import { decideInboxAddress } from "@repo/lor/inbox-address"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import {
  AGENT_INBOX_BATCH_MS,
  AGENT_INBOX_FLUSH_JOB,
  type AgentInboxFlushJobData,
} from "@repo/realtime-types/queues"
import { channelRoom } from "@repo/realtime-types/rooms"
import type { Emitter } from "@socket.io/redis-emitter"
import type { Queue } from "bullmq"
import { loadAddressContext } from "@/lib/agent-inbox-classify"
import { logger } from "@/lib/logger"
import { type LorMessageDeps, postLorMessage } from "@/lib/lor-messages"

// The agents' room of a chat (reference/agents-and-chats.md, decisions 39
// and 44): `message_agent` posts in it, and it works as a chat does. A post
// that names agents wakes them. One that names nobody wakes the agent Jev
// reads it as meant for. One for `agents` wakes them all. Whoever is not
// woken reads it at their check-in. What is said is saved in
// `agent_message`, and the chat's feed gets one quiet line for it. There are
// no caps and no rules about who may message whom: prompting, and what
// bounds any turn (spend, a person stopping it). Nothing here is posted to a
// chat that lives in Slack or Discord.

const LIST = new Intl.ListFormat("en", { type: "conjunction" })
// What an agent writes in `to` to mean every agent in the chat: `agents`,
// shown as @agents. Not @everyone or @here, which in a chat mean the whole
// workspace and whoever is online. `all` and `everyone` are read as it.
const ALL_AGENTS = new Set(["agents", "all", "everyone"])

type Deps = LorMessageDeps & {
  emitter: Emitter<ServerToClientEvents>
  // Typed loosely: the agent queue carries other jobs too.
  queue: Pick<Queue<AgentInboxFlushJobData>, "add">
}

// The feed line's words: who wrote, and to whom.
function lineText(
  line: Pick<
    AgentMessagedPayload,
    "agentIds" | "senderIds" | "room" | "everyone"
  >,
  names: Map<string, string>
) {
  const named = (ids: string[]) =>
    LIST.format(ids.map((id) => names.get(id) ?? "an agent"))
  const senderIds = line.senderIds ?? []
  const agentIds = line.agentIds ?? []
  if (senderIds.length > 1) return `${named(agentIds)} talked`
  if (line.room) {
    return `${named(senderIds)} messaged ${line.everyone ? "all agents in the room" : "the room"}`
  }
  return `${named(senderIds)} messaged ${named(agentIds.filter((id) => !senderIds.includes(id)))}`
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
  return async ({ to, replyTo, content }) => {
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
    if (!me || others.length === 0) {
      return { ok: false, error: "No other agent is in this chat." }
    }
    if (me.archivedAt) {
      return { ok: false, error: "This chat is archived." }
    }

    const wanted = (to ?? [])
      .map((name) => name.trim().replace(/^@/, ""))
      .filter(Boolean)
    const everyone = wanted.some((name) => ALL_AGENTS.has(name.toLowerCase()))
    const named: typeof others = []
    const unknown: string[] = []
    for (const name of everyone ? [] : wanted) {
      const hit = others.find(
        (row) =>
          row.id === name || row.name.toLowerCase() === name.toLowerCase()
      )
      if (!hit) unknown.push(name)
      else if (!named.includes(hit)) named.push(hit)
    }
    if (unknown.length > 0) {
      return {
        ok: false,
        error: `No agent named ${unknown.join(", ")} is in this chat with you. The agents here: ${others.map((row) => row.name).join(", ")}. Leave \`to\` out to ask whichever of them it fits.`,
      }
    }

    // A reply is what the agent says it is (`replyTo`), never a guess. Its
    // writer is woken with it, in the conversation it asked from, where it
    // has the context.
    let replied: {
      id: string
      fromAgentId: string
      conversationId: string | null
    } | null = null
    if (replyTo) {
      const [post] = await db
        .select({
          id: schema.agentMessage.id,
          fromAgentId: schema.agentMessage.fromAgentId,
          conversationId: schema.agentMessage.fromConversationId,
        })
        .from(schema.agentMessage)
        .where(
          and(
            eq(schema.agentMessage.id, replyTo),
            eq(schema.agentMessage.channelId, from.channelId)
          )
        )
      if (!post) {
        return {
          ok: false,
          error:
            "No post with that id is in this chat's agents' room. Use the id given with the post you are answering, or leave `replyTo` out.",
        }
      }
      if (post.fromAgentId === from.agentId) {
        return {
          ok: false,
          error:
            "That post is your own. Leave `replyTo` out, or use the id of the post you are answering.",
        }
      }
      replied = post
      const writer = others.find((row) => row.id === post.fromAgentId)
      if (writer && !everyone && !named.includes(writer)) named.push(writer)
    }
    const open = !everyone && named.length === 0

    // Where a post lands for an agent it names. A reply goes to the
    // conversation its post was written from. One the agent did not mark as
    // a reply may still be an answer (the named agent's newest post that
    // reached this writer is newer than this writer's last message to it):
    // it then lands where that agent asked from too, so a request is not
    // left unanswered. Only where it lands: it is not shown as a reply.
    const asked = async (agentId: string) => {
      const [theirs] = await db
        .select({
          conversationId: schema.agentMessage.fromConversationId,
          createdAt: schema.agentMessage.createdAt,
        })
        .from(schema.agentMessage)
        .where(
          and(
            eq(schema.agentMessage.channelId, from.channelId),
            eq(schema.agentMessage.fromAgentId, agentId),
            or(
              sql`${from.agentId}::uuid = any(${schema.agentMessage.toAgentIds})`,
              eq(schema.agentMessage.toEveryone, true),
              sql`cardinality(${schema.agentMessage.toAgentIds}) = 0`
            )
          )
        )
        .orderBy(desc(schema.agentMessage.createdAt))
        .limit(1)
      if (!theirs?.conversationId) return null
      const [mine] = await db
        .select({ createdAt: schema.agentMessage.createdAt })
        .from(schema.agentMessage)
        .where(
          and(
            eq(schema.agentMessage.channelId, from.channelId),
            eq(schema.agentMessage.fromAgentId, from.agentId),
            sql`${agentId}::uuid = any(${schema.agentMessage.toAgentIds})`
          )
        )
        .orderBy(desc(schema.agentMessage.createdAt))
        .limit(1)
      return !mine || theirs.createdAt > mine.createdAt
        ? theirs.conversationId
        : null
    }
    const lands = new Map<string, string>()
    if (replied?.conversationId) {
      lands.set(replied.fromAgentId, replied.conversationId)
    } else if (!replied) {
      for (const row of everyone ? [] : named) {
        const conversationId = await asked(row.id)
        if (conversationId) lands.set(row.id, conversationId)
      }
    }
    const replyToId = replied?.id ?? null

    const [saved] = await db
      .insert(schema.agentMessage)
      .values({
        workspaceId: from.workspaceId,
        channelId: from.channelId,
        fromAgentId: from.agentId,
        toAgentIds: named.map((row) => row.id),
        toEveryone: everyone,
        replyToId,
        fromConversationId: from.conversationId,
        content,
      })
      .returning({
        id: schema.agentMessage.id,
        createdAt: schema.agentMessage.createdAt,
      })
    if (!saved) return { ok: false, error: "The message could not be saved." }

    // Who is woken now. With nobody named, Jev judges it as it does a
    // person's message that names no agent (LOR-171); when it fails or picks
    // nobody, the post waits for each agent's check-in.
    let wake = everyone ? others : named
    if (open) {
      const context = await loadAddressContext({
        channelId: from.channelId,
        before: saved.createdAt,
        exceptAgentId: from.agentId,
      })
      const decision = await decideInboxAddress({
        chatName: from.channelName ?? "chat",
        recent: context.recent,
        message: { author: me.name, isAgent: true, text: content },
        agents: context.agents,
      })
      if (decision.responded) {
        void recordUsage(
          {
            workspaceId: from.workspaceId,
            tool: "lor.inbox.classify",
            model: decision.model,
            inputTokens: decision.inputTokens,
            outputTokens: decision.outputTokens,
            costUsd: decision.costUsd,
            wallMs: decision.wallMs,
          },
          { channelId: from.channelId }
        )
      }
      wake = others.filter((row) => decision.agentIds.includes(row.id))
      logger.info(
        { agentMessageId: saved.id, scores: decision.scores },
        "Agents' room post classified"
      )
    }

    // Each recipient on its own: the post is saved, so a failed delivery
    // must not fail the call (a retry would save it twice and notify the
    // others again). Notes are deduped by post id, so one retry is safe.
    const deliver = async (row: (typeof others)[number]) => {
      const woken = wake.includes(row)
      const isNamed = named.includes(row)
      // A woken agent gets the post where it asked from: named, or the
      // writer of the post this answers, even when it went to everyone.
      const conversationId =
        (woken ? lands.get(row.id) : null) ??
        (
          await ownConversation({
            workspaceId: from.workspaceId,
            agentId: row.id,
          })
        ).id
      const delivered = await addInboxNote({
        workspaceId: from.workspaceId,
        channelId: from.channelId,
        conversationId,
        source: "agent",
        sourceId: saved.id,
        lane: woken ? "wake" : "wait",
        note: agentMessageInboxNote({
          fromName: me.name,
          fromRole: me.role,
          channelName: from.channelName,
          content,
          kind: everyone
            ? "everyone"
            : isNamed
              ? "named"
              : open
                ? "open"
                : "overheard",
          toNames: named.map((item) => item.name),
          postId: saved.id,
        }),
      })
      if (delivered && woken) {
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
    }
    const undelivered: string[] = []
    for (const row of others) {
      const ok = await deliver(row)
        .catch(() => deliver(row))
        .then(
          () => true,
          (err: unknown) => {
            logger.error(
              { err, agentMessageId: saved.id, agentId: row.id },
              "Agents' room delivery failed"
            )
            return false
          }
        )
      if (!ok) undelivered.push(row.name)
    }

    deps.emitter.to(channelRoom(from.channelId)).emit("agent-message:created", {
      channelId: from.channelId,
      message: {
        id: saved.id,
        fromAgentId: from.agentId,
        toAgentIds: named.map((row) => row.id),
        toEveryone: everyone,
        replyToId,
        content,
        createdAt: saved.createdAt.toISOString(),
      },
    })

    // One line in the feed for a run of posts in the room, until something
    // else is said in the chat: a post that follows one updates the line
    // ("Quill messaged Inky and Rusty"). Under a lock, so posts sent at once
    // share a line.
    const names = new Map(here.map((row) => [row.id, row.name]))
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
          const payload: AgentMessagedPayload = {
            fromAgentId: from.agentId,
            ...(named[0] ? { toAgentId: named[0].id } : {}),
            agentMessageId: saved.id,
            agentIds: [from.agentId, ...named.map((row) => row.id)],
            senderIds: [from.agentId],
            ...(named.length === 0
              ? {
                  room: true,
                  roomIds: others.map((row) => row.id),
                  ...(everyone ? { everyone: true } : {}),
                }
              : {}),
          }
          await postLorMessage(
            deps,
            {
              channelId: from.channelId,
              content: lineText(payload, names),
              type: "event",
              eventType: "agent_messaged",
              eventPayload: payload,
              agentId: from.agentId,
              // A quiet line: no unread mark and no notification.
              silent: true,
            },
            // Inside the lock's transaction, on its own connection.
            tx
          )
          return
        }
        const before = {
          agentIds: line.agentIds ?? [
            line.fromAgentId,
            ...(line.toAgentId ? [line.toAgentId] : []),
          ],
          senderIds: line.senderIds ?? [line.fromAgentId],
          room: line.room ?? false,
          everyone: line.everyone ?? false,
        }
        // An answer to the agent that started the run does not make its
        // writer a sender: "Quill messaged Inky and Rusty" stays true until
        // one of the others writes to someone else.
        const answer =
          !everyone && named.length === 1 && named[0]?.id === line.fromAgentId
        const after = {
          agentIds: [
            ...new Set([
              ...before.agentIds,
              from.agentId,
              ...named.map((row) => row.id),
            ]),
          ],
          senderIds: [
            ...new Set([
              ...before.senderIds,
              ...(answer ? [] : [from.agentId]),
            ]),
          ],
          room: before.room || named.length === 0,
          everyone: before.everyone || everyone,
        }
        if (
          after.agentIds.length === before.agentIds.length &&
          after.senderIds.length === before.senderIds.length &&
          after.room === before.room &&
          after.everyone === before.everyone
        ) {
          return
        }
        const payload: AgentMessagedPayload = {
          ...line,
          agentIds: after.agentIds,
          senderIds: after.senderIds,
          ...(after.room
            ? {
                room: true,
                roomIds: line.roomIds ?? others.map((row) => row.id),
              }
            : {}),
          ...(after.everyone ? { everyone: true } : {}),
        }
        const text = lineText(payload, names)
        await tx
          .update(schema.message)
          .set({ eventPayload: payload, content: text })
          .where(eq(schema.message.id, newest.id))
        deps.emitter.to(channelRoom(from.channelId)).emit("message:updated", {
          channelId: from.channelId,
          messageId: newest.id,
          content: text,
          editedAt: new Date().toISOString(),
          mentions: [],
          eventPayload: payload,
        })
      })
      .catch((err) =>
        logger.warn({ err, agentMessageId: saved.id }, "Messaged line failed")
      )

    const notes = [
      ...(wake.length === 0
        ? [
            "No agent was woken for it now. They will each see it at their next check-in. Name an agent in `to` if it can't wait.",
          ]
        : []),
      ...(undelivered.length > 0
        ? [
            `It is posted in the room, but it could not reach ${undelivered.join(", ")}. Do not send it again; they can read it in the room.`,
          ]
        : []),
    ]
    return {
      ok: true,
      woke: wake
        .filter((row) => !undelivered.includes(row.name))
        .map((row) => row.name),
      ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
    }
  }
}
