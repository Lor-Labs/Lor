import { describe, expect, it } from "vitest"
import { appendReasoningSegment, upsertToolCall } from "./lor"

describe("appendReasoningSegment", () => {
  it("starts a new segment for an unseen order", () => {
    const segments = appendReasoningSegment(
      [{ text: "first", at: 0, order: 0 }],
      { delta: "second", at: 12, order: 1 }
    )
    expect(segments).toEqual([
      { text: "first", at: 0, order: 0 },
      { text: "second", at: 12, order: 1 },
    ])
  })

  it("appends the delta to an existing order without touching others", () => {
    const segments = appendReasoningSegment(
      [
        { text: "first", at: 0, order: 0 },
        { text: "sec", at: 12, order: 1 },
      ],
      { delta: "ond", at: 12, order: 1 }
    )
    expect(segments).toEqual([
      { text: "first", at: 0, order: 0 },
      { text: "second", at: 12, order: 1 },
    ])
  })

  it("treats null and undefined as empty", () => {
    const payload = { delta: "hi", at: 3, order: 0 }
    expect(appendReasoningSegment(null, payload)).toEqual([
      { text: "hi", at: 3, order: 0 },
    ])
    expect(appendReasoningSegment(undefined, payload)).toEqual([
      { text: "hi", at: 3, order: 0 },
    ])
  })
})

describe("upsertToolCall", () => {
  it("appends a new toolCallId", () => {
    const calls = upsertToolCall([{ toolCallId: "a", label: "Searching" }], {
      toolCallId: "b",
      label: "Reading",
    })
    expect(calls.map((call) => call.toolCallId)).toEqual(["a", "b"])
  })

  it("replaces a matching toolCallId in place, preserving the rest", () => {
    const calls = upsertToolCall(
      [
        { toolCallId: "a", label: "Searching" },
        { toolCallId: "b", label: "Reading" },
      ],
      { toolCallId: "a", label: "Searched 3 sources" }
    )
    expect(calls).toEqual([
      { toolCallId: "a", label: "Searched 3 sources" },
      { toolCallId: "b", label: "Reading" },
    ])
  })

  it("treats null and undefined as empty", () => {
    const call = { toolCallId: "a" }
    expect(upsertToolCall(null, call)).toEqual([call])
    expect(upsertToolCall(undefined, call)).toEqual([call])
  })
})
