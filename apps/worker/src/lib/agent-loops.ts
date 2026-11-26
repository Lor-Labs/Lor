import { and, asc, db, eq, isNull, schema } from "@repo/db"
import { recordConversationPost } from "@repo/db/queries/agent-conversations"
import { isAgentInChannel } from "@repo/db/queries/agents"
import type { Loop } from "@repo/db/schema"
import type { AgentLoopExecutors } from "@repo/lor/channel-agent"
import { nextLoopRunAt, validateLoopSchedule } from "@repo/lor/loop-schedule"
import { channelEventContent } from "@repo/messaging"
import type { LoopChange } from "@repo/realtime-types/loops"
import { logger } from "@/lib/logger"
import { emitLoopUpdated } from "@/lib/loop-session"
import { createLoopCard, type LorLoopDeps } from "@/lib/lor-loop"
import { postLorMessage } from "@/lib/lor-messages"

// An agent's own Loops (reference/agents-and-chats.md §9, Jacob
// 2026-11-26): a Loop is a scheduled wake, and the agent makes and changes
// its own with no approval unless the workspace gates the tools, whether a
// person asked or it sees the work needs one. What it did is shown: a card
// in the chat the turn is about (or the Loop's chat), a line in the Loop's
// chat, and who changed the Loop last on the Loop itself.

type Chat = { id: string; name: string | null }

// The chats the agent is in: a Loop can only report in one of them.
async function agentChats(agentId: string): Promise<Chat[]> {
  return db
    .select({ id: schema.channel.id, name: schema.channel.name })
    .from(schema.channelAgent)
    .innerJoin(
      schema.channel,
      eq(schema.channel.id, schema.channelAgent.channelId)
    )
    .where(
      and(
        eq(schema.channelAgent.agentId, agentId),
        isNull(schema.channel.archivedAt)
      )
    )
    .orderBy(asc(schema.channelAgent.createdAt))
}

function findChat(chats: Chat[], ref: string): Chat | string {
  const wanted = ref.trim().replace(/^#/, "").toLowerCase()
  const hit = chats.find(
    (chat) => chat.id === wanted || chat.name?.toLowerCase() === wanted
  )
  return (
    hit ??
    `You are in no chat named ${ref}. Your chats: ${chats.map((chat) => chat.name ?? chat.id).join(", ") || "none"}. Pass null for no chat.`
  )
}

// The quiet line that says what the agent did to a Loop.
async function postLoopLine(
  deps: LorLoopDeps,
  input: {
    channelId: string
    agentId: string
    agentName: string
    loop: Pick<Loop, "id" | "name">
    event:
      | { eventType: "loop_created" }
      | { eventType: "loop_updated"; changes: LoopChange[] }
  }
) {
  const { loop, event } = input
  await postLorMessage(deps, {
    channelId: input.channelId,
    agentId: input.agentId,
    content: channelEventContent({
      ...event,
      actorName: input.agentName,
      loopName: loop.name,
    }),
    type: "event",
    eventType: event.eventType,
    eventPayload: {
      loopId: loop.id,
      loopName: loop.name,
      ...(event.eventType === "loop_updated" ? { changes: event.changes } : {}),
    },
    silent: true,
  }).catch((err) =>
    logger.error({ err, loopId: loop.id }, "Agent loop line failed")
  )
}

export function agentLoopExecutors(
  deps: LorLoopDeps,
  turn: {
    workspaceId: string
    agentId: string
    agentName: string
    // The chat the turn is about: where a new Loop's card is posted. Null
    // for a turn about no chat, which posts no card.
    channelId: string | null
    // The person who asked in this turn, when one did.
    askerId: string | null
    // The person behind a turn nobody asked in (who set up the Loop or the
    // event that woke it): a Loop made there is on their account.
    setUpById: string | null
    conversationId: string
  }
): AgentLoopExecutors {
  return {
    create: async (input) => {
      const chats = await agentChats(turn.agentId)
      const chat = input.chat === null ? null : findChat(chats, input.chat)
      if (typeof chat === "string") return { ok: false, error: chat }
      const nextRunAt = nextLoopRunAt(input.schedule, input.timezone)
      if (!nextRunAt) {
        return { ok: false, error: "That schedule never runs again" }
      }
      const creatorId = turn.askerId ?? turn.setUpById
      // The card is the trace: in the chat the turn is about, else in the
      // Loop's own chat. With neither there is no card, and the Loop shows
      // on the agent's page.
      const cardChatId = turn.channelId ?? chat?.id ?? null
      try {
        let loopId: string
        if (cardChatId) {
          const made = await createLoopCard(deps, {
            workspaceId: turn.workspaceId,
            channelId: cardChatId,
            reportsIn: chat?.id ?? null,
            active: { nextRunAt },
            agentId: turn.agentId,
            threadRootId: null,
            creatorId,
            name: input.name,
            instructions: input.instructions,
            schedule: input.schedule,
            timezone: input.timezone,
            endCondition: input.endCondition,
            endAt: input.endAt,
          })
          loopId = made.loopId
          const [loop] = await db
            .select({ cardMessageId: schema.loop.cardMessageId })
            .from(schema.loop)
            .where(eq(schema.loop.id, loopId))
          // The card belongs to the request that made it.
          if (loop?.cardMessageId) {
            await recordConversationPost(
              loop.cardMessageId,
              turn.conversationId
            ).catch((err) =>
              logger.warn({ err, loopId }, "Loop card link failed")
            )
          }
        } else {
          const [loop] = await db
            .insert(schema.loop)
            .values({
              workspaceId: turn.workspaceId,
              channelId: null,
              agentId: turn.agentId,
              creatorId,
              name: input.name,
              instructions: input.instructions,
              schedule: input.schedule,
              timezone: input.timezone,
              endCondition: input.endCondition,
              endAt: input.endAt,
              status: "active",
              nextRunAt,
              changedById: turn.agentId,
              changedAt: new Date(),
            })
            .returning()
          if (!loop) throw new Error("Loop insert returned no row")
          loopId = loop.id
          emitLoopUpdated(deps.emitter, loop)
        }
        // A Loop that reports in a chat other than the card's is announced
        // there too.
        if (chat && chat.id !== cardChatId) {
          await postLoopLine(deps, {
            channelId: chat.id,
            agentId: turn.agentId,
            agentName: turn.agentName,
            loop: { id: loopId, name: input.name },
            event: { eventType: "loop_created" },
          })
        }
        return {
          ok: true,
          loopId,
          note: `It is running${cardChatId ? ", and its card is in the chat" : ". It has no card: people see it on your page"}. ${chat ? `It reports in ${chat.name ?? "that chat"}.` : "It has no chat: each run posts where its result belongs, or nowhere."}${turn.askerId ? "" : " Nobody asked for it just now: when people should know, tell them."}`,
        }
      } catch (err) {
        logger.error({ err, agentId: turn.agentId }, "Agent loop create failed")
        return { ok: false, error: "Failed to set up the Loop" }
      }
    },

    update: async ({ loopId, ...input }) => {
      const [loop] = await db
        .select()
        .from(schema.loop)
        .where(
          and(eq(schema.loop.id, loopId), eq(schema.loop.agentId, turn.agentId))
        )
      if (!loop) return { ok: false, error: "You have no Loop with that id" }
      if (loop.status === "completed") {
        return { ok: false, error: "That Loop is completed and can't change" }
      }
      if (loop.status === "draft" && input.running !== undefined) {
        return {
          ok: false,
          error: "That Loop is a draft: a person starts it from its card.",
        }
      }

      const values: Partial<typeof schema.loop.$inferInsert> = {}
      const changes: LoopChange[] = []
      if (input.name !== undefined && input.name !== loop.name) {
        values.name = input.name
        changes.push("name")
      }
      if (
        input.instructions !== undefined &&
        input.instructions !== loop.instructions
      ) {
        values.instructions = input.instructions
        changes.push("instructions")
      }

      const schedule = input.schedule ?? loop.schedule
      const timezone = input.timezone ?? loop.timezone ?? "UTC"
      const rescheduled =
        schedule !== loop.schedule || timezone !== (loop.timezone ?? "UTC")
      if (rescheduled) {
        const validation = validateLoopSchedule(schedule, timezone)
        if (!validation.ok) return { ok: false, error: validation.reason }
        values.schedule = schedule
        values.timezone = timezone
        changes.push("schedule")
      }

      let channelId = loop.channelId
      if (input.chat !== undefined) {
        const chat =
          input.chat === null
            ? null
            : findChat(await agentChats(turn.agentId), input.chat)
        if (typeof chat === "string") return { ok: false, error: chat }
        if ((chat?.id ?? null) !== loop.channelId) {
          channelId = chat?.id ?? null
          values.channelId = channelId
          changes.push("chat")
        }
      }

      // One end mode per Loop: setting one clears the other.
      if (
        input.endCondition !== undefined &&
        input.endCondition !== loop.endCondition
      ) {
        values.endCondition = input.endCondition
        if (input.endCondition !== null) values.endAt = null
        changes.push("end")
      }
      if (
        input.endAt !== undefined &&
        (input.endAt?.getTime() ?? null) !== (loop.endAt?.getTime() ?? null)
      ) {
        values.endAt = input.endAt
        if (input.endAt !== null) values.endCondition = null
        if (!changes.includes("end")) changes.push("end")
      }

      const willRun =
        input.running === undefined ? loop.status === "active" : input.running
      if (input.running === false && loop.status === "active") {
        values.status = "paused"
        values.pausedReason = "manual"
        values.nextRunAt = null
        changes.push("paused")
      } else if (input.running === true && loop.status === "paused") {
        // It can't run where it is not: a Loop paused because the agent was
        // taken out of its chat stays paused until it has a chat it is in.
        if (channelId && !(await isAgentInChannel(turn.agentId, channelId))) {
          return {
            ok: false,
            error:
              "You are no longer in the chat this Loop reports in. Give it another chat, or none, with `chat`.",
          }
        }
        values.status = "active"
        values.pausedReason = null
        values.consecutiveFailures = 0
        changes.push("resumed")
      }
      if (willRun && (rescheduled || values.status === "active")) {
        const next = nextLoopRunAt(schedule, timezone)
        if (!next) return { ok: false, error: "That schedule never runs again" }
        values.nextRunAt = next
      }
      if (changes.length === 0) {
        return { ok: true, changed: [], note: "Nothing changed." }
      }

      // CAS on the status this was computed against: a person's pause or
      // resume meanwhile wins, and the agent reads the Loop again.
      const [updated] = await db
        .update(schema.loop)
        .set({ ...values, changedById: turn.agentId, changedAt: new Date() })
        .where(
          and(eq(schema.loop.id, loop.id), eq(schema.loop.status, loop.status))
        )
        .returning()
      if (!updated) {
        return {
          ok: false,
          error:
            "That Loop changed just now. Look at it again before changing it.",
        }
      }
      emitLoopUpdated(
        deps.emitter,
        updated,
        changes.includes("chat") ? loop.channelId : null
      )

      // Said in the Loop's chat; with no chat, where a person asked for it.
      const lineChannelId =
        updated.channelId ??
        loop.channelId ??
        (turn.askerId ? turn.channelId : null)
      if (lineChannelId) {
        await postLoopLine(deps, {
          channelId: lineChannelId,
          agentId: turn.agentId,
          agentName: turn.agentName,
          loop: updated,
          event: { eventType: "loop_updated", changes },
        })
      }
      return {
        ok: true,
        changed: changes,
        ...(lineChannelId
          ? {}
          : {
              note: "Nobody was told: it has no chat. The Loop shows you changed it.",
            }),
      }
    },
  }
}
