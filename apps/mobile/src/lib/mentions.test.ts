import { describe, expect, it } from "vitest"
import { filterMentionCandidates, type MentionCandidate } from "./mentions"

function candidate(
  id: string,
  label: string,
  search = label
): MentionCandidate {
  return {
    id,
    userId: id,
    label,
    search: search.toLocaleLowerCase(),
    name: label,
    image: null,
    isBot: false,
    status: "online",
  }
}

describe("mention candidates", () => {
  it("filters case-insensitively across the candidate search text", () => {
    const candidates = [
      candidate("everyone", "everyone", "everyone all members"),
      candidate("user-1", "avery", "avery stone avery"),
      candidate("user-2", "lor", "lor assistant app"),
    ]

    expect(
      filterMentionCandidates(candidates, "@STO").map((item) => item.id)
    ).toEqual(["user-1"])
    expect(
      filterMentionCandidates(candidates, "app").map((item) => item.id)
    ).toEqual(["user-2"])
  })

  it("caps the unfiltered menu to a compact mobile result set", () => {
    const candidates = Array.from({ length: 12 }, (_, index) =>
      candidate(`user-${index}`, `member-${index}`)
    )

    expect(filterMentionCandidates(candidates, "")).toHaveLength(8)
  })
})
