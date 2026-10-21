import {
  and,
  db,
  desc,
  eq,
  gt,
  isNotNull,
  LOR_USER_ID,
  ne,
  notInArray,
  or,
  schema,
  sql,
} from "@repo/db"
import type { AgentRunContext } from "@repo/db/schema"
import { formatSpeakerLine, userDisplayName } from "@repo/lor"
import { SessionCoreError } from "@repo/lor/session-core"

// A thread is one continuous conversation however long the gaps between
// replies, so there is no age cutoff on continuing it. Elapsed time is told to
// the model instead (see formatDelta) — a long gap means "re-check what may
// have changed", not "forget what you did".
//
// Not a window: a thread is what the person is looking at, so every message in
// it since the last run goes in. This is a runaway guard only, and if it ever
// trips the delta says so out loud rather than quietly dropping messages.
const MAX_DELTA_MESSAGES = 1000
// Below this the gap is conversational, not a resumption worth flagging.
const ELAPSED_NOTE_MIN_MS = 30 * 60 * 1000

// A turn with no new messages.
const NOTHING_NEW =
  "Nothing new was said since you last worked. Continue where you left off."

type DeltaRow = {
  id: string
  content: string | null
  attachments:
    | { url: string; filename: string; size: number; contentType: string }[]
    | null
  name: string
  eventType?: string | null
}

// A loop's fire line is Lor-authored but is the turn's request, so it reads
// as coming from the schedule.
export const LOOP_SCHEDULE_SPEAKER = "Loop schedule"

function toTurn(row: DeltaRow): AgentRunContext["conversation"][number] {
  return {
    authorName:
      row.eventType === "loop_run"
        ? LOOP_SCHEDULE_SPEAKER
        : userDisplayName(row),
    content: row.content ?? "",
    images: (row.attachments ?? [])
      .filter((a) => a.contentType.startsWith("image/"))
      .map((a) => ({
        url: a.url,
        filename: a.filename,
        mediaType: a.contentType,
        size: a.size,
      })),
    files: (row.attachments ?? [])
      .filter((a) => !a.contentType.startsWith("image/"))
      .map((a) => ({
        url: a.url,
        filename: a.filename,
        mediaType: a.contentType,
        size: a.size,
      })),
  }
}

// Messages that landed in the scope after the predecessor started, minus every
// message durably covered by its request and minus Lor's own placeholders.
async function loadDelta(args: {
  predecessorRunId: string
  predecessorStartedAt: Date
  predecessorContext: AgentRunContext
  scopeKey: string
  channelId: string
  lorMessageId: string
}) {
  // Queue rows cover guaranteed steers. The saved context IDs cover the
  // messages the predecessor's request rendered.
  const consumed = await db
    .select({ messageId: schema.agentRunQueue.messageId })
    .from(schema.agentRunQueue)
    .where(
      and(
        eq(schema.agentRunQueue.runId, args.predecessorRunId),
        eq(schema.agentRunQueue.state, "consumed"),
        isNotNull(schema.agentRunQueue.consumedAtStep)
      )
    )
  const alreadyCovered = new Set([
    ...(args.predecessorContext.coveredMessageIds ?? []),
    ...consumed.map((c) => c.messageId),
  ])

  const rows = await db
    .select({
      id: schema.message.id,
      content: schema.message.content,
      attachments: schema.message.attachments,
      name: schema.user.name,
      eventType: schema.message.eventType,
    })
    .from(schema.message)
    .innerJoin(schema.user, eq(schema.message.authorId, schema.user.id))
    .where(
      and(
        eq(schema.message.channelId, args.channelId),
        or(
          eq(schema.message.id, args.scopeKey),
          eq(schema.message.threadRootId, args.scopeKey)
        ),
        gt(schema.message.createdAt, args.predecessorStartedAt),
        ne(schema.message.id, args.lorMessageId),
        // Lor's own answers are already in the conversation as assistant
        // turns; re-adding them as user text would double them. A loop's
        // fire line is the exception: it is the new turn's request.
        or(
          ne(schema.message.authorId, LOR_USER_ID),
          eq(schema.message.eventType, "loop_run")
        ),
        or(
          isNotNull(schema.message.content),
          sql`jsonb_array_length(coalesce(${schema.message.attachments}, '[]'::jsonb)) > 0`
        ),
        alreadyCovered.size > 0
          ? notInArray(schema.message.id, [...alreadyCovered])
          : sql`true`,
        // Queued messages get their own follow-up run, same as the fresh path.
        sql`not exists (select 1 from ${schema.agentRunQueue} q where q.message_id = ${schema.message.id} and q.state = 'queued')`
      )
    )
    // Newest-first so an overflowing delta drops the OLDEST messages; the
    // triggering message is the most recent one and must never be cut. One
    // extra row is fetched purely to detect that overflow.
    .orderBy(desc(schema.message.createdAt))
    .limit(MAX_DELTA_MESSAGES + 1)

  // The SQL predicate is authoritative; this also keeps mocked and stale reads
  // from duplicating a durably covered message.
  const unseen = rows.filter((row) => !alreadyCovered.has(row.id))
  const included = unseen.slice(0, MAX_DELTA_MESSAGES).reverse()
  const turns = included.map(toTurn)

  return {
    omitted: Math.max(0, unseen.length - MAX_DELTA_MESSAGES),
    turns,
    coveredMessageIds: included.map((row) => row.id),
  }
}

function humanizeGap(ms: number): string {
  const hours = ms / (60 * 60 * 1000)
  if (hours < 24) {
    const h = Math.round(hours)
    return h <= 1 ? "about an hour" : `about ${h} hours`
  }
  const days = Math.round(hours / 24)
  return days === 1 ? "a day" : `${days} days`
}

// Render the delta as one user message. Images ride as [file: …] lines rather
// than vision parts — a continued run's new images are described, not shown
// (matching the mid-run steer injection format).
export function formatDelta(
  turns: AgentRunContext["conversation"],
  elapsedMs?: number,
  omittedCount = 0
): string | null {
  if (turns.length === 0) return null
  const lines = turns.map((t) => {
    const attachments = [...(t.images ?? []), ...(t.files ?? [])].map(
      (a) =>
        `\n[file: ${a.filename} — ${a.mediaType}, ${a.size} bytes — ${a.url}]`
    )
    // Attachment lines ride inside the body so the speaker-line indent also
    // neutralizes filename newlines.
    return formatSpeakerLine(
      t.authorName,
      `${t.content}${attachments.join("")}`
    )
  })
  // A long gap doesn't invalidate the work above, but anything time-sensitive
  // in it (query results, statuses, file contents) may have moved on.
  const gap =
    elapsedMs && elapsedMs >= ELAPSED_NOTE_MIN_MS
      ? ` It has been ${humanizeGap(elapsedMs)} since then, so re-check anything that may have changed rather than assuming earlier results still hold.`
      : ""
  // Never drop messages silently: the people in the thread can see them, so
  // say what is missing and how to get it.
  const omitted =
    omittedCount > 0
      ? `\n\n(${omittedCount} earlier message${omittedCount === 1 ? "" : "s"} in this thread are not shown here — use read_thread if you need them.)`
      : ""
  return `The conversation continued since you last worked. Pick up where you left off — everything above is still your context.${gap}${omitted}\n\n${lines.join("\n")}`
}

// The run that saved the conversation last; its request's coverage and start
// time bound the next delta.
export async function loadPredecessorRun(runId: string | null) {
  const run = runId
    ? await db
        .select({
          id: schema.agentRun.id,
          context: schema.agentRun.context,
          startedAt: schema.agentRun.startedAt,
          createdAt: schema.agentRun.createdAt,
          finishedAt: schema.agentRun.finishedAt,
        })
        .from(schema.agentRun)
        .where(eq(schema.agentRun.id, runId))
        .then((rows) => rows[0])
    : undefined
  if (!run?.context) {
    throw new SessionCoreError(
      "corrupt_state",
      "The saved conversation has no last run to continue from"
    )
  }
  return { ...run, context: run.context }
}

export type TurnDelta = {
  text: string
  turns: AgentRunContext["conversation"]
  coveredMessageIds: string[]
}

// The prompt of a Pi turn after the session's first: what was said in the
// thread since the last saved turn. Pi's saved state holds everything before
// it (reference/planned/pi-harness-runbook.md §4.3).
export async function buildTurnDelta(args: {
  predecessorRunId: string | null
  scopeKey: string
  channelId: string
  lorMessageId: string
}): Promise<TurnDelta> {
  const predecessor = await loadPredecessorRun(args.predecessorRunId)
  const since = predecessor.startedAt ?? predecessor.createdAt
  const delta = await loadDelta({
    predecessorRunId: predecessor.id,
    predecessorStartedAt: since,
    predecessorContext: predecessor.context,
    scopeKey: args.scopeKey,
    channelId: args.channelId,
    lorMessageId: args.lorMessageId,
  })
  const finishedAt = predecessor.finishedAt ?? since
  return {
    text:
      formatDelta(
        delta.turns,
        Date.now() - finishedAt.getTime(),
        delta.omitted
      ) ?? NOTHING_NEW,
    turns: delta.turns,
    coveredMessageIds: delta.coveredMessageIds,
  }
}
