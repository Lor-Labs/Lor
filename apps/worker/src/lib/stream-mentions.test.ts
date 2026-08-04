import type { RealtimeMessageMention } from "@repo/realtime-types"
import { describe, expect, it } from "vitest"
import { updateStreamMentionState } from "@/lib/stream-mentions"

const jacob: RealtimeMessageMention = {
  id: "71b458e8-169f-4d3b-a9ad-f371f5917f4a",
  name: "Jacob Owens",
  username: "jacob",
  displayUsername: "jacob",
  image: null,
  avatarColor: "rose",
}

const avery: RealtimeMessageMention = {
  id: "18495657-4a0e-4cbd-a52a-917ea2934f42",
  name: "Avery Lin",
  username: "avery",
  displayUsername: null,
  image: null,
  avatarColor: "blue",
}

describe("updateStreamMentionState", () => {
  it("resolves a mention as soon as its token is complete across deltas", () => {
    const partial = updateStreamMentionState({
      content: "",
      delta: `Received, <@${jacob.id.slice(0, 20)}`,
      roster: [jacob, avery],
    })
    expect(partial.mentions).toEqual([])

    const complete = updateStreamMentionState({
      content: partial.content,
      delta: `${jacob.id.slice(20)}> — logged and clear.`,
      roster: [jacob, avery],
    })
    expect(complete.mentions).toEqual([jacob])
  })

  it("clears resolved mentions when streamed content is replaced", () => {
    const withMention = updateStreamMentionState({
      content: "",
      delta: `Hello <@${avery.id}>`,
      roster: [jacob, avery],
    })
    expect(withMention.mentions).toEqual([avery])

    const replacement = updateStreamMentionState({
      content: withMention.content,
      delta: "I couldn't complete that response.",
      replace: true,
      roster: [jacob, avery],
    })
    expect(replacement.mentions).toEqual([])
  })

  it("does not resolve valid-looking IDs outside the workspace roster", () => {
    const result = updateStreamMentionState({
      content: "",
      delta: "Hello <@5483792e-22c7-43dd-a53e-4609d1b05d67>",
      roster: [jacob, avery],
    })
    expect(result.mentions).toEqual([])
  })
})
