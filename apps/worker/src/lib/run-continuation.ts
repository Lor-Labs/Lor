import {
  and,
  asc,
  db,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  MERLIN_USER_ID,
  ne,
  notInArray,
  or,
  schema,
  sql,
} from "@repo/db"
import type { AgentRunContext } from "@repo/db/schema"
import {
  buildInitialUserMessage,
  type ModelMessage,
  userDisplayName,
} from "@repo/merlin"
import { logger } from "@/lib/logger"

// A thread is one continuous conversation however long the gaps between
// replies, so there is no age cutoff on continuing it. Elapsed time is told to
// the model instead (see formatDelta) — a long gap means "re-check what may
// have changed", not "forget what you did".
//
// How far back a chain of continued runs is replayed. Each run's steps hold
// only its own messages, so the whole chain is walked to reconstruct the full
// history; these bound the walk for pathological threads. The compactor prunes
// old tool calls beyond this anyway.
const MAX_CHAIN_HOPS = 20
const MAX_INHERITED_STEPS = 400
const MAX_DELTA_MESSAGES = 30
// Below this the gap is conversational, not a resumption worth flagging.
const ELAPSED_NOTE_MIN_MS = 30 * 60 * 1000

export type Continuation = {
  predecessorRunId: string
  messages: ModelMessage[]
  // Turns the delta rendered, stored as the new run's context.conversation so
  // this run's own successor can replay them (and a crash can rebuild).
  conversation: AgentRunContext["conversation"]
  // Predecessor's last step input size, so the first prepareStep can compact
  // an already-heavy inherited transcript before growing it further.
  lastInputTokens: number
}

type ChainRun = {
  id: string
  context: AgentRunContext | null
  continuedFromRunId: string | null
}

// Newest finished run in this scope worth continuing. `failed` qualifies on
// purpose: a run that tripped a budget rail mid-work is exactly the one whose
// transcript the follow-up should inherit.
async function findPredecessor(args: {
  scopeKey: string
  channelId: string
  excludeRunId: string | undefined
}) {
  return await db
    .select({
      id: schema.agentRun.id,
      context: schema.agentRun.context,
      continuedFromRunId: schema.agentRun.continuedFromRunId,
      startedAt: schema.agentRun.startedAt,
      createdAt: schema.agentRun.createdAt,
      finishedAt: schema.agentRun.finishedAt,
    })
    .from(schema.agentRun)
    .where(
      and(
        eq(schema.agentRun.scopeKey, args.scopeKey),
        eq(schema.agentRun.channelId, args.channelId),
        inArray(schema.agentRun.state, ["complete", "stopped", "failed"]),
        isNotNull(schema.agentRun.context),
        gt(schema.agentRun.steps, 0),
        isNotNull(schema.agentRun.finishedAt),
        args.excludeRunId
          ? ne(schema.agentRun.id, args.excludeRunId)
          : sql`true`
      )
    )
    .orderBy(desc(schema.agentRun.finishedAt))
    .limit(1)
    .then((rows) => rows[0])
}

// Walk continuedFromRunId back to the run that started the chain. Returned
// oldest first: the head of this list holds the original fresh snapshot, and
// every run after it contributed a delta.
async function loadChain(head: ChainRun): Promise<ChainRun[]> {
  const chain: ChainRun[] = [head]
  let cursor = head.continuedFromRunId
  const seen = new Set([head.id])
  while (cursor && chain.length < MAX_CHAIN_HOPS && !seen.has(cursor)) {
    seen.add(cursor)
    const row = await db
      .select({
        id: schema.agentRun.id,
        context: schema.agentRun.context,
        continuedFromRunId: schema.agentRun.continuedFromRunId,
      })
      .from(schema.agentRun)
      .where(eq(schema.agentRun.id, cursor))
      .limit(1)
      .then((rows) => rows[0])
    if (!row?.context) break
    chain.unshift(row)
    cursor = row.continuedFromRunId
  }
  return chain
}

// Messages that landed in the scope after the predecessor started, minus the
// ones already inside its transcript (steered rows it consumed) and minus
// Merlin's own placeholders. This is what the model hasn't seen yet.
async function loadDelta(args: {
  predecessorRunId: string
  predecessorStartedAt: Date
  scopeKey: string
  channelId: string
  merlinMessageId: string
}) {
  const consumed = await db
    .select({ messageId: schema.agentRunQueue.messageId })
    .from(schema.agentRunQueue)
    .where(
      and(
        eq(schema.agentRunQueue.runId, args.predecessorRunId),
        eq(schema.agentRunQueue.state, "consumed")
      )
    )
  const consumedIds = consumed.map((c) => c.messageId)

  return await db
    .select({
      content: schema.message.content,
      attachments: schema.message.attachments,
      name: schema.user.name,
      username: schema.user.username,
      displayUsername: schema.user.displayUsername,
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
        ne(schema.message.id, args.merlinMessageId),
        // Merlin's own answers are already in the transcript as assistant
        // turns; re-adding them as user text would double them.
        ne(schema.message.authorId, MERLIN_USER_ID),
        or(
          isNotNull(schema.message.content),
          sql`jsonb_array_length(coalesce(${schema.message.attachments}, '[]'::jsonb)) > 0`
        ),
        consumedIds.length > 0
          ? notInArray(schema.message.id, consumedIds)
          : sql`true`,
        // Queued messages get their own follow-up run, same as the fresh path.
        sql`not exists (select 1 from ${schema.agentRunQueue} q where q.message_id = ${schema.message.id} and q.state = 'queued')`
      )
    )
    .orderBy(asc(schema.message.createdAt))
    .limit(MAX_DELTA_MESSAGES)
    .then((rows) =>
      rows.map((r) => ({
        authorName: userDisplayName(r),
        content: r.content ?? "",
        images: (r.attachments ?? [])
          .filter((a) => a.contentType.startsWith("image/"))
          .map((a) => ({
            url: a.url,
            filename: a.filename,
            mediaType: a.contentType,
            size: a.size,
          })),
        files: (r.attachments ?? [])
          .filter((a) => !a.contentType.startsWith("image/"))
          .map((a) => ({
            url: a.url,
            filename: a.filename,
            mediaType: a.contentType,
            size: a.size,
          })),
      }))
    )
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
  elapsedMs?: number
): string | null {
  if (turns.length === 0) return null
  const lines = turns.map((t) => {
    const attachments = [...(t.images ?? []), ...(t.files ?? [])].map(
      (a) =>
        `\n[file: ${a.filename} — ${a.mediaType}, ${a.size} bytes — ${a.url}]`
    )
    return `${t.authorName}: ${t.content}${attachments.join("")}`
  })
  // A long gap doesn't invalidate the work above, but anything time-sensitive
  // in it (query results, statuses, file contents) may have moved on.
  const gap =
    elapsedMs && elapsedMs >= ELAPSED_NOTE_MIN_MS
      ? ` It has been ${humanizeGap(elapsedMs)} since then, so re-check anything that may have changed rather than assuming earlier results still hold.`
      : ""
  return `The conversation continued since you last worked. Pick up where you left off — everything above is still your context.${gap}\n\n${lines.join("\n")}`
}

// Assemble a continued context: the full chain of prior runs in this scope
// (the original snapshot, then each hop's delta and steps) plus one user
// message carrying what has been said since. Returns null whenever the
// fresh-snapshot path should be used instead — no predecessor, nothing new to
// say, or missing steps.
export async function buildContinuation(args: {
  scopeKey: string
  channelId: string
  merlinMessageId: string
  runId: string | undefined
}): Promise<Continuation | null> {
  try {
    const predecessor = await findPredecessor({
      scopeKey: args.scopeKey,
      channelId: args.channelId,
      excludeRunId: args.runId,
    })
    if (!predecessor?.context) return null

    const since = predecessor.startedAt ?? predecessor.createdAt
    const turns = await loadDelta({
      predecessorRunId: predecessor.id,
      predecessorStartedAt: since,
      scopeKey: args.scopeKey,
      channelId: args.channelId,
      merlinMessageId: args.merlinMessageId,
    })
    const finishedAt = predecessor.finishedAt ?? since
    const deltaText = formatDelta(turns, Date.now() - finishedAt.getTime())
    // Nothing new since the predecessor: this run was triggered by something
    // the transcript already covers, so continuing would just re-ask the same
    // question. Let the fresh path build a normal snapshot.
    if (!deltaText) return null

    const chain = await loadChain(predecessor)
    const stepRows = await db
      .select({
        runId: schema.agentRunStep.runId,
        step: schema.agentRunStep.step,
        messages: schema.agentRunStep.messages,
        inputTokens: schema.agentRunStep.inputTokens,
      })
      .from(schema.agentRunStep)
      .where(
        inArray(
          schema.agentRunStep.runId,
          chain.map((c) => c.id)
        )
      )
      .orderBy(asc(schema.agentRunStep.step))
    if (stepRows.length === 0) return null

    const stepsByRun = new Map<string, typeof stepRows>()
    for (const row of stepRows) {
      const list = stepsByRun.get(row.runId) ?? []
      list.push(row)
      stepsByRun.set(row.runId, list)
    }

    // Oldest first: the chain head carries the original snapshot; every later
    // hop re-renders the delta that started it, so no history is skipped.
    const messages: ModelMessage[] = []
    for (const [index, run] of chain.entries()) {
      if (!run.context) continue
      if (index === 0) {
        messages.push(await buildInitialUserMessage(run.context))
      } else {
        const hopDelta = formatDelta(run.context.conversation)
        if (hopDelta) messages.push({ role: "user", content: hopDelta })
      }
      for (const row of stepsByRun.get(run.id) ?? []) {
        messages.push(...(row.messages as ModelMessage[]))
      }
    }
    // Keep the head (the original ask) and the most recent history when a
    // chain runs long; the compactor thins what remains.
    const trimmed =
      messages.length > MAX_INHERITED_STEPS
        ? [
            ...messages.slice(0, 1),
            ...messages.slice(messages.length - MAX_INHERITED_STEPS + 1),
          ]
        : messages

    return {
      predecessorRunId: predecessor.id,
      messages: [
        ...trimmed,
        { role: "user", content: deltaText } satisfies ModelMessage,
      ],
      conversation: turns,
      lastInputTokens: stepRows.at(-1)?.inputTokens ?? 0,
    }
  } catch (err) {
    // Continuation is an optimization; any failure falls back to a fresh run.
    logger.warn(
      { err, scopeKey: args.scopeKey },
      "Run continuation failed; falling back to a fresh context"
    )
    return null
  }
}
