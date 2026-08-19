import { describe, expect, it } from "vitest"
import { groupEmbedFields, isEmbedFieldInline } from "./embed-field-layout"

describe("isEmbedFieldInline", () => {
  it("honors explicit Discord and Slack layout flags", () => {
    expect(isEmbedFieldInline({ value: "api", inline: true })).toBe(true)
    expect(isEmbedFieldInline({ value: "api", inline: false })).toBe(false)
  })

  it("recovers compact legacy fields as inline", () => {
    expect(isEmbedFieldInline({ value: "production" })).toBe(true)
    expect(
      isEmbedFieldInline({ value: "aedb41b5-4c56-4fa0-a640-ab07e27bbdf8" })
    ).toBe(true)
  })

  it("keeps legacy code and multiline fields full width", () => {
    expect(isEmbedFieldInline({ value: "```trace```" })).toBe(false)
    expect(isEmbedFieldInline({ value: "line one\nline two" })).toBe(false)
    expect(isEmbedFieldInline({ value: "x".repeat(81) })).toBe(false)
  })

  it("sizes inline rows by their actual field count", () => {
    const fields = [
      { value: "service", inline: true },
      { value: "environment", inline: true },
      { value: "level", inline: true },
      { value: "stack", inline: false },
      { value: "request id", inline: true },
    ]

    expect(groupEmbedFields(fields)).toEqual([
      fields.slice(0, 3),
      fields.slice(3, 4),
      fields.slice(4, 5),
    ])
  })
})
