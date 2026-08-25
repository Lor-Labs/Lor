import { describe, expect, it } from "vitest"
import { endAfterToDate, normalizeEndCondition } from "./loops"

// The regex guards against models encoding "no end condition" as prose —
// which the run-time model then treats as a met-able condition (a live loop
// got wrongly completed over "manual stop by the team").
describe("normalizeEndCondition", () => {
  it("coerces manual-stop phrasings to null", () => {
    for (const text of [
      "A team member manually stops the loop — it should run indefinitely until then.",
      "Runs until manually stopped",
      "until someone stops it",
      "No end condition",
      "Runs indefinitely",
    ]) {
      expect(normalizeEndCondition(text)).toBeNull()
    }
  })

  it("keeps real finish-line conditions", () => {
    for (const text of [
      "the mobile app has shipped",
      "until the team hires a designer",
      "GitHub closes incident #1234",
      "the migration backlog reaches zero",
    ]) {
      expect(normalizeEndCondition(text)).toBe(text)
    }
  })

  it("passes null through", () => {
    expect(normalizeEndCondition(null)).toBeNull()
  })
})

describe("endAfterToDate", () => {
  const from = new Date("2026-08-24T12:00:00Z")

  it("adds days and weeks", () => {
    expect(
      endAfterToDate({ amount: 3, unit: "days" }, from).toISOString()
    ).toBe("2026-08-27T12:00:00.000Z")
    expect(
      endAfterToDate({ amount: 2, unit: "weeks" }, from).toISOString()
    ).toBe("2026-09-07T12:00:00.000Z")
  })

  it("adds calendar months", () => {
    expect(
      endAfterToDate({ amount: 1, unit: "months" }, from).toISOString()
    ).toBe("2026-09-24T12:00:00.000Z")
  })
})
