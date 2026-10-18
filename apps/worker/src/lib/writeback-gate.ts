import {
  and,
  asc,
  db,
  desc,
  eq,
  isNotNull,
  LOR_USER_ID,
  ne,
  schema,
} from "@repo/db"
import { formatSpeakerLine } from "@repo/lor"

// The write-back gate judges one turn. In a session, a continued turn is only
// the new messages, so this adds what the turn is about: the title, the chat
// the session started from, and people's earlier prompts.
// reference/planned/session-memory.md Step 4.
const EARLIER_TURNS_MAX = 50
const EARLIER_CHARS_MAX = 8_000
const SEED_LINE_CHARS_MAX = 500

// Archiving a session stops its run the same way the Stop button does. A
// person pressing Stop discards the turn; an archive still keeps what the
// turn already found.
export async function sessionArchived(threadRootId: string): Promise<boolean> {
  const row = await db
    .select({ archivedAt: schema.agentSession.archivedAt })
    .from(schema.agentSession)
    .where(eq(schema.agentSession.threadRootId, threadRootId))
    .limit(1)
    .then((r) => r[0])
  return !!row?.archivedAt
}

export async function sessionGateContext(
  threadRootId: string,
  turnMessageIds: ReadonlySet<string>
): Promise<string> {
  const session = await db
    .select({ id: schema.agentSession.id, title: schema.agentSession.title })
    .from(schema.agentSession)
    .where(eq(schema.agentSession.threadRootId, threadRootId))
    .limit(1)
    .then((r) => r[0])
  if (!session) return ""

  const [seed, earlier] = await Promise.all([
    db
      .select({
        authorName: schema.user.name,
        content: schema.message.content,
      })
      .from(schema.agentSessionContext)
      .innerJoin(
        schema.message,
        eq(schema.message.id, schema.agentSessionContext.messageId)
      )
      .innerJoin(schema.user, eq(schema.user.id, schema.message.authorId))
      .where(eq(schema.agentSessionContext.sessionId, session.id))
      .orderBy(asc(schema.message.createdAt)),
    db
      .select({
        id: schema.message.id,
        authorName: schema.user.name,
        content: schema.message.content,
      })
      .from(schema.message)
      .innerJoin(schema.user, eq(schema.user.id, schema.message.authorId))
      .where(
        and(
          eq(schema.message.threadRootId, threadRootId),
          ne(schema.message.authorId, LOR_USER_ID),
          eq(schema.message.excludedFromMemory, false),
          isNotNull(schema.message.content)
        )
      )
      .orderBy(desc(schema.message.createdAt))
      .limit(EARLIER_TURNS_MAX),
  ])

  // Newest first until the budget runs out, then back to reading order.
  const earlierLines: string[] = []
  let budget = EARLIER_CHARS_MAX
  for (const row of earlier) {
    if (turnMessageIds.has(row.id)) continue
    const line = formatSpeakerLine(row.authorName, row.content ?? "")
    if (line.length > budget) break
    budget -= line.length
    earlierLines.push(line)
  }
  earlierLines.reverse()

  const seedLines = seed.map((row) =>
    formatSpeakerLine(
      row.authorName,
      (row.content ?? "").slice(0, SEED_LINE_CHARS_MAX)
    )
  )

  return [
    `Session: ${session.title}`,
    seedLines.length > 0 ? `Started from:\n${seedLines.join("\n")}` : "",
    earlierLines.length > 0
      ? `Earlier in this session:\n${earlierLines.join("\n")}`
      : "",
    "This turn:",
  ]
    .filter(Boolean)
    .join("\n\n")
}
