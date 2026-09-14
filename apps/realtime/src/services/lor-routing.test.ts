import { LOR_USER_ID } from "@repo/db/constants"
import { describe, expect, it } from "vitest"
import { isReplyToLor } from "./lor-routing"

function referencedMessage(authorId: string) {
  return {
    author: {
      id: authorId,
      name: "Author",
      image: null,
    },
  }
}

describe("isReplyToLor", () => {
  it("recognizes a reply to a Lor-authored message", () => {
    expect(isReplyToLor(referencedMessage(LOR_USER_ID))).toBe(true)
  })

  it("does not treat a reply to another user as addressing Lor", () => {
    expect(
      isReplyToLor(referencedMessage("00000000-0000-4000-8000-000000000002"))
    ).toBe(false)
  })

  it("does not trigger without a validated referenced message", () => {
    expect(isReplyToLor(null)).toBe(false)
    expect(isReplyToLor(undefined)).toBe(false)
  })
})
