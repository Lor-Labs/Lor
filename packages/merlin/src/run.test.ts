import { describe, expect, it } from "vitest"
import { conversationUpdateMessageIds, mergeRunContextCoverage } from "./run"

const context = {
  conversation: [],
  brainContext: "",
  rosterText: "",
  coveredMessageIds: ["message-1"],
}

describe("conversation update coverage", () => {
  it("collects both steered and ambient message IDs without duplicates", () => {
    expect(
      conversationUpdateMessageIds({
        steered: [
          {
            messageId: "message-1",
            authorName: "Jacob",
            content: "change direction",
          },
        ],
        ambient: [
          {
            messageId: "message-2",
            authorName: "Ada",
            content: "new context",
          },
          {
            messageId: "message-1",
            authorName: "Jacob",
            content: "duplicate ID",
          },
        ],
      })
    ).toEqual(["message-1", "message-2"])
  })

  it("merges checkpoint coverage into context without mutating it", () => {
    const merged = mergeRunContextCoverage(context, [
      "message-1",
      "message-2",
      "message-2",
    ])

    expect(merged.coveredMessageIds).toEqual(["message-1", "message-2"])
    expect(context.coveredMessageIds).toEqual(["message-1"])
  })

  it("keeps the same context when a checkpoint adds no coverage", () => {
    expect(mergeRunContextCoverage(context, [])).toBe(context)
  })
})
