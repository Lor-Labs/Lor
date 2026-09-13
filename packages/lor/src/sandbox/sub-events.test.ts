import { describe, expect, it, vi } from "vitest"
import { subagentToolEvents } from "./sub-events"

describe("subagentToolEvents", () => {
  it("namespaces sub-steps under the parent and forwards status/diff", () => {
    const onToolEvent = vi.fn()
    const handlers = subagentToolEvents({
      parentToolCallId: "parent",
      onToolEvent,
    })

    handlers.onStep?.({
      toolCallId: "pi-1",
      toolName: "edit",
      label: "Edited x",
      status: "ok",
      diff: { path: "x", additions: 1, deletions: 0, patch: "+a" },
    })

    expect(onToolEvent).toHaveBeenCalledWith({
      toolCallId: "parent:sub:pi-1",
      parentToolCallId: "parent",
      toolName: "edit",
      label: "Edited x",
      status: "ok",
      diff: { path: "x", additions: 1, deletions: 0, patch: "+a" },
    })
  })

  it("throttles summary snapshots and restarts after a message reset", () => {
    const onToolEvent = vi.fn()
    const handlers = subagentToolEvents({
      parentToolCallId: "parent",
      onToolEvent,
    })

    handlers.onAssistantText?.("x".repeat(300))
    handlers.onAssistantText?.("x".repeat(400)) // grew 100 < threshold: skipped
    handlers.onAssistantText?.("") // message boundary: clears
    // Second message: longer than the last emitted snapshot but only 20 chars
    // past it — must still emit because the boundary reset the throttle.
    handlers.onAssistantText?.("y".repeat(320))

    const summaries = onToolEvent.mock.calls.map(
      ([e]) => e.detail?.summary ?? ""
    )
    expect(summaries).toEqual(["x".repeat(300), "", "y".repeat(320)])
    expect(
      onToolEvent.mock.calls.every(([e]) => e.toolCallId === "parent")
    ).toBe(true)
  })
})
