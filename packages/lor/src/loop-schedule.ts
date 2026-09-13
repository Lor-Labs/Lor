import { Cron } from "croner"

// Loop schedule math — the only place cron expressions are parsed. Postgres
// stores the raw expr + IANA timezone; next fires are computed here at
// activate/edit/resume/claim, never continuously. See reference/loops.md.

// Hard floor: no two fires may be closer than this.
export const LOOP_MIN_GAP_MS = 5 * 60_000
// Sub-hourly cadence needs explicit user confirmation (recurring cost).
export const LOOP_CONFIRM_GAP_MS = 3_600_000
// Uneven crons (e.g. "0,2 * * * *") hide short gaps from a two-fire check;
// sampling a window of future fires catches them.
const VALIDATION_SAMPLE_FIRES = 20

// Typed so the sweep can tell "this loop's schedule is broken" (pause it)
// from an infrastructure error (retry).
export class LoopScheduleError extends Error {}

function cronOf(schedule: string, timezone: string): Cron {
  if (!isValidTimezone(timezone)) {
    throw new LoopScheduleError(`Unknown timezone: ${timezone}`)
  }
  try {
    // No callback: croner in calculation mode — nothing is scheduled.
    return new Cron(schedule, { timezone })
  } catch (err) {
    throw new LoopScheduleError(
      err instanceof Error ? err.message : "Invalid cron expression"
    )
  }
}

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

// Next fire strictly after `from` (default now). Null when the schedule never
// fires again. Throws LoopScheduleError on an invalid expression/timezone.
export function nextLoopRunAt(
  schedule: string,
  timezone: string,
  from?: Date
): Date | null {
  return cronOf(schedule, timezone).nextRun(from ?? new Date())
}

export type LoopScheduleValidation =
  | { ok: true; minGapMs: number; requiresConfirmation: boolean }
  | { ok: false; reason: string }

export function validateLoopSchedule(
  schedule: string,
  timezone: string
): LoopScheduleValidation {
  let fires: Date[]
  try {
    fires = cronOf(schedule, timezone).nextRuns(VALIDATION_SAMPLE_FIRES)
  } catch (err) {
    return {
      ok: false,
      reason:
        err instanceof LoopScheduleError
          ? err.message
          : "Invalid cron expression",
    }
  }

  if (fires.length < 2) {
    return {
      ok: false,
      reason: "Schedule must fire at least twice in the future",
    }
  }

  let minGapMs = Number.POSITIVE_INFINITY
  for (let i = 1; i < fires.length; i++) {
    const prev = fires[i - 1]
    const cur = fires[i]
    if (!prev || !cur) continue
    const gap = cur.getTime() - prev.getTime()
    if (gap < minGapMs) minGapMs = gap
  }

  if (minGapMs < LOOP_MIN_GAP_MS) {
    return {
      ok: false,
      reason: "Schedule fires more often than every 5 minutes",
    }
  }

  return {
    ok: true,
    minGapMs,
    requiresConfirmation: minGapMs < LOOP_CONFIRM_GAP_MS,
  }
}

// Human-readable schedule strings live in @repo/realtime-types (dependency-
// free, web imports them too); re-exported here so server call sites keep
// one import for all schedule helpers.
export { describeLoopSchedule } from "@repo/realtime-types/loops"
