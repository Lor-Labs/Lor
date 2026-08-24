import { describe, expect, it } from "vitest"
import {
  describeLoopSchedule,
  LOOP_MIN_GAP_MS,
  LoopScheduleError,
  nextLoopRunAt,
  validateLoopSchedule,
} from "./loop-schedule"

const TZ = "America/New_York"

describe("validateLoopSchedule", () => {
  it("accepts a weekday-morning cron without confirmation", () => {
    const result = validateLoopSchedule("0 9 * * 1-5", TZ)
    expect(result).toMatchObject({ ok: true, requiresConfirmation: false })
  })

  it("requires confirmation for sub-hourly cadence", () => {
    const result = validateLoopSchedule("*/30 * * * *", TZ)
    expect(result).toMatchObject({ ok: true, requiresConfirmation: true })
    if (result.ok) expect(result.minGapMs).toBe(30 * 60_000)
  })

  it("rejects every-minute schedules", () => {
    expect(validateLoopSchedule("* * * * *", TZ).ok).toBe(false)
  })

  it("rejects uneven crons whose shortest gap is under the floor", () => {
    // "0,2 * * * *" fires at :00 and :02 — a naive two-fire check can land
    // on the 58-minute gap and miss the 2-minute one.
    expect(validateLoopSchedule("0,2 * * * *", TZ).ok).toBe(false)
  })

  it("keeps the floor and confirmation thresholds ordered", () => {
    expect(LOOP_MIN_GAP_MS).toBeLessThan(3_600_000)
  })

  it("rejects invalid cron expressions", () => {
    expect(validateLoopSchedule("not a cron", TZ).ok).toBe(false)
    expect(validateLoopSchedule("99 99 * * *", TZ).ok).toBe(false)
  })

  it("rejects unknown timezones", () => {
    const result = validateLoopSchedule("0 9 * * *", "Mars/Olympus_Mons")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain("timezone")
  })
})

describe("nextLoopRunAt", () => {
  it("computes the next fire strictly after `from` in the loop's timezone", () => {
    // 9AM America/New_York on 2026-01-15 (EST, UTC-5) = 14:00 UTC.
    const from = new Date("2026-01-15T00:00:00Z")
    const next = nextLoopRunAt("0 9 * * *", TZ, from)
    expect(next?.toISOString()).toBe("2026-01-15T14:00:00.000Z")
  })

  it("tracks DST transitions", () => {
    // 2026-03-08: EST → EDT. 9AM local moves from 14:00Z to 13:00Z.
    const beforeShift = nextLoopRunAt(
      "0 9 * * *",
      TZ,
      new Date("2026-03-07T00:00:00Z")
    )
    const afterShift = nextLoopRunAt(
      "0 9 * * *",
      TZ,
      new Date("2026-03-09T00:00:00Z")
    )
    expect(beforeShift?.toISOString()).toBe("2026-03-07T14:00:00.000Z")
    expect(afterShift?.toISOString()).toBe("2026-03-09T13:00:00.000Z")
  })

  it("throws a typed error on invalid input", () => {
    expect(() => nextLoopRunAt("not a cron", TZ)).toThrow(LoopScheduleError)
    expect(() => nextLoopRunAt("0 9 * * *", "Nope/Nowhere")).toThrow(
      LoopScheduleError
    )
  })
})

describe("describeLoopSchedule", () => {
  it("describes common shapes", () => {
    expect(describeLoopSchedule("0 9 * * 1-5", TZ)).toBe(
      `Every weekday at 9:00 AM (${TZ})`
    )
    expect(describeLoopSchedule("30 17 * * *", TZ)).toBe(
      `Every day at 5:30 PM (${TZ})`
    )
    expect(describeLoopSchedule("0 12 * * 1", TZ)).toBe(
      `Every Monday at 12:00 PM (${TZ})`
    )
    expect(describeLoopSchedule("*/15 * * * *", TZ)).toBe(
      `Every 15 minutes (${TZ})`
    )
    expect(describeLoopSchedule("0 8 1 * *", TZ)).toBe(
      `Monthly on day 1 at 8:00 AM (${TZ})`
    )
  })

  it("falls back to the raw cron for exotic shapes", () => {
    expect(describeLoopSchedule("5 4 */2 1 0", TZ)).toBe(
      `Cron "5 4 */2 1 0" (${TZ})`
    )
  })

  it("omits the timezone suffix for unpinned drafts", () => {
    expect(describeLoopSchedule("0 9 * * 1-5", null)).toBe(
      "Every weekday at 9:00 AM"
    )
  })
})
