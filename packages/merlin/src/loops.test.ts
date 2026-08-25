import { describe, expect, it } from "vitest"
import { normalizeEndCondition } from "./loops"

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
