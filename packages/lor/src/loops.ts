import { db, eq, schema } from "@repo/db"
import { agentChannelIds } from "@repo/db/queries/agents"
import type { RealtimeLoop } from "@repo/realtime-types/events"
import { channelRoom } from "@repo/realtime-types/rooms"
import { tool } from "ai"
import { z } from "zod"
import type { AgentLoopExecutors } from "./channel-agent"
import { describeLoopSchedule, validateLoopSchedule } from "./loop-schedule"
import type { Exact, SerializedDates } from "./wire-guard"

// The single loop-row → wire-type mapping. Every loop:updated emit goes
// through this, so the event payload can't drift per call site.
type LoopRow = typeof schema.loop.$inferSelect

// Drift guard (see wire-guard.ts) — RealtimeLoop must stay the exact
// date-serialized mirror of the loop row, minus deliberate omissions.
type OffWireLoopColumns =
  // Consent audit trail — server-side concern, no card renders it.
  "highFrequencyConfirmedAt" | "highFrequencyConfirmedBy"
const _realtimeLoopMirrorsDbRow: Exact<
  Omit<SerializedDates<LoopRow>, OffWireLoopColumns>,
  RealtimeLoop
> = true
void _realtimeLoopMirrorsDbRow

// Where a loop's events go: its chat's room, and the room of the chat its
// card is in when that is another one, so the card there stays live. A Loop
// with no chat goes to the chats its agent is in: the people who can see
// them are who can see it (never the whole workspace, for an agent kept to
// private chats). `rooms` can be empty: emit to nobody then, since an emit
// to no room reaches every socket.
export async function loopEventTargets(
  row: Pick<LoopRow, "channelId" | "agentId" | "cardMessageId">
): Promise<{ rooms: string[]; cardChannelId: string | null }> {
  const channelIds = new Set<string>()
  if (row.channelId) channelIds.add(row.channelId)
  else if (row.agentId) {
    for (const id of await agentChannelIds(row.agentId)) channelIds.add(id)
  }
  const [card] = row.cardMessageId
    ? await db
        .select({ channelId: schema.message.channelId })
        .from(schema.message)
        .where(eq(schema.message.id, row.cardMessageId))
    : []
  if (card) channelIds.add(card.channelId)
  return {
    rooms: [...channelIds].map(channelRoom),
    cardChannelId: card?.channelId ?? null,
  }
}

export function toRealtimeLoop(row: LoopRow): RealtimeLoop {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    channelId: row.channelId,
    agentId: row.agentId,
    changedById: row.changedById,
    changedAt: row.changedAt ? row.changedAt.toISOString() : null,
    cardMessageId: row.cardMessageId,
    creatorId: row.creatorId,
    kind: row.kind,
    name: row.name,
    instructions: row.instructions,
    schedule: row.schedule,
    timezone: row.timezone,
    endCondition: row.endCondition,
    endAt: row.endAt ? row.endAt.toISOString() : null,
    status: row.status,
    pausedReason: row.pausedReason,
    nextRunAt: row.nextRunAt ? row.nextRunAt.toISOString() : null,
    lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
    consecutiveFailures: row.consecutiveFailures,
    completedNote: row.completedNote,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

const MAX_NAME_CHARS = 80
const MAX_INSTRUCTIONS_CHARS = 4000
const MAX_SCHEDULE_CHARS = 120
const MAX_END_CONDITION_CHARS = 500

// The worker owns card posting + the loop row insert (message fanout lives
// there); the tool validates and delegates — same executor pattern as the
// triggered disposition tools.
export type ProposeLoopExecutor = (input: {
  name: string
  instructions: string
  schedule: string
  timezone: string | null
  endCondition: string | null
  endAt: Date | null
}) => Promise<{ loopId: string }>

const proposeLoopContext = z.object({
  createLoopCard: z.custom<ProposeLoopExecutor>(),
})

// Models keep encoding "no end condition" as prose ("runs until the team\nmanually stops it") despite the schema saying null. That text then reads as
// a MET-able condition to the run-time model — one live loop got wrongly
// completed over it — so coerce the common phrasings back to null here.
// "manual(ly)" only counts next to stop/end/pause semantics — a bare \bmanual\b
// nulled legit conditions like "the manual data migration is complete".
const MANUAL_STOP_PHRASING =
  /\bmanual(ly)?\s+(stop|end|paus)\w*\b|\b(stop|end|paus)\w*\s+manually\b|\bindefinitely\b|\bno end\b|\bstops? (it|the loop|this loop)\b/i

export function normalizeEndCondition(
  endCondition: string | null
): string | null {
  if (!endCondition) return null
  return MANUAL_STOP_PHRASING.test(endCondition) ? null : endCondition
}

// Fixed-lifespan ends arrive as relative durations — the model has no clock,
// so it can't produce a correct absolute date; the server anchors it to now.
export type LoopEndAfter = {
  amount: number
  unit: "days" | "weeks" | "months"
}

// Arithmetic is done in UTC: the loop's timezone isn't pinned yet at
// proposal time, and local-calendar math would make the absolute endAt
// depend on the server's tz (±1h across a DST boundary).
export function endAfterToDate(
  endAfter: LoopEndAfter,
  from: Date = new Date()
): Date {
  const date = new Date(from)
  if (endAfter.unit === "months") {
    // Clamp to the target month's last day — raw setMonth overflows
    // (Jan 31 + 1 month → Mar 3).
    const day = date.getUTCDate()
    date.setUTCDate(1)
    date.setUTCMonth(date.getUTCMonth() + endAfter.amount)
    const lastDay = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
    ).getUTCDate()
    date.setUTCDate(Math.min(day, lastDay))
  } else {
    date.setUTCDate(
      date.getUTCDate() + endAfter.amount * (endAfter.unit === "weeks" ? 7 : 1)
    )
  }
  return date
}

// A refusal the model should read as written (the executor's other failures
// are reported as a generic error).
export class LoopProposalError extends Error {}

const SESSION_PROPOSE_DESCRIPTION =
  'Set up a scheduled loop in this channel: a recurring run of yourself that follows standing instructions on a cron schedule, each run a turn in the loop\'s own session. Use ONLY when someone asks for genuinely recurring work ("check the support queue every morning", "post a Friday digest") — never for one-off work you can just do now. This creates a DRAFT card in this conversation; nothing runs until a teammate presses Create Loop on it, so end your answer by pointing them at the card. `instructions` are the complete standing brief for every run — each run sees them and its own session, nothing else from this conversation, so include every detail it needs. `schedule` is a standard 5-field cron. `timezone`: pass an IANA timezone (e.g. America/New_York) ONLY when the conversation explicitly establishes one; otherwise pass null — the card shows the schedule in each viewer\'s local timezone and the activating teammate pins one. A loop can end one of three ways: when the ask names an outcome ("until the app ships"), put that finish line in `endCondition` and a future run will judge when it\'s met; when the ask names a duration ("for the next two weeks"), use `endAfter`; otherwise leave both null and the loop simply runs until the team stops it — don\'t describe that in words. Set at most one of the two.'

// Bound on runs a person is part of (respond() spreads it in when the
// executor is present): a trigger or a Loop must not schedule more Loops.
function proposeLoop(description: string) {
  return tool({
    description,
    inputSchema: z.object({
      name: z
        .string()
        .min(1)
        .max(MAX_NAME_CHARS)
        .describe('short label for the card, e.g. "Morning queue check"'),
      instructions: z.string().min(1).max(MAX_INSTRUCTIONS_CHARS),
      schedule: z
        .string()
        .min(1)
        .max(MAX_SCHEDULE_CHARS)
        .describe('5-field cron expression, e.g. "0 9 * * 1-5"'),
      timezone: z
        .string()
        .min(1)
        .max(64)
        .nullable()
        .describe(
          "IANA timezone, only when the conversation establishes one; null = the activating teammate's local timezone"
        ),
      endCondition: z
        .string()
        .min(1)
        .max(MAX_END_CONDITION_CHARS)
        .nullable()
        .describe(
          'a real finish-line condition, e.g. "the mobile app has shipped". Pass null for a loop that just runs until someone stops it — never restate that as text ("until manually stopped", "runs indefinitely", …); those are treated as null'
        ),
      endAfter: z
        .object({
          // Anthropic's strict tools reject integer bounds, and zod's int()
          // emits the safe-integer bounds, so it is checked when the tool runs.
          amount: z.number().describe("a whole number from 1 to 365"),
          unit: z.enum(["days", "weeks", "months"]),
        })
        .nullable()
        .describe(
          'fixed lifespan from now, e.g. {"amount": 2, "unit": "weeks"} for "run this for two weeks". Null unless the ask names a duration'
        ),
    }),
    contextSchema: proposeLoopContext,
    execute: async (
      { name, instructions, schedule, timezone, endCondition, endAfter },
      { context }
    ) => {
      if (
        endAfter &&
        (!Number.isInteger(endAfter.amount) ||
          endAfter.amount < 1 ||
          endAfter.amount > 365)
      ) {
        return {
          ok: false as const,
          error: "endAfter.amount must be a whole number from 1 to 365",
        }
      }
      // Validated at proposal so the card never carries an invalid cron;
      // a failure comes back to the model, which can fix the expression.
      // Unpinned tz validates in UTC — gap checks are tz-insensitive at the
      // 5min/1h thresholds, and activation re-validates with the real tz.
      const validation = validateLoopSchedule(schedule, timezone ?? "UTC")
      if (!validation.ok) {
        return { ok: false as const, error: validation.reason }
      }
      const condition = normalizeEndCondition(endCondition)
      // One end mode per loop — a condition AND a date muddies both the
      // prompt and the sweep's mechanical end.
      if (condition && endAfter) {
        return {
          ok: false as const,
          error:
            "pass endCondition OR endAfter, not both — pick the one the ask implies",
        }
      }
      try {
        const { loopId } = await context.createLoopCard({
          name,
          instructions,
          schedule,
          timezone,
          endCondition: condition,
          endAt: endAfter ? endAfterToDate(endAfter) : null,
        })
        return {
          ok: true as const,
          loopId,
          scheduleDescription: describeLoopSchedule(schedule, timezone),
          note: `draft created — a teammate must press Create Loop on the card to activate it${
            validation.requiresConfirmation
              ? " (sub-hourly cadence: activation will ask them to confirm the frequency)"
              : ""
          }`,
        }
      } catch (err) {
        return {
          ok: false as const,
          error:
            err instanceof LoopProposalError
              ? err.message
              : "Failed to create the loop",
        }
      }
    },
    strict: true,
  })
}

export const proposeLoopTool = {
  propose_loop: proposeLoop(SESSION_PROPOSE_DESCRIPTION),
}

const DAY_MS = 86_400_000

const endAfterSchema = z
  .object({
    // Anthropic's strict tools reject integer bounds, and zod's int()
    // emits the safe-integer bounds, so it is checked when the tool runs.
    amount: z.number().describe("a whole number from 1 to 365"),
    unit: z.enum(["days", "weeks", "months"]),
  })
  .describe(
    'fixed lifespan from now, e.g. {"amount": 2, "unit": "weeks"} for "run this for two weeks"'
  )

const endAfterIssue = (endAfter: LoopEndAfter | null | undefined) =>
  endAfter &&
  (!Number.isInteger(endAfter.amount) ||
    endAfter.amount < 1 ||
    endAfter.amount > 365)
    ? "endAfter.amount must be a whole number from 1 to 365"
    : null

// How often a schedule runs, said to the agent when it is more than hourly:
// nobody confirms the cadence any more, so the agent tells people.
function frequencyNote(schedule: string, timezone: string): string | null {
  const validation = validateLoopSchedule(schedule, timezone)
  if (!validation.ok || !validation.requiresConfirmation) return null
  const perDay = Math.max(1, Math.round(DAY_MS / validation.minGapMs))
  return `It runs up to ${perDay} times a day, each run a turn of yours that costs the team: say how often it runs when you tell people.`
}

const agentLoopContext = z.object({
  loops: z.custom<AgentLoopExecutors>(),
})

// The agent's own Loops (reference/agents-and-chats.md §9): it makes and
// changes them with no approval, and the worker leaves the trace people see.
// Always bound, so the tool set stays the same from turn to turn. A
// workspace can put them behind an approval gate (AGENT_LOOP_GATE_TOOLS).
export const agentOwnLoopTools = {
  create_loop: tool({
    description:
      'Set up a Loop of your own: a schedule that wakes you with standing instructions, on a cron. It starts running at once (the team can require approval for it), and a card for it is posted in the chat this turn is about, so people see what you set up. Use it when a person asks for genuinely recurring work ("check the support queue every morning", "post a Friday digest"), or when work you were given needs you back on a cadence until it is done ("make a launch video every Wednesday until the company account has 100 followers"): then put the finish line in `endCondition`, so a later run ends it with complete_loop. Never for one-off work you can do now, and never for one return visit (wake_up brings you back once). `instructions` are the complete standing brief for every run: write them so they stand on their own, with every detail a run needs. `schedule` is a standard 5-field cron. `timezone` is the IANA timezone its times are in (e.g. America/New_York): the one the person named, or one you know is theirs. When the schedule depends on the time of day and you do not know their timezone, ask them first, then remember the answer; for your own cadence, UTC is fine. `chat` is the chat it reports in, by name or id, one you are in. Pass null when the work is not about one chat (it looks across your chats, works in your tools, or keeps your memory up to date): each run then posts wherever something needs saying, or nowhere. A Loop can end one of three ways: when the work names an outcome ("until the app ships"), put that finish line in `endCondition` and a later run judges when it is met; when it names a duration ("for the next two weeks"), use `endAfter`; otherwise leave both null and it runs until someone stops it. Set at most one of the two. When a person asked, tell them what you set up and how often it runs; when nobody asked, say so in the chat it matters to.',
    inputSchema: z.object({
      name: z
        .string()
        .min(1)
        .max(MAX_NAME_CHARS)
        .describe('short label for the card, e.g. "Morning queue check"'),
      instructions: z.string().min(1).max(MAX_INSTRUCTIONS_CHARS),
      schedule: z
        .string()
        .min(1)
        .max(MAX_SCHEDULE_CHARS)
        .describe('5-field cron expression, e.g. "0 9 * * 1-5"'),
      timezone: z
        .string()
        .min(1)
        .max(64)
        .describe("IANA timezone the schedule is in, e.g. Europe/London"),
      chat: z
        .string()
        .min(1)
        .max(120)
        .nullable()
        .describe(
          "the chat it reports in, by name or id, one you are in; null when the work is not about one chat"
        ),
      endCondition: z
        .string()
        .min(1)
        .max(MAX_END_CONDITION_CHARS)
        .nullable()
        .describe(
          'a real finish-line condition, e.g. "the mobile app has shipped". Null for a Loop that runs until someone stops it: never restate that as text'
        ),
      endAfter: endAfterSchema
        .nullable()
        .describe("null unless the ask names a duration"),
    }),
    contextSchema: agentLoopContext,
    execute: async (
      { name, instructions, schedule, timezone, chat, endCondition, endAfter },
      { context }
    ) => {
      const amountIssue = endAfterIssue(endAfter)
      if (amountIssue) return { ok: false as const, error: amountIssue }
      const validation = validateLoopSchedule(schedule, timezone)
      if (!validation.ok) {
        return { ok: false as const, error: validation.reason }
      }
      const condition = normalizeEndCondition(endCondition)
      if (condition && endAfter) {
        return {
          ok: false as const,
          error: "pass endCondition OR endAfter, not both",
        }
      }
      const made = await context.loops.create({
        name,
        instructions,
        schedule,
        timezone,
        chat,
        endCondition: condition,
        endAt: endAfter ? endAfterToDate(endAfter) : null,
      })
      if (!made.ok) return made
      return {
        ...made,
        scheduleDescription: describeLoopSchedule(schedule, timezone),
        ...(frequencyNote(schedule, timezone)
          ? { frequency: frequencyNote(schedule, timezone) }
          : {}),
      }
    },
    strict: true,
  }),
  update_loop: tool({
    description:
      "Change one of your own Loops: its name, instructions, schedule, timezone, the chat it reports in, when it ends, or whether it runs. It takes effect at once (the team can require approval for it), and a line in the Loop's chat says what you changed. Pass only what changes. Use it when a person asks for the change, or when a run shows the Loop needs it: its instructions are out of date, or the schedule no longer fits. `running: false` pauses it and `running: true` resumes it. `chat: null` takes it out of its chat, so its runs post wherever something needs saying. `endCondition: null` (or `endAfter: null`) removes its end. To end one for good, use complete_loop when it has an end condition; otherwise a person deletes it.",
    inputSchema: z.object({
      loopId: z
        .string()
        .uuid()
        .describe(
          'the Loop\'s id, from "Open right now" or the line that woke you'
        ),
      name: z.string().min(1).max(MAX_NAME_CHARS).optional(),
      instructions: z.string().min(1).max(MAX_INSTRUCTIONS_CHARS).optional(),
      schedule: z
        .string()
        .min(1)
        .max(MAX_SCHEDULE_CHARS)
        .optional()
        .describe("5-field cron expression"),
      timezone: z.string().min(1).max(64).optional().describe("IANA timezone"),
      chat: z
        .string()
        .min(1)
        .max(120)
        .nullable()
        .optional()
        .describe("a chat you are in, by name or id; null for no chat"),
      endCondition: z
        .string()
        .min(1)
        .max(MAX_END_CONDITION_CHARS)
        .nullable()
        .optional(),
      endAfter: endAfterSchema.nullable().optional(),
      running: z.boolean().optional(),
    }),
    contextSchema: agentLoopContext,
    execute: async ({ endAfter, endCondition, ...input }, { context }) => {
      const amountIssue = endAfterIssue(endAfter)
      if (amountIssue) return { ok: false as const, error: amountIssue }
      const condition =
        endCondition === undefined
          ? undefined
          : normalizeEndCondition(endCondition)
      if (condition && endAfter) {
        return {
          ok: false as const,
          error: "pass endCondition OR endAfter, not both",
        }
      }
      return context.loops.update({
        ...input,
        ...(condition !== undefined ? { endCondition: condition } : {}),
        ...(endAfter !== undefined
          ? { endAt: endAfter ? endAfterToDate(endAfter) : null }
          : {}),
      })
    },
  }),
}
