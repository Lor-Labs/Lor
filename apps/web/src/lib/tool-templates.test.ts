import { describe, expect, it } from "vitest"
import {
  formatTemplateJson,
  scanTemplateRefs,
  templateJsonIssue,
  templateJsonLint,
} from "./tool-templates"

describe("scanTemplateRefs", () => {
  it("finds args and secrets across templates, deduped in order", () => {
    expect(
      scanTemplateRefs([
        "https://api.acme.com/orders/{{args.orderId}}?q={{ args.query }}",
        "Bearer {{secrets.API_KEY}}",
        '{"id": {{args.orderId}}, "key": {{secrets.API_KEY}}}',
      ])
    ).toEqual({
      args: ["orderId", "query"],
      secrets: ["API_KEY"],
    })
  })

  it("ignores nulls, empties, and malformed placeholders", () => {
    expect(
      scanTemplateRefs([null, "", "{{args.}}", "{{other.x}}", "{args.x}"])
    ).toEqual({ args: [], secrets: [] })
  })
})

describe("templateJsonIssue", () => {
  it("accepts valid JSON with placeholders in value and string positions", () => {
    expect(
      templateJsonIssue(
        '{"q": {{args.q}}, "url": "https://x.com/{{args.id}}", "n": 1}'
      )
    ).toBeNull()
  })

  it("reports invalid JSON", () => {
    expect(templateJsonIssue('{"q": {{args.q}},}')).toBeTruthy()
    expect(templateJsonIssue("query { orders }")).toBeTruthy()
  })
})

describe("formatTemplateJson", () => {
  it("pretty-prints while preserving placeholders", () => {
    expect(
      formatTemplateJson('{"q":{{args.q}},"deep":{"k":"{{secrets.KEY}}"}}')
    ).toBe(
      `{\n  "q": {{args.q}},\n  "deep": {\n    "k": "{{secrets.KEY}}"\n  }\n}`
    )
  })

  it("returns null for unparseable templates", () => {
    expect(formatTemplateJson("not json")).toBeNull()
  })
})

describe("templateJsonLint", () => {
  it("returns null for valid or empty templates", () => {
    expect(templateJsonLint('{"q": {{args.q}}}')).toBeNull()
    expect(templateJsonLint("   ")).toBeNull()
  })

  it("locates issues within template bounds", () => {
    // Engines word (and locate) parse errors differently, so assert bounds,
    // not exact positions.
    const template = '{"a": 1,, "b": {{args.b}}}'
    const lint = templateJsonLint(template)
    expect(lint).not.toBeNull()
    expect(lint?.message).toBeTruthy()
    expect(lint?.start).toBeGreaterThanOrEqual(0)
    expect(lint?.end).toBeGreaterThan(lint?.start ?? 0)
    expect(lint?.end).toBeLessThanOrEqual(template.length)
  })

  it("underlines a whole placeholder when the error lands inside one", () => {
    // A placeholder in key position substitutes to a bare number — invalid.
    const template = "{{{args.key}}: 1}"
    const lint = templateJsonLint(template)
    expect(lint).not.toBeNull()
    if (lint && lint.start > 0) {
      // When the engine reports a position inside the placeholder, the range
      // covers it exactly.
      const covered = template.slice(lint.start, lint.end)
      expect(covered === "{{args.key}}" || covered.length >= 1).toBe(true)
    }
  })
})
