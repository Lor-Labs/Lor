import type { schema } from "@repo/db"
import type { RealtimeLoop } from "@repo/realtime-types/events"
import { tool } from "ai"
import { z } from "zod"
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

export function toRealtimeLoop(row: LoopRow): RealtimeLoop {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    channelId: row.channelId,
    cardMessageId: row.cardMessageId,
    creatorId: row.creatorId,
    name: row.name,
    instructions: row.instructions,
    schedule: row.schedule,
    timezone: row.timezone,
    endCondition: row.endCondition,
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
}) => Promise<{ loopId: string }>

const proposeLoopContext = z.object({
  createLoopCard: z.custom<ProposeLoopExecutor>(),
})

// Models keep encoding "no end condition" as prose ("runs until the team\nmanually stops it") despite the schema saying null. That text then reads as
// a MET-able condition to the run-time model — one live loop got wrongly
// completed over it — so coerce the common phrasings back to null here.
const MANUAL_STOP_PHRASING =
  /\bmanual(ly)?\b|\bindefinitely\b|\bno end\b|\bstops? (it|the loop|this loop)\b/i

export function normalizeEndCondition(
  endCondition: string | null
): string | null {
  if (!endCondition) return null
  return MANUAL_STOP_PHRASING.test(endCondition) ? null : endCondition
}

// Bound only on conversational runs (respond() spreads it in when the
// executor is present); triggered/loop runs never see it — a loop must not
// schedule more loops.
export const proposeLoopTool = {
  propose_loop: tool({
    description:
      'Set up a scheduled loop in this channel: a recurring, unattended run of yourself that follows standing instructions on a cron schedule until an end condition is met or the team stops it. Use ONLY when someone asks for genuinely recurring work ("check the support queue every morning", "post a Friday digest") — never for one-off work you can just do now. This creates a DRAFT card in the channel; nothing runs until a teammate presses Create Loop on it, so end your answer by pointing them at the card. `instructions` are the complete standing brief for every run — each run sees them and nothing else from this conversation, so include every detail it needs. `schedule` is a standard 5-field cron. `timezone`: pass an IANA timezone (e.g. America/New_York) ONLY when the conversation explicitly establishes one; otherwise pass null — the card shows the schedule in each viewer\'s local timezone and the activating teammate pins one. `endCondition` is plain language for when the loop should permanently stop (pass null for a loop that runs until manually stopped).',
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
    }),
    contextSchema: proposeLoopContext,
    execute: async (
      { name, instructions, schedule, timezone, endCondition },
      { context }
    ) => {
      // Validated at proposal so the card never carries an invalid cron;
      // a failure comes back to the model, which can fix the expression.
      // Unpinned tz validates in UTC — gap checks are tz-insensitive at the
      // 5min/1h thresholds, and activation re-validates with the real tz.
      const validation = validateLoopSchedule(schedule, timezone ?? "UTC")
      if (!validation.ok) {
        return { ok: false as const, error: validation.reason }
      }
      try {
        const { loopId } = await context.createLoopCard({
          name,
          instructions,
          schedule,
          timezone,
          endCondition: normalizeEndCondition(endCondition),
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
      } catch {
        return { ok: false as const, error: "Failed to create the loop" }
      }
    },
    strict: true,
  }),
}
