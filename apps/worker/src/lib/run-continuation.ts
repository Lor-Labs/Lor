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
import type { AgentRunCompaction, AgentRunContext } from "@repo/db/schema"
import {
  buildInitialUserMessage,
  estimateMessagesTokens,
  formatSpeakerLine,
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
// Not a window: a thread is what the person is looking at, so every message in
// it since the last run goes in. This is a runaway guard only, and if it ever
// trips the delta says so out loud rather than quietly dropping messages.
const MAX_DELTA_MESSAGES = 1000
// Below this the gap is conversational, not a resumption worth flagging.
const ELAPSED_NOTE_MIN_MS = 30 * 60 * 1000

export type Continuation = {
  predecessorRunId: string
  messages: ModelMessage[]
  // Turns the delta rendered, stored as the new run's context.conversation so
  // this run's own successor can replay them (and a crash can rebuild).
  conversation: AgentRunContext["conversation"]
  // The rendered delta, persisted verbatim so a recovered attempt replays the
  // identical message (it embeds elapsed time, which would otherwise drift).
  deltaText: string
  // Predecessor's last step input size, so the first prepareStep can compact
  // an already-heavy inherited transcript before growing it further.
  lastInputTokens: number
  // Working notes from the newest compacted run in the chain — seeds the new
  // run's compactor so facts merge forward instead of being rebuilt from a
  // clipped digest.
  compaction: { summary: string | null; summaryFailures: number } | null
}

type ChainRun = {
  id: string
  context: AgentRunContext | null
  continuedFromRunId: string | null
  compaction: AgentRunCompaction | null
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
        compaction: schema.agentRun.compaction,
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
  // Only rows the predecessor actually injected mid-run are already in its
  // transcript, and those are exactly the ones with consumedAtStep set. A row
  // that merely drained into this run keeps consumedAtStep null — it is this
  // run's trigger and must stay in the delta.
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
    // Newest-first so an overflowing delta drops the OLDEST messages; the
    // triggering message is the most recent one and must never be cut. One
    // extra row is fetched purely to detect that overflow.
    .orderBy(desc(schema.message.createdAt))
    .limit(MAX_DELTA_MESSAGES + 1)
    .then((rows) => ({
      omitted: Math.max(0, rows.length - MAX_DELTA_MESSAGES),
      turns: rows
        .slice(0, MAX_DELTA_MESSAGES)
        .reverse()
        .map((r) => ({
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
        })),
    }))
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

// Replay a finished run and everything it continued from: the chain head's
// original snapshot, then each later hop's delta and steps. Deterministic —
// every run involved is terminal, so its steps and stored delta never change.
// Shared by the build path and by crash recovery of a continued run.
export async function replayChain(headRunId: string): Promise<{
  messages: ModelMessage[]
  lastInputTokens: number
  compaction: { summary: string | null; summaryFailures: number } | null
} | null> {
  const head = await db
    .select({
      id: schema.agentRun.id,
      context: schema.agentRun.context,
      continuedFromRunId: schema.agentRun.continuedFromRunId,
      compaction: schema.agentRun.compaction,
    })
    .from(schema.agentRun)
    .where(eq(schema.agentRun.id, headRunId))
    .limit(1)
    .then((rows) => rows[0])
  if (!head?.context) return null

  const chain = await loadChain(head)
  // Newest compacted projection in the chain. Its baseline embeds everything
  // sent up to that point — the original snapshot, earlier hops, its own
  // pre-compaction steps — so replay starts there and earlier hops are never
  // loaded. This is what keeps a long-lived thread's replay bounded: raw
  // history grows without limit, the baseline never exceeds one context.
  let baseIndex = -1
  for (let i = chain.length - 1; i >= 0; i--) {
    if (chain[i]?.compaction) {
      baseIndex = i
      break
    }
  }
  const base = baseIndex >= 0 ? chain[baseIndex]?.compaction : null
  const replayed = chain.slice(Math.max(baseIndex, 0))

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
        replayed.map((c) => c.id)
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

  // Oldest first: the first replayed run carries its baseline (or the
  // original snapshot); every later hop replays the stored delta that started
  // it, so no history is skipped.
  const messages: ModelMessage[] = []
  for (const [index, run] of replayed.entries()) {
    if (!run.context) continue
    if (index === 0 && base) {
      messages.push(...(base.baselineMessages as ModelMessage[]))
    } else if (index === 0 && baseIndex < 0) {
      messages.push(await buildInitialUserMessage(run.context))
    } else if (run.context.continuationDelta) {
      messages.push({ role: "user", content: run.context.continuationDelta })
    }
    const rows = stepsByRun.get(run.id) ?? []
    const afterBaseline =
      index === 0 && base ? rows.filter((r) => r.step > base.atStep) : rows
    for (const row of afterBaseline) {
      messages.push(...(row.messages as ModelMessage[]))
    }
  }
  // Keep the head (the original ask) and the most recent history when a chain
  // runs long; the compactor thins what remains.
  const trimmed =
    messages.length > MAX_INHERITED_STEPS
      ? [
          ...messages.slice(0, 1),
          ...messages.slice(messages.length - MAX_INHERITED_STEPS + 1),
        ]
      : messages
  // What the inherited transcript will actually WEIGH on the next request —
  // not what the predecessor's last step weighed. Those differ badly when the
  // predecessor compacted: its final steps were small precisely because the
  // bulk had been projected away, while the transcript replayed here still
  // holds all of it. Seeding the compaction trigger with the small number
  // would send the whole thing uncompacted.
  return {
    messages: trimmed,
    lastInputTokens: Math.max(
      estimateMessagesTokens(trimmed),
      stepRows.at(-1)?.inputTokens ?? 0
    ),
    // Failures reset to zero: they counted retries against one run's
    // summarizer, not against the notes themselves.
    compaction: base ? { summary: base.summary, summaryFailures: 0 } : null,
  }
}

// Rebuild a continued run's exact prefix after a crash: the chain it inherited
// plus the delta it was started with, replayed verbatim from its snapshot.
export async function replayContinuedPrefix(args: {
  continuedFromRunId: string
  context: AgentRunContext
}): Promise<ModelMessage[] | null> {
  const replayed = await replayChain(args.continuedFromRunId).catch(() => null)
  if (!replayed) return null
  const delta = args.context.continuationDelta
  return delta
    ? [...replayed.messages, { role: "user", content: delta }]
    : replayed.messages
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
    const { turns, omitted } = await loadDelta({
      predecessorRunId: predecessor.id,
      predecessorStartedAt: since,
      scopeKey: args.scopeKey,
      channelId: args.channelId,
      merlinMessageId: args.merlinMessageId,
    })
    const finishedAt = predecessor.finishedAt ?? since
    const deltaText = formatDelta(
      turns,
      Date.now() - finishedAt.getTime(),
      omitted
    )
    // Nothing new since the predecessor: this run was triggered by something
    // the transcript already covers, so continuing would just re-ask the same
    // question. Let the fresh path build a normal snapshot.
    if (!deltaText) return null

    const replayed = await replayChain(predecessor.id)
    if (!replayed) return null

    return {
      predecessorRunId: predecessor.id,
      messages: [
        ...replayed.messages,
        { role: "user", content: deltaText } satisfies ModelMessage,
      ],
      conversation: turns,
      deltaText,
      lastInputTokens: replayed.lastInputTokens,
      compaction: replayed.compaction,
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
