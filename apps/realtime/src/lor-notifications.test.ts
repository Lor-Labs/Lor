import { shouldNotifyForLorThread } from "@repo/realtime-types"
import { describe, expect, it } from "vitest"

describe("shouldNotifyForLorThread", () => {
  it("does not change notifications outside Lor threads", () => {
    expect(
      shouldNotifyForLorThread("subscribed_only", {
        threadRootId: null,
        isLorThread: false,
        isSubscribedToThread: false,
      })
    ).toBe(true)
  })

  it("keeps the default all-activity behavior", () => {
    expect(
      shouldNotifyForLorThread("all_activity", {
        threadRootId: "00000000-0000-4000-8000-000000000002",
        isLorThread: true,
        isSubscribedToThread: false,
      })
    ).toBe(true)
  })

  it("requires participation when subscribed-only is selected", () => {
    const context = {
      threadRootId: "00000000-0000-4000-8000-000000000002",
      isLorThread: true,
      isSubscribedToThread: false,
    }

    expect(shouldNotifyForLorThread("subscribed_only", context)).toBe(false)
    expect(
      shouldNotifyForLorThread("subscribed_only", {
        ...context,
        isSubscribedToThread: true,
      })
    ).toBe(true)
  })
})
