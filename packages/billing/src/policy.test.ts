import { describe, expect, it } from "vitest"
import { isBillableTool, usageDebitKey } from "./policy"

describe("billing policy", () => {
  it("charges the main response and each code investigation", () => {
    expect(isBillableTool("lor.respond")).toBe(true)
    expect(isBillableTool("investigate_code")).toBe(true)
    expect(isBillableTool("lor.embed")).toBe(false)
  })

  it("keeps the existing response key and distinguishes investigations", () => {
    expect(usageDebitKey({ messageId: "message-1", tool: "lor.respond" })).toBe(
      "message-1:lor.respond"
    )
    expect(
      usageDebitKey({
        billingKey: "1",
        messageId: "message-1",
        tool: "investigate_code",
      })
    ).toBe("message-1:investigate_code:1")
    expect(
      usageDebitKey({
        billingKey: "2",
        messageId: "message-1",
        tool: "investigate_code",
      })
    ).toBe("message-1:investigate_code:2")
  })

  it("does not create debit keys for free tools or unscoped usage", () => {
    expect(
      usageDebitKey({ messageId: "message-1", tool: "lor.embed" })
    ).toBeNull()
    expect(usageDebitKey({ tool: "investigate_code" })).toBeNull()
  })
})
