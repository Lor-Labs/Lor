import { describe, expect, it } from "vitest"
import { isBillableTool, usageDebitKey } from "./policy"

describe("billing policy", () => {
  it("charges the main response", () => {
    expect(isBillableTool("lor.respond")).toBe(true)
    expect(isBillableTool("lor.embed")).toBe(false)
  })

  it("keeps the existing response key", () => {
    expect(usageDebitKey({ messageId: "message-1", tool: "lor.respond" })).toBe(
      "message-1:lor.respond"
    )
  })

  it("does not create debit keys for free tools or unscoped usage", () => {
    expect(
      usageDebitKey({ messageId: "message-1", tool: "lor.embed" })
    ).toBeNull()
    expect(usageDebitKey({ tool: "lor.respond" })).toBeNull()
  })
})
