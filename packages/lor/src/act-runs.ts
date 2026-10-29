import {
  APP_USER_ID,
  and,
  db,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  isUniqueViolation,
  lt,
  ne,
  or,
  type SQL,
  schema,
  sql,
} from "@repo/db"
import { chatFeedMessage } from "@repo/db/queries/agent-sessions"
import { workspaceBetaAccess } from "@repo/db/queries/beta-access"
import { env } from "@repo/env/server"
import { logger } from "./logger"

// Act rate shaping: the in-flight guard, the rolling run caps, and the
// coalescing window that turns a burst of deliveries into ONE agent run.
// Lives here (not in apps/api) because both the API — which arms windows on
// ingest — and the worker — which flushes them minutes later — need it.
// See reference/automation-primitives.md §5.

// A batched Act payload is rebuilt from stored deliveries, so each delivery
// keeps a capped copy of what Act would have consumed.
export const ACT_DELIVERY_PAYLOAD_MAX = 8 * 1024
// Total user-turn size handed to a run (same ceiling as the immediate path).
const ACT_PAYLOAD_MAX = 48 * 1024
// How many deliveries a batch quotes verbatim (oldest first, newest last).
const BATCH_SAMPLES = 6
const BATCH_SAMPLE_MAX = 6 * 1024
// A window whose flush never arrived (worker restart, lost job) must not wedge
// Act forever — after this multiple of the window, a new delivery re-arms it.
const STALE_WINDOW_FACTOR = 3
const STALE_WINDOW_SLACK_MS = 60_000
// Nothing is ever dropped for being blocked, but a window that has been
// waiting this long is worth a warning — it means a run isn't terminating or a
// cap has been pinned for an unusually long time.
const SLOW_WINDOW_WARN_MS = 60 * 60 * 1000
// Re-arm bounds while a batch waits on an in-flight run or a spent cap.
const MIN_REARM_MS = 30_000
const MAX_REARM_MS = 15 * 60 * 1000
// Act queues deliveries, it doesn't archive them: a delivery older than this
// is history rather than an incident, and stops being batch material.
const ACT_QUEUE_MAX_AGE_MS = 24 * 60 * 60 * 1000
// The handoff chain a run is briefed with: recent enough to be true, short
// enough that stale conclusions can't dominate the prompt.
const BRIEFING_RUNS = 3
const BRIEFING_MAX_AGE_MS = 24 * 60 * 60 * 1000
const BRIEFING_NOTE_MAX = 1200
// Channel chat since the last run — the "already on it, don't file another
// PR" signal. Webhook deliveries are excluded, so this is people talking.
const BRIEFING_MESSAGES = 10
const BRIEFING_MESSAGE_MAX = 300
// A run's closing note, stored for its successor.
export const HANDOFF_NOTE_MAX = 2000

export type ActLimits = { hourlyRunCap: number; dailyRunCap: number }

// Blocked is never "dropped": a cap verdict carries when to look again.
export type ActGuard =
  | { verdict: "ok" }
  | { verdict: "in_flight" }
  | { verdict: "hourly_cap" | "daily_cap"; retryAfterMs: number }

function clampRearm(ms: number): number {
  return Math.min(Math.max(ms, MIN_REARM_MS), MAX_REARM_MS)
}

// One active Act run per trigger, then the rolling caps. The in-flight check
// is advisory (the partial unique index on agent_run.triggerId is the real
// arbiter) — it exists so a burst doesn't spend cap slots on runs that would
// be rejected anyway.
export async function actGuard(
  triggerId: string,
  limits: ActLimits
): Promise<ActGuard> {
  const row = await db
    .select({
      active: sql<number>`count(*) filter (where ${schema.agentRun.state} in ('queued','working','finalizing'))::int`,
      hourly: sql<number>`count(*) filter (where ${schema.agentRun.createdAt} >= now() - interval '1 hour')::int`,
      daily: sql<number>`count(*) filter (where ${schema.agentRun.createdAt} >= now() - interval '24 hours')::int`,
      // When the rolling windows free up a slot.
      oldestHourly: sql<Date | null>`min(${schema.agentRun.createdAt}) filter (where ${schema.agentRun.createdAt} >= now() - interval '1 hour')`,
      oldestDaily: sql<Date | null>`min(${schema.agentRun.createdAt}) filter (where ${schema.agentRun.createdAt} >= now() - interval '24 hours')`,
    })
    .from(schema.agentRun)
    .where(
      and(
        eq(schema.agentRun.triggerId, triggerId),
        sql`(${schema.agentRun.createdAt} >= now() - interval '24 hours' or ${schema.agentRun.state} in ('queued','working','finalizing'))`
      )
    )
    .then((rows) => rows[0])
  if (!row) return { verdict: "ok" }
  if (row.active > 0) return { verdict: "in_flight" }
  if (row.hourly >= limits.hourlyRunCap) {
    const freesAt = row.oldestHourly
      ? new Date(row.oldestHourly).getTime() + 60 * 60 * 1000
      : Date.now()
    return {
      verdict: "hourly_cap",
      retryAfterMs: clampRearm(freesAt - Date.now()),
    }
  }
  if (row.daily >= limits.dailyRunCap) {
    const freesAt = row.oldestDaily
      ? new Date(row.oldestDaily).getTime() + 24 * 60 * 60 * 1000
      : Date.now()
    return {
      verdict: "daily_cap",
      retryAfterMs: clampRearm(freesAt - Date.now()),
    }
  }
  return { verdict: "ok" }
}

// The partial unique index on active triggerId makes "one Act run per trigger
// at a time" a database invariant, so a delivery storm can't stack runs no
// matter how the guards race. scopeKey holds the triggerId until the worker
// moves the run into its own session.
export async function createActRun(input: {
  triggerId: string
  workspaceId: string
  channelId: string
}): Promise<{ id: string } | "in_flight" | null> {
  if ((await workspaceBetaAccess(input.workspaceId)).state !== "active")
    return null
  try {
    return await db
      .insert(schema.agentRun)
      .values({
        workspaceId: input.workspaceId,
        channelId: input.channelId,
        scopeKey: input.triggerId,
        triggerId: input.triggerId,
        budgetWallMs: env.AGENT_RUN_MAX_WALL_MS,
        budgetCredits: env.AGENT_RUN_MAX_CREDITS,
      })
      .returning({ id: schema.agentRun.id })
      .then((rows) => rows[0] ?? null)
  } catch (err) {
    if (isUniqueViolation(err)) return "in_flight"
    throw err
  }
}

// Open the coalescing window if it isn't already open. Returns the window's
// start when this caller won the arm (and therefore owes a delayed flush),
// null when a window was already running and this delivery just joins it.
export async function openActWindow(
  triggerId: string,
  windowSeconds: number
): Promise<Date | null> {
  const staleBefore = new Date(
    Date.now() -
      (windowSeconds * 1000 * STALE_WINDOW_FACTOR + STALE_WINDOW_SLACK_MS)
  )
  const now = new Date()
  return await db
    .update(schema.connectorTrigger)
    .set({
      actWindowOpenedAt: now,
      actFlushDueAt: new Date(now.getTime() + windowSeconds * 1000),
    })
    .where(
      and(
        eq(schema.connectorTrigger.id, triggerId),
        or(
          isNull(schema.connectorTrigger.actWindowOpenedAt),
          lt(schema.connectorTrigger.actWindowOpenedAt, staleBefore)
        )
      )
    )
    .returning({ openedAt: schema.connectorTrigger.actWindowOpenedAt })
    .then((rows) => rows[0]?.openedAt ?? null)
}

// A blocked batch pushes its next check forward. Recording it is what lets the
// recovery sweep distinguish "the flush job was lost" from "this batch is
// legitimately waiting on a run or a cap" — without it, the sweep piles up a
// new flush chain every few minutes against a long cap block.
async function setActFlushDue(
  triggerId: string,
  delayMs: number
): Promise<void> {
  await db
    .update(schema.connectorTrigger)
    .set({ actFlushDueAt: new Date(Date.now() + delayMs) })
    .where(eq(schema.connectorTrigger.id, triggerId))
    .catch(() => {})
}

// Exported for the enqueue-failure path: a window with no flush job behind it
// must not stay open, or the next delivery can't re-arm it.
export async function closeActWindow(triggerId: string): Promise<void> {
  await db
    .update(schema.connectorTrigger)
    .set({ actWindowOpenedAt: null, actFlushDueAt: null })
    .where(eq(schema.connectorTrigger.id, triggerId))
    .catch(() => {})
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

// The batch's user turn. One delivery reads exactly like the immediate path;
// many read as a single situation with quoted samples, so Lor investigates
// the incident instead of one arbitrary event from it. Exported for tests.
export function buildActBatchPayload(input: {
  label: string
  count: number
  // True when a leading-edge run already looked at the burst's first event —
  // this batch is the follow-up, and saying so keeps Lor from redoing it.
  followUp?: boolean
  samples: { index: number; createdAt: Date; text: string }[]
}): string {
  if (input.count === 1 && input.samples[0] && !input.followUp) {
    return clip(input.samples[0].text, ACT_PAYLOAD_MAX)
  }
  const first = input.samples[0]
  const last = input.samples.at(-1)
  const span =
    first && last
      ? ` between ${first.createdAt.toISOString()} and ${last.createdAt.toISOString()}`
      : ""
  const plural = input.count === 1 ? "delivery" : "deliveries"
  const lead = input.followUp
    ? `${input.count} further ${plural} from "${input.label}"${span}, after an earlier run already handled the first one. Treat this as a follow-up on the same situation: check whether anything changed or escalated rather than repeating that work.`
    : `${input.count} deliveries from "${input.label}"${span}, batched into one run. Treat them as one situation, not ${input.count} separate ones — the samples below are the oldest and newest of the batch.`
  const parts = [lead]
  for (const sample of input.samples) {
    parts.push(
      `--- delivery ${sample.index} of ${input.count} · ${sample.createdAt.toISOString()} ---\n${clip(sample.text, BATCH_SAMPLE_MAX)}`
    )
  }
  const omitted = input.count - input.samples.length
  if (omitted > 0) {
    parts.push(`(${omitted} deliveries between those samples are omitted.)`)
  }
  return clip(parts.join("\n\n"), ACT_PAYLOAD_MAX)
}

// Windows whose flush job never arrived (worker restart mid-delay, Redis
// hiccup). Nothing is dropped for being blocked, so the only way queued
// deliveries can rot is a missing flush — this finds them.
// Windows whose flush job never arrived (worker restart mid-delay, Redis
// hiccup). Nothing is dropped for being blocked, so the only way queued
// deliveries can rot is a missing flush. Claims what it returns — pushing the
// due time forward — so concurrent sweeps (or a slow re-armed job) can't stack
// duplicate flush chains on the same trigger.
export async function claimOverdueActWindows(
  graceMs: number
): Promise<string[]> {
  const cutoff = new Date(Date.now() - graceMs)
  const rows = await db
    .update(schema.connectorTrigger)
    .set({ actFlushDueAt: new Date(Date.now() + graceMs) })
    .where(
      and(
        isNotNull(schema.connectorTrigger.actWindowOpenedAt),
        or(
          // Windows opened before this column existed.
          isNull(schema.connectorTrigger.actFlushDueAt),
          lt(schema.connectorTrigger.actFlushDueAt, cutoff)
        )
      )
    )
    .returning({ triggerId: schema.connectorTrigger.id })
  return rows.map((row) => row.triggerId)
}

// A triggered run that died without finishing leaves its deliveries claimed —
// i.e. silently dropped. Hand them back to the queue so the next flush covers
// them; the dead run stays in agent_run, so its side effects (and any note) are
// still in the successor's briefing.
export async function releaseActRunDeliveries(runId: string): Promise<number> {
  const released = await db
    .update(schema.triggerDelivery)
    .set({ runId: null })
    .where(eq(schema.triggerDelivery.runId, runId))
    .returning({ id: schema.triggerDelivery.id })
  return released.length
}

export type PreparedActRun = { runId: string; payload: string; label: string }

export type BriefingRun = {
  createdAt: Date
  state: string
  stopReason: string | null
  note: string | null
  // Side-effecting tools this run executed — the account that survives a run
  // dying before it could write a note.
  effects: string[]
}

export type BriefingMessage = { authorName: string | null; content: string }

// The prompt block itself. Pure so the framing — which is what actually steers
// a successor run — is testable without a database. `header` lets the loop
// chain rewrite the title line; the body framing is shared.
export function formatActBriefing(input: {
  priorRuns: BriefingRun[]
  totalRuns: number
  messagesSinceLastRun: BriefingMessage[]
  header?: string
}): string | null {
  const lines: string[] = []
  if (input.priorRuns.length > 0) {
    lines.push(
      input.header ??
        `## Earlier runs on this trigger (newest first; ${input.totalRuns} in the last 24h)`,
      "These are your predecessors' own words, not verified facts. If one says it",
      "already filed, created, or fixed something, check the current state with your",
      "tools before doing it again.",
      ""
    )
    for (const run of input.priorRuns) {
      const outcome =
        run.state === "complete"
          ? "completed"
          : `${run.state}${run.stopReason ? ` (${run.stopReason})` : ""}`
      const effects =
        run.effects.length > 0
          ? // "recorded actions" rather than "side effects": the underlying
            // allowlist marks tools whose replay must not repeat, which is not
            // the same as "mutated something" and would mislead the successor.
            ` — recorded actions: ${[...run.effects].sort().join(", ")}`
          : ""
      lines.push(`- ${run.createdAt.toISOString()} — ${outcome}${effects}`)
      lines.push(
        run.note?.trim()
          ? `  note: ${clip(run.note.trim(), BRIEFING_NOTE_MAX)}`
          : "  note: (none left)"
      )
    }
  }
  const messages = input.messagesSinceLastRun.filter(
    (m) => m.content.trim().length > 0
  )
  if (messages.length > 0) {
    lines.push(
      "",
      "## Channel chat since the last run",
      "Webhook deliveries are omitted — this is what people said in the channel.",
      "A human saying it's handled takes precedence over your predecessors' plans.",
      ""
    )
    for (const m of messages) {
      lines.push(
        `- ${m.authorName ?? "Someone"}: ${clip(m.content.trim(), BRIEFING_MESSAGE_MAX)}`
      )
    }
  }
  return lines.length > 0 ? lines.join("\n") : null
}

// The handoff chain: what previous runs on this trigger concluded and did, plus
// what people said in channel chat since. Runs on a trigger are serialized, so
// this is a real chain rather than interleaved siblings — which is what makes
// "a prior run already filed a PR" knowable at all. Each event gets its own
// session, so this is the only way one run learns of the last.
// See reference/automation-primitives.md §5.
export async function actRunBriefing(input: {
  triggerId: string
  channelId: string
  // The run being briefed (excluded from its own history).
  runId: string
}): Promise<string | null> {
  // Triggers fire often; only the last day of chain history is relevant.
  const since = new Date(Date.now() - BRIEFING_MAX_AGE_MS)
  return composeRunChainBriefing({
    // and() with defined args never returns undefined — fail closed anyway
    // rather than letting an empty filter scan every tenant's runs.
    history:
      and(
        eq(schema.agentRun.triggerId, input.triggerId),
        ne(schema.agentRun.id, input.runId),
        gte(schema.agentRun.createdAt, since)
      ) ?? sql`false`,
    channelId: input.channelId,
  })
}

// Shared chain-briefing composer: prior runs matching `history` (their
// handoff notes + recorded actions) and channel activity since the newest
// one. Act and loop chains differ only in the history filter and header.
export async function composeRunChainBriefing(input: {
  history: SQL<unknown>
  channelId: string
  headerFor?: (totalRuns: number) => string
}): Promise<string | null> {
  const [recent, totalRuns] = await Promise.all([
    db
      .select({
        id: schema.agentRun.id,
        createdAt: schema.agentRun.createdAt,
        state: schema.agentRun.state,
        stopReason: schema.agentRun.stopReason,
        note: schema.agentRun.handoffNote,
      })
      .from(schema.agentRun)
      .where(input.history)
      .orderBy(desc(schema.agentRun.createdAt))
      .limit(BRIEFING_RUNS),
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(schema.agentRun)
      .where(input.history)
      .then((rows) => rows[0]?.value ?? 0),
  ])

  const effectsByRun = new Map<string, string[]>()
  if (recent.length > 0) {
    const rows = await db
      .selectDistinct({
        runId: schema.agentRunToolResult.runId,
        toolName: schema.agentRunToolResult.toolName,
      })
      .from(schema.agentRunToolResult)
      .where(
        inArray(
          schema.agentRunToolResult.runId,
          recent.map((r) => r.id)
        )
      )
    for (const row of rows) {
      const list = effectsByRun.get(row.runId) ?? []
      list.push(row.toolName)
      effectsByRun.set(row.runId, list)
    }
  }

  // People talking in the channel outranks anything a prior run assumed.
  // Channel chat only: sessions, this trigger's included, are not read here.
  const lastRunAt = recent[0]?.createdAt
  const messages = lastRunAt
    ? await db
        .select({
          content: schema.message.content,
          authorName: schema.user.name,
        })
        .from(schema.message)
        .leftJoin(schema.user, eq(schema.message.authorId, schema.user.id))
        .where(
          and(
            eq(schema.message.channelId, input.channelId),
            chatFeedMessage(),
            gte(schema.message.createdAt, lastRunAt),
            // Webhook/bot deliveries are the firehose this trigger already sees.
            ne(schema.message.authorId, APP_USER_ID)
          )
        )
        .orderBy(desc(schema.message.createdAt))
        .limit(BRIEFING_MESSAGES)
    : []

  return formatActBriefing({
    priorRuns: recent.map((run) => ({
      createdAt: run.createdAt,
      state: run.state,
      stopReason: run.stopReason,
      note: run.note,
      effects: effectsByRun.get(run.id) ?? [],
    })),
    totalRuns,
    // Oldest first reads as a conversation.
    messagesSinceLastRun: messages.reverse().map((m) => ({
      authorName: m.authorName,
      content: m.content ?? "",
    })),
    header: input.headerFor?.(totalRuns),
  })
}

// A run's closing text, kept as the brief for whatever runs next.
export async function saveHandoffNote(
  runId: string,
  note: string
): Promise<void> {
  const trimmed = note.trim()
  if (!trimmed) return
  await db
    .update(schema.agentRun)
    .set({ handoffNote: clip(trimmed, HANDOFF_NOTE_MAX) })
    .where(eq(schema.agentRun.id, runId))
    .catch(() => {})
}

export type ActFlushResult =
  // The batch is ready; the caller executes this run. `rearmDelayMs` is set
  // when deliveries landed after the batch was claimed — they need their own
  // flush, since closing the window is what lets a new one arm.
  | { kind: "ready"; run: PreparedActRun; rearmDelayMs?: number }
  // A run is still going: re-arm the flush, keep the window open, let the
  // batch keep growing.
  | { kind: "retry"; delayMs: number }
  | { kind: "skip"; reason: string }

// Close an open window and turn everything it collected into one run. Called
// by the worker when the delayed flush job fires. `notifyWorkspaceActivity`
// (host-supplied, best-effort) fires after the queued run row commits and
// after an unwind delete, so sidebar activity tracks both.
export async function flushActWindow(
  triggerId: string,
  notifyWorkspaceActivity?: (workspaceId: string) => void
): Promise<ActFlushResult> {
  const trigger = await db
    .select({
      enabled: schema.connectorTrigger.enabled,
      actInstructions: schema.connectorTrigger.actInstructions,
      windowSeconds: schema.connectorTrigger.actWindowSeconds,
      openedAt: schema.connectorTrigger.actWindowOpenedAt,
      hourlyRunCap: schema.connectorTrigger.hourlyRunCap,
      dailyRunCap: schema.connectorTrigger.dailyRunCap,
      sessionMode: schema.connectorTrigger.actSessionMode,
      channelId: schema.channel.id,
      workspaceId: schema.channel.workspaceId,
    })
    .from(schema.connectorTrigger)
    .innerJoin(
      schema.channel,
      eq(schema.connectorTrigger.channelId, schema.channel.id)
    )
    .where(eq(schema.connectorTrigger.id, triggerId))
    .then((rows) => rows[0])
  if (!trigger) return { kind: "skip", reason: "trigger_gone" }
  // Kill switch, re-read at flush time.
  if (!trigger.enabled || trigger.actInstructions === null) {
    await closeActWindow(triggerId)
    return { kind: "skip", reason: "act_off" }
  }
  const openedAt = trigger.openedAt
  if (!openedAt) return { kind: "skip", reason: "window_closed" }
  // Triggers only ever target workspace text channels; a DM-shaped row here
  // would mean corrupt data, not a case to guess at.
  const workspaceId = trigger.workspaceId
  if (!workspaceId) {
    await closeActWindow(triggerId)
    return { kind: "skip", reason: "channel_without_workspace" }
  }

  // The queue is "every delivery Act hasn't handled yet", not a slice of the
  // window's clock: a delivery that arrived while a run was going must end up
  // in the next batch even if several windows have opened and closed since.
  // actPayload is only written when Act is on, so deliveries logged with Act
  // off are never dragged in.
  const since = new Date(Date.now() - ACT_QUEUE_MAX_AGE_MS)
  const unclaimed = and(
    eq(schema.triggerDelivery.triggerId, triggerId),
    isNull(schema.triggerDelivery.runId),
    isNotNull(schema.triggerDelivery.actPayload),
    isNull(schema.triggerDelivery.actDroppedAt),
    gte(schema.triggerDelivery.createdAt, since)
  )
  const pending = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(schema.triggerDelivery)
    .where(unclaimed)
    .then((rows) => rows[0]?.value ?? 0)
  if (pending === 0) {
    await closeActWindow(triggerId)
    return { kind: "skip", reason: "nothing_pending" }
  }

  // per_subject: a run takes the oldest subject's deliveries, since they all
  // go into that subject's session. Other subjects re-arm as stragglers.
  let batch = unclaimed
  if (trigger.sessionMode === "per_subject") {
    const [oldest] = await db
      .select({ subject: schema.triggerDelivery.subject })
      .from(schema.triggerDelivery)
      .where(unclaimed)
      .orderBy(schema.triggerDelivery.createdAt)
      .limit(1)
    batch = and(
      unclaimed,
      oldest?.subject
        ? eq(schema.triggerDelivery.subject, oldest.subject)
        : isNull(schema.triggerDelivery.subject)
    )
  }

  // Leading-edge runs claim the delivery that opened the window, so an already
  // claimed delivery since then means this batch is a follow-up.
  const alreadyHandled = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(schema.triggerDelivery)
    .where(
      and(
        eq(schema.triggerDelivery.triggerId, triggerId),
        gte(schema.triggerDelivery.createdAt, openedAt),
        isNotNull(schema.triggerDelivery.runId)
      )
    )
    .then((rows) => rows[0]?.value ?? 0)

  const windowAgeMs = Date.now() - openedAt.getTime()
  if (windowAgeMs > SLOW_WINDOW_WARN_MS) {
    logger.warn(
      { triggerId, pending, windowAgeMs },
      "Act batch has been waiting over an hour"
    )
  }
  const guard = await actGuard(triggerId, trigger)
  // Blocked, never dropped: keep the window open (deliveries keep
  // accumulating) and look again when the blocker should have cleared.
  if (guard.verdict === "in_flight") {
    const delayMs = clampRearm(trigger.windowSeconds * 1000)
    await setActFlushDue(triggerId, delayMs)
    return { kind: "retry", delayMs }
  }
  if (guard.verdict !== "ok") {
    logger.info(
      { triggerId, verdict: guard.verdict, pending },
      "Act batch waiting on a cap"
    )
    await setActFlushDue(triggerId, guard.retryAfterMs)
    return { kind: "retry", delayMs: guard.retryAfterMs }
  }

  const run = await createActRun({
    triggerId,
    workspaceId,
    channelId: trigger.channelId,
  })
  if (run === "in_flight") {
    const delayMs = clampRearm(trigger.windowSeconds * 1000)
    await setActFlushDue(triggerId, delayMs)
    return { kind: "retry", delayMs }
  }
  if (!run) {
    await closeActWindow(triggerId)
    return { kind: "skip", reason: "run_insert_failed" }
  }
  notifyWorkspaceActivity?.(workspaceId)

  // Claiming is what makes the batch exact: these rows now point at the run,
  // and anything arriving after this arms the next window.
  const claimed = await db
    .update(schema.triggerDelivery)
    .set({ runId: run.id })
    .where(batch)
    .returning({ id: schema.triggerDelivery.id })
  if (claimed.length === 0) {
    await db
      .delete(schema.agentRun)
      .where(eq(schema.agentRun.id, run.id))
      .catch(() => {})
    notifyWorkspaceActivity?.(workspaceId)
    await closeActWindow(triggerId)
    return { kind: "skip", reason: "nothing_claimed" }
  }

  const count = claimed.length
  const half = Math.floor(BATCH_SAMPLES / 2)
  const columns = {
    createdAt: schema.triggerDelivery.createdAt,
    actPayload: schema.triggerDelivery.actPayload,
    actLabel: schema.triggerDelivery.actLabel,
  }
  const mine = eq(schema.triggerDelivery.runId, run.id)
  const small = count <= BATCH_SAMPLES
  const oldest = await db
    .select(columns)
    .from(schema.triggerDelivery)
    .where(mine)
    .orderBy(schema.triggerDelivery.createdAt)
    .limit(small ? BATCH_SAMPLES : half)
  // Newest-first from the database; quoted oldest-first in the payload.
  const newestFirst = small
    ? []
    : await db
        .select(columns)
        .from(schema.triggerDelivery)
        .where(mine)
        .orderBy(desc(schema.triggerDelivery.createdAt))
        .limit(half)
  const numbered = [
    ...oldest.map((row, i) => ({ row, index: i + 1 })),
    ...[...newestFirst]
      .reverse()
      .map((row, i) => ({ row, index: count - half + i + 1 })),
  ]
  const samples = numbered.flatMap(({ row, index }) =>
    row.actPayload
      ? [{ index, createdAt: row.createdAt, text: row.actPayload }]
      : []
  )
  if (samples.length === 0) {
    // Every delivery predates actPayload storage (or Act was just switched on
    // mid-window) — nothing to hand the model.
    await db
      .delete(schema.agentRun)
      .where(eq(schema.agentRun.id, run.id))
      .catch(() => {})
    notifyWorkspaceActivity?.(workspaceId)
    await closeActWindow(triggerId)
    return { kind: "skip", reason: "no_payloads" }
  }
  const label =
    newestFirst[0]?.actLabel ?? oldest.at(-1)?.actLabel ?? "Automation"

  await closeActWindow(triggerId)
  // A delivery that arrived between the claim and the close saw an open window,
  // so it never armed a flush of its own — and it isn't in this batch either.
  // Re-arm for it rather than leaving it stranded until the next delivery.
  const stragglers = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(schema.triggerDelivery)
    .where(unclaimed)
    .then((rows) => rows[0]?.value ?? 0)
    .catch(() => 0)
  let rearmDelayMs: number | undefined
  if (stragglers > 0) {
    const reopened = await openActWindow(triggerId, trigger.windowSeconds)
    if (reopened) {
      rearmDelayMs = clampRearm(trigger.windowSeconds * 1000)
      logger.info(
        { triggerId, stragglers },
        "Act deliveries arrived mid-flush; re-armed"
      )
    }
  }
  logger.info(
    { triggerId, runId: run.id, deliveries: count },
    "Act batch flushed"
  )
  return {
    kind: "ready",
    rearmDelayMs,
    run: {
      runId: run.id,
      payload: buildActBatchPayload({
        label,
        count,
        followUp: alreadyHandled > 0,
        samples,
      }),
      label,
    },
  }
}
