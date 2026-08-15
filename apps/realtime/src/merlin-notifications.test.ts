import { shouldNotifyForMerlinThread } from "@repo/realtime-types"
import { describe, expect, it } from "vitest"

describe("shouldNotifyForMerlinThread", () => {
  it("does not change notifications outside Merlin threads", () => {
    expect(
      shouldNotifyForMerlinThread("subscribed_only", {
        threadRootId: null,
        isMerlinThread: false,
        isSubscribedToThread: false,
      })
    ).toBe(true)
  })

  it("keeps the default all-activity behavior", () => {
    expect(
      shouldNotifyForMerlinThread("all_activity", {
        threadRootId: "00000000-0000-4000-8000-000000000002",
        isMerlinThread: true,
        isSubscribedToThread: false,
      })
    ).toBe(true)
  })

  it("requires participation when subscribed-only is selected", () => {
    const context = {
      threadRootId: "00000000-0000-4000-8000-000000000002",
      isMerlinThread: true,
      isSubscribedToThread: false,
    }

    expect(shouldNotifyForMerlinThread("subscribed_only", context)).toBe(false)
    expect(
      shouldNotifyForMerlinThread("subscribed_only", {
        ...context,
        isSubscribedToThread: true,
      })
    ).toBe(true)
  })
})
