import { describe, expect, it } from "vitest"
import { scanTemplateRefs } from "./tool-templates"

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
