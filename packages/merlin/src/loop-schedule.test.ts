import {
  daysToDow,
  dowToDays,
  formatLoopSchedule,
  parseLoopSchedule,
} from "@repo/realtime-types/loops"
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

  it("describes multi-day weekly lists with short names", () => {
    expect(describeLoopSchedule("0 9 * * 1,4,6", TZ)).toBe(
      `Every Mon, Thu & Sat at 9:00 AM (${TZ})`
    )
    expect(describeLoopSchedule("30 17 * * 2,5", TZ)).toBe(
      `Every Tue & Fri at 5:30 PM (${TZ})`
    )
  })

  it("describes hourly shapes in plain english", () => {
    expect(describeLoopSchedule("0 * * * *", TZ)).toBe(`Every hour (${TZ})`)
    expect(describeLoopSchedule("30 * * * *", TZ)).toBe(
      `Every hour at :30 (${TZ})`
    )
    expect(describeLoopSchedule("0 */2 * * *", TZ)).toBe(
      `Every 2 hours (${TZ})`
    )
    expect(describeLoopSchedule("15 */6 * * *", TZ)).toBe(
      `Every 6 hours at :15 (${TZ})`
    )
    expect(describeLoopSchedule("0 * * * 1-5", TZ)).toBe(
      `Every hour on weekdays (${TZ})`
    )
  })

  it("falls back to a labeled cron for exotic shapes", () => {
    expect(describeLoopSchedule("5 4 */2 1 0", TZ)).toBe(
      `Custom schedule "5 4 */2 1 0" (${TZ})`
    )
  })

  it("omits the timezone suffix for unpinned drafts", () => {
    expect(describeLoopSchedule("0 9 * * 1-5", null)).toBe(
      "Every weekday at 9:00 AM"
    )
  })
})

describe("parseLoopSchedule / formatLoopSchedule", () => {
  it("round-trips the editable shapes", () => {
    const shapes = [
      "30 * * * *",
      "0 9 * * *",
      "0 12 * * 1",
      "30 17 * * 1-5",
      "0 10 * * 0,6",
      "0 9 * * 1,4,6",
      "15 8 1 * *",
    ]
    for (const schedule of shapes) {
      const shape = parseLoopSchedule(schedule)
      expect(shape.kind).not.toBe("custom")
      expect(formatLoopSchedule(shape)).toBe(schedule)
    }
  })

  it("parses fields into the structured shape", () => {
    expect(parseLoopSchedule("30 17 * * 1-5")).toEqual({
      kind: "weekly",
      dow: "1-5",
      hour: 17,
      minute: 30,
    })
    expect(parseLoopSchedule("0 * * * *")).toEqual({
      kind: "hourly",
      minute: 0,
    })
  })

  it("treats anything it can't round-trip as custom", () => {
    for (const schedule of ["*/5 * * * *", "0 9 * 2 *", "0 9 2 * 1"]) {
      expect(parseLoopSchedule(schedule)).toEqual({ kind: "custom", schedule })
    }
  })
})

describe("dowToDays / daysToDow", () => {
  it("expands presets and lists to sorted day numbers", () => {
    expect(dowToDays("1-5")).toEqual([1, 2, 3, 4, 5])
    expect(dowToDays("6,0")).toEqual([0, 6])
    expect(dowToDays("4,1,4")).toEqual([1, 4])
  })

  it("collapses the weekday set back to the 1-5 preset", () => {
    expect(daysToDow([5, 1, 2, 4, 3])).toBe("1-5")
    expect(daysToDow([6, 1, 4])).toBe("1,4,6")
    expect(daysToDow([0, 6])).toBe("0,6")
  })
})
