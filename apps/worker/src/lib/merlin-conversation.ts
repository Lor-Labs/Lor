import type { SQL } from "@repo/db"
import {
  and,
  db,
  desc,
  eq,
  isNull,
  lte,
  ne,
  notExists,
  or,
  schema,
  sql,
} from "@repo/db"
import { userDisplayName } from "@repo/merlin"

const CONTEXT_LIMIT = 30
const THREAD_CONTEXT_LIMIT = 1000
// Preserve nearby uploads without turning earlier channel requests into thread work.
const PRE_THREAD_CONTEXT_LIMIT = 10

// Recent channel/thread messages, oldest→newest; skips the placeholder + empties.
export async function loadConversation(args: {
  channelId: string
  threadRootId: string | null
  merlinMessageId: string
}) {
  const selectTurns = (scope: SQL | undefined) =>
    db
      .select({
        messageId: schema.message.id,
        content: schema.message.content,
        authorName: schema.user.name,
        authorUsername: schema.user.username,
        authorDisplayUsername: schema.user.displayUsername,
        attachments: schema.message.attachments,
      })
      .from(schema.message)
      .innerJoin(schema.user, eq(schema.message.authorId, schema.user.id))
      .where(
        and(
          scope,
          ne(schema.message.id, args.merlinMessageId),
          // Attachment-only messages have null/blank content but are real
          // turns — dropping them made Merlin blind to uploaded files. Blank
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
                  eq(schema.agentRunQueue.state, "queued")
                )
              )
          )
        )
      )
      .orderBy(desc(schema.message.createdAt))

  const scope = args.threadRootId
    ? or(
        eq(schema.message.id, args.threadRootId),
        eq(schema.message.threadRootId, args.threadRootId)
      )
    : and(
        eq(schema.message.channelId, args.channelId),
        isNull(schema.message.threadRootId)
      )

  // Thread context truncates to the newest THREAD_CONTEXT_LIMIT messages as a
  // runaway guard; channel context stays windowed to the newest CONTEXT_LIMIT.
  const rows = await selectTurns(scope).limit(
    args.threadRootId ? THREAD_CONTEXT_LIMIT : CONTEXT_LIMIT
  )

  // Thread runs also get the channel messages that led up to the root —
  // attachments and asks posted right before the thread opened live there.
  let backgroundRows: typeof rows = []
  if (args.threadRootId) {
    const root = await db
      .select({ createdAt: schema.message.createdAt })
      .from(schema.message)
      .where(eq(schema.message.id, args.threadRootId))
      .limit(1)
      .then((r) => r[0])
    if (root) {
      const pre = await selectTurns(
        and(
          eq(schema.message.channelId, args.channelId),
          isNull(schema.message.threadRootId),
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
    return {
      messageId: r.messageId,
      authorName: userDisplayName({
        name: r.authorName,
        username: r.authorUsername,
        displayUsername: r.authorDisplayUsername,
      }),
      content: r.content ?? "",
      ...(images.length > 0 ? { images } : {}),
      ...(files.length > 0 ? { files } : {}),
    }
  }
  return {
    conversation: rows.reverse().map(toTurn),
    backgroundConversation: backgroundRows.reverse().map(toTurn),
  }
}
