import { describe, expect, it } from "vitest"
import type { ChannelSearchResult } from "./api-types"
import { mergeChannelSearchResults } from "./channel-search"

function result(id: string, content = id): ChannelSearchResult {
  return {
    id,
    content,
    createdAt: "2026-07-16T12:00:00.000Z",
    channelId: "00000000-0000-4000-8000-000000000001",
    channelName: "general",
    author: {
      id: "00000000-0000-4000-8000-000000000002",
      name: "Jacob",
      username: "jacob",
      displayUsername: "Jacob",
      image: null,
    },
    mentions: [],
  }
}

describe("channel search result merging", () => {
  it("keeps page order and removes results repeated across page boundaries", () => {
    const merged = mergeChannelSearchResults(
      [result("newest"), result("boundary", "preferred")],
      [result("boundary", "stale"), result("oldest")]
    )

    expect(merged.map((item) => item.id)).toEqual([
      "newest",
      "boundary",
      "oldest",
    ])
    expect(merged[1]?.content).toBe("preferred")
  })

  it("returns a clean first page when the current collection is empty", () => {
    expect(
      mergeChannelSearchResults([], [result("first"), result("second")]).map(
        (item) => item.id
      )
    ).toEqual(["first", "second"])
  })
})
