import {
  and,
  asc,
  db,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  LOR_USER_ID,
  ne,
  notInArray,
  or,
  schema,
  sql,
} from "@repo/db"
import type {
  AgentRunApprovalResume,
  AgentRunCompaction,
  AgentRunContext,
} from "@repo/db/schema"
import {
  buildInitialUserMessage,
  estimateMessagesTokens,
  formatSpeakerLine,
  isSafeSplit,
  type ModelMessage,
  userDisplayName,
} from "@repo/lor"
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
  coveredMessageIds: string[]
  // The rendered delta, persisted verbatim so a recovered attempt replays the
  // identical message (it embeds elapsed time, which would otherwise drift).
  // Null on an approval resume, which ends in a tool message instead.
  deltaText: string | null
  // Set instead of deltaText when this continuation resumes a parked approval.
  approvalResume: AgentRunApprovalResume | null
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

// Newest finished run in this scope worth continuing. `failed` qualifies on
// purpose: a run that tripped a budget rail mid-work is exactly the one whose
// transcript the follow-up should inherit.
export async function findPredecessor(args: {
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
      stopReason: schema.agentRun.stopReason,
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

// The message that resumes a parked tool call. The AI SDK only looks at the
// LAST message for approval responses and requires role "tool", so this must
// always be appended last — the human's own words ride the step-boundary
// steering injection instead of a trailing user message.
export function approvalResponseMessage(
  resume: AgentRunApprovalResume
): ModelMessage {
  return {
    role: "tool",
    content: [
      {
        type: "tool-approval-response",
        approvalId: resume.approvalId,
        approved: resume.approved,
        ...(resume.reason ? { reason: resume.reason } : {}),
      },
    ],
  }
}

function hasValidBaseline(run: ChainRun): boolean {
  const compaction = run.compaction
  return Boolean(
    compaction &&
      Array.isArray(compaction.baselineMessages) &&
      Number.isInteger(compaction.atStep) &&
      compaction.atStep >= 0
  )
}

// Walk continuedFromRunId back to the run that started the chain. Returned
// oldest first: the head of this list holds the original fresh snapshot, and
// every run after it contributed a delta. A compaction baseline is also a
// complete root: it embeds everything older, so traversal can stop there.
async function loadChain(head: ChainRun): Promise<ChainRun[] | null> {
  const chain: ChainRun[] = [head]
  if (hasValidBaseline(head)) return chain

  let cursor = head.continuedFromRunId
  const seen = new Set([head.id])
  while (cursor) {
    // Never replay a partial chain. A cycle or overlong chain without a
    // compaction baseline falls back to the fresh context path.
    if (chain.length >= MAX_CHAIN_HOPS || seen.has(cursor)) return null
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
    if (!row?.context) return null
    chain.unshift(row)
    if (hasValidBaseline(row)) return chain
    cursor = row.continuedFromRunId
  }
  return chain
}

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
// message durably covered by its transcript and minus Lor's own placeholders.
async function loadDelta(args: {
  predecessorRunId: string
  predecessorStartedAt: Date
  predecessorContext: AgentRunContext
  scopeKey: string
  channelId: string
  lorMessageId: string
}) {
  // Queue rows cover guaranteed steers. The checkpointed context IDs cover
  // ambient injections, which have no agentRunQueue row.
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
        // Lor's own answers are already in the transcript as assistant
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
  if (!chain) return null
  // Newest compacted projection in the chain. Its baseline embeds everything
  // sent up to that point — the original snapshot, earlier hops, its own
  // pre-compaction steps — so replay starts there and earlier hops are never
  // loaded. This is what keeps a long-lived thread's replay bounded: raw
  // history grows without limit, the baseline never exceeds one context.
  let baseIndex = -1
  for (let i = chain.length - 1; i >= 0; i--) {
    const run = chain[i]
    if (run && hasValidBaseline(run)) {
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
    } else if (run.context.approvalResume) {
      messages.push(approvalResponseMessage(run.context.approvalResume))
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
  // runs long; the compactor thins what remains. The cut slides forward to a
  // boundary where no dropped tool call leaves its result orphaned in the kept
  // suffix — providers reject a request with an unpaired tool message.
  let trimmed = messages
  if (messages.length > MAX_INHERITED_STEPS) {
    let cut = messages.length - MAX_INHERITED_STEPS + 1
    // Move backward to retain the assistant tool-call turn and every result it
    // owns. Moving forward can leave a suffix beginning with a tool message or
    // discard the complete pair despite room to retain it.
    while (
      cut > 1 &&
      (messages[cut]?.role === "tool" || !isSafeSplit(messages, cut))
    ) {
      cut--
    }
    trimmed = [messages[0] as ModelMessage, ...messages.slice(cut)]
  }
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
  const resume = args.context.approvalResume
  if (resume) {
    return [...replayed.messages, approvalResponseMessage(resume)]
  }
  const delta = args.context.continuationDelta
  return delta
    ? [...replayed.messages, { role: "user", content: delta }]
    : replayed.messages
}

// The SDK's approval id for a parked call, read back out of the replayed
// transcript. It is generated per request and only ever exists there, and
// collectToolApprovals matches responses to requests by it — deriving it from
// the same array we are about to send is what keeps the two consistent.
function findApprovalId(
  messages: ModelMessage[],
  toolCallId: string
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.role !== "assistant" || typeof message.content === "string") {
      continue
    }
    for (const part of message.content) {
      if (
        part.type === "tool-approval-request" &&
        part.toolCallId === toolCallId
      ) {
        return part.approvalId
      }
    }
  }
  return null
}

// Resume a run parked on a policy gate (LOR-81): replay the parked run's
// transcript and answer its approval request. Nothing new is appended after
// the tool message — messages that landed meanwhile ride the ordinary
// step-boundary steering injection, which is the only order the SDK accepts.
// Returns null whenever the resume can't be assembled safely; the caller then
// builds a fresh context, which is always sound (the model simply re-decides).
export async function buildApprovalContinuation(args: {
  approvalId: string
}): Promise<Continuation | null> {
  try {
    const approval = await db
      .select({
        runId: schema.approval.runId,
        status: schema.approval.status,
        toolCallId: schema.approval.toolCallId,
        toolName: schema.approval.toolName,
        target: schema.approval.target,
      })
      .from(schema.approval)
      .where(eq(schema.approval.id, args.approvalId))
      .limit(1)
      .then((rows) => rows[0])
    if (
      !approval?.runId ||
      !approval.toolCallId ||
      !approval.toolName ||
      !approval.target
    )
      return null
    if (approval.status !== "approved" && approval.status !== "rejected") {
      return null
    }

    const parked = await db
      .select({
        state: schema.agentRun.state,
        stopReason: schema.agentRun.stopReason,
      })
      .from(schema.agentRun)
      .where(eq(schema.agentRun.id, approval.runId))
      .limit(1)
      .then((rows) => rows[0])
    // Only a run that actually parked holds an unanswered approval request.
    if (parked?.stopReason !== "awaiting_approval") return null
    if (parked.state === "working" || parked.state === "queued") return null

    const replayed = await replayChain(approval.runId)
    if (!replayed) return null
    const approvalId = findApprovalId(replayed.messages, approval.toolCallId)
    // The request part was trimmed out of the replay (very long chain) — the
    // SDK would throw InvalidToolApprovalError on the response.
    if (!approvalId) {
      logger.warn(
        { approvalId: args.approvalId, runId: approval.runId },
        "Parked approval request missing from the replayed transcript"
      )
      return null
    }

    const resume: AgentRunApprovalResume = {
      approvalId,
      approved: approval.status === "approved",
      toolName: approval.toolName,
      target: approval.target,
    }
    return {
      predecessorRunId: approval.runId,
      messages: [...replayed.messages, approvalResponseMessage(resume)],
      conversation: [],
      coveredMessageIds: [],
      deltaText: null,
      approvalResume: resume,
      lastInputTokens: replayed.lastInputTokens,
      compaction: replayed.compaction,
    }
  } catch (err) {
    logger.warn(
      { err, approvalId: args.approvalId },
      "Approval resume failed; falling back to a fresh context"
    )
    return null
  }
}

export const APPROVAL_SPEAKER = "Approval"

// request_approval parks no tool call, so its decision reaches the
// continuation as a line in the delta; nothing posts in the chat. Null for
// policy gates, which resume with the AI SDK approval response instead.
export async function approvalDecisionTurn(
  approvalId: string
): Promise<AgentRunContext["conversation"][number] | null> {
  const row = await db
    .select({
      status: schema.approval.status,
      description: schema.approval.description,
      toolCallId: schema.approval.toolCallId,
      resolverName: schema.user.name,
    })
    .from(schema.approval)
    .leftJoin(schema.user, eq(schema.user.id, schema.approval.resolvedBy))
    .where(eq(schema.approval.id, approvalId))
    .limit(1)
    .then((rows) => rows[0])
  if (!row || row.toolCallId) return null
  if (row.status !== "approved" && row.status !== "rejected") return null
  const who = row.resolverName ?? "Someone"
  return {
    authorName: APPROVAL_SPEAKER,
    content:
      row.status === "approved"
        ? `${who} approved: ${row.description}`
        : `${who} rejected: ${row.description}. Do not take this action.`,
    images: [],
    files: [],
  }
}

// Assemble a continued context: the full chain of prior runs in this scope
// (the original snapshot, then each hop's delta and steps) plus one user
// message carrying what has been said since. Returns null whenever the
// fresh-snapshot path should be used instead — no predecessor, nothing new to
// say, or missing steps.
export async function buildContinuation(args: {
  scopeKey: string
  channelId: string
  lorMessageId: string
  runId: string | undefined
  // Appended after the delta's messages (an approval decision).
  extraTurns?: AgentRunContext["conversation"]
}): Promise<Continuation | null> {
  try {
    const predecessor = await findPredecessor({
      scopeKey: args.scopeKey,
      channelId: args.channelId,
      excludeRunId: args.runId,
    })
    if (!predecessor?.context) return null
    // A parked run's transcript ends in an unanswered approval request, which
    // the provider rejects as an unpaired tool call. Only the approval resume
    // (buildApprovalContinuation) may replay it; everything else — a new
    // message while the gate is still open, or a resume that never started —
    // starts fresh.
    if (predecessor.stopReason === "awaiting_approval") return null

    const replayed = await replayChain(predecessor.id)
    if (!replayed) return null

    const since = predecessor.startedAt ?? predecessor.createdAt
    const delta = await loadDelta({
      predecessorRunId: predecessor.id,
      predecessorStartedAt: since,
      predecessorContext: predecessor.context,
      scopeKey: args.scopeKey,
      channelId: args.channelId,
      lorMessageId: args.lorMessageId,
    })
    const { omitted, coveredMessageIds } = delta
    const turns = [...delta.turns, ...(args.extraTurns ?? [])]
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

    return {
      predecessorRunId: predecessor.id,
      messages: [
        ...replayed.messages,
        { role: "user", content: deltaText } satisfies ModelMessage,
      ],
      conversation: turns,
      coveredMessageIds,
      deltaText,
      approvalResume: null,
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
