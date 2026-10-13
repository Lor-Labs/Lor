import type { SQL } from "@repo/db"
import {
  and,
  db,
  desc,
  eq,
  inArray,
  isNull,
  lte,
  ne,
  notExists,
  or,
  schema,
  sql,
} from "@repo/db"
import { chatFeedMessage } from "@repo/db/queries/agent-sessions"
import { userDisplayName } from "@repo/lor"
import { meetingThreadContext } from "./meeting-context"
import { LOOP_SCHEDULE_SPEAKER } from "./run-continuation"

const CONTEXT_LIMIT = 30
const THREAD_CONTEXT_LIMIT = 1000
// Preserve nearby uploads without turning earlier channel requests into thread work.
const PRE_THREAD_CONTEXT_LIMIT = 10

// Recent channel/thread messages, oldest→newest; skips the placeholder + empties.
export async function loadConversation(args: {
  channelId: string
  threadRootId: string | null
  lorMessageId: string
  triggerMessageId?: string
}) {
  const selectTurns = (scope: SQL | undefined) =>
    db
      .select({
        messageId: schema.message.id,
        content: schema.message.content,
        authorName: schema.user.name,
        attachments: schema.message.attachments,
        embeds: schema.message.embeds,
        eventType: schema.message.eventType,
        eventPayload: schema.message.eventPayload,
      })
      .from(schema.message)
      .innerJoin(schema.user, eq(schema.message.authorId, schema.user.id))
      .where(
        and(
          scope,
          ne(schema.message.id, args.lorMessageId),
          // Attachment-only messages have null/blank content but are real
          // turns — dropping them made Lor blind to uploaded files. Blank
          // messages with nothing attached stay out (empty turns, placeholders).
          or(
            sql`btrim(coalesce(${schema.message.content}, '')) <> ''`,
            sql`jsonb_array_length(coalesce(${schema.message.attachments}, '[]'::jsonb)) > 0`
          ),
          // Still-queued messages haven't been "sent" yet — each gets its own
          // follow-up run, so they stay out of earlier runs' context (mirrors
          // the clients hiding them from the transcript).
          notExists(
            db
              .select({ id: schema.agentRunQueue.id })
              .from(schema.agentRunQueue)
              .where(
                and(
                  eq(schema.agentRunQueue.messageId, schema.message.id),
                  eq(schema.agentRunQueue.state, "queued"),
                  // An approval resume queues on Lor's own reply, which
                  // stays in the conversation.
                  isNull(schema.agentRunQueue.resumeApprovalId)
                )
              )
          )
        )
      )
      .orderBy(desc(schema.message.createdAt))

  const scope = args.threadRootId
    ? and(
        eq(schema.message.channelId, args.channelId),
        or(
          eq(schema.message.id, args.threadRootId),
          eq(schema.message.threadRootId, args.threadRootId)
        )
      )
    : and(eq(schema.message.channelId, args.channelId), chatFeedMessage())

  // Thread context truncates to the newest THREAD_CONTEXT_LIMIT messages as a
  // runaway guard; channel context stays windowed to the newest CONTEXT_LIMIT.
  const limit = args.threadRootId ? THREAD_CONTEXT_LIMIT : CONTEXT_LIMIT
  const rows = await selectTurns(scope).limit(limit)
  if (
    args.triggerMessageId &&
    !rows.some((row) => row.messageId === args.triggerMessageId)
  ) {
    const [trigger] = await selectTurns(
      and(scope, eq(schema.message.id, args.triggerMessageId))
    ).limit(1)
    if (trigger) {
      // The missing trigger is older than the newest window. Reserve its
      // slot by dropping the oldest other turn, keeping newest-first order.
      rows.splice(limit - 1)
      rows.push(trigger)
    }
  }

  // Thread runs also get background. A Lor session gets the context it was
  // started with (agent_session_context). Other threads (pre-redesign Lor
  // threads) get the channel messages that led up to the root.
  let backgroundRows: typeof rows = []
  if (args.threadRootId) {
    const root = await db
      .select({
        createdAt: schema.message.createdAt,
        type: schema.message.type,
      })
      .from(schema.message)
      .where(
        and(
          eq(schema.message.channelId, args.channelId),
          eq(schema.message.id, args.threadRootId)
        )
      )
      .limit(1)
      .then((r) => r[0])
    if (root?.type === "agent_session") {
      const context = await db
        .select({ messageId: schema.agentSessionContext.messageId })
        .from(schema.agentSessionContext)
        .innerJoin(
          schema.agentSession,
          eq(schema.agentSession.id, schema.agentSessionContext.sessionId)
        )
        .where(eq(schema.agentSession.threadRootId, args.threadRootId))
      backgroundRows =
        context.length > 0
          ? await selectTurns(
              inArray(
                schema.message.id,
                context.map((row) => row.messageId)
              )
            )
          : []
    } else if (root) {
      const pre = await selectTurns(
        and(
          eq(schema.message.channelId, args.channelId),
          chatFeedMessage(),
          ne(schema.message.id, args.threadRootId),
          lte(schema.message.createdAt, root.createdAt)
        )
      ).limit(PRE_THREAD_CONTEXT_LIMIT)
      backgroundRows = pre
    }
  }

  const toTurn = (r: (typeof rows)[number]) => {
    const toRef = (a: NonNullable<typeof r.attachments>[number]) => ({
      url: a.url,
      filename: a.filename,
      mediaType: a.contentType,
      size: a.size,
    })
    const images = (r.attachments ?? [])
      .filter((a) => a.contentType.startsWith("image/"))
      .map(toRef)
    const files = (r.attachments ?? [])
      .filter((a) => !a.contentType.startsWith("image/"))
      .map(toRef)
    // Lor posts both lines, but each is the turn's request: a loop's fire
    // reads as the schedule, an Act event as its source.
    const authorName =
      r.eventType === "loop_run"
        ? LOOP_SCHEDULE_SPEAKER
        : r.eventType === "trigger_run" &&
            r.eventPayload &&
            "label" in r.eventPayload
          ? r.eventPayload.label
          : userDisplayName({ name: r.authorName })
    return {
      messageId: r.messageId,
      authorName,
      content:
        (r.content ?? "") +
        (r.messageId === args.threadRootId
          ? meetingThreadContext(r.embeds)
          : ""),
      ...(images.length > 0 ? { images } : {}),
      ...(files.length > 0 ? { files } : {}),
    }
  }
  return {
    conversation: rows.reverse().map(toTurn),
    backgroundConversation: backgroundRows.reverse().map(toTurn),
  }
}
