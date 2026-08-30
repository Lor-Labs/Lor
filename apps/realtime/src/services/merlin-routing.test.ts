import { MERLIN_USER_ID } from "@repo/db/constants"
import { describe, expect, it } from "vitest"
import { isReplyToMerlin } from "./merlin-routing"

function referencedMessage(authorId: string) {
  return {
    author: {
      id: authorId,
      name: "Author",
      username: null,
      displayUsername: null,
      image: null,
    },
  }
}

describe("isReplyToMerlin", () => {
  it("recognizes a reply to a Merlin-authored message", () => {
    expect(isReplyToMerlin(referencedMessage(MERLIN_USER_ID))).toBe(true)
  })

  it("does not treat a reply to another user as addressing Merlin", () => {
    expect(
      isReplyToMerlin(referencedMessage("00000000-0000-4000-8000-000000000002"))
    ).toBe(false)
  })

  it("does not trigger without a validated referenced message", () => {
    expect(isReplyToMerlin(null)).toBe(false)
    expect(isReplyToMerlin(undefined)).toBe(false)
  })
})
