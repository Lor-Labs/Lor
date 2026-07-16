import { describe, expect, it } from "vitest"
import { toStoredMessageMarkdown } from "./message-markdown"

describe("message Markdown storage", () => {
  it("converts native mention links to the shared stored token contract", () => {
    const userId = "4f89d7d0-2eb5-4f53-8b06-6dfe9b9f6682"
    const markdown = `Hello [@Avery](lor://mention/${userId}) and [@everyone](lor://mention/everyone)`

    expect(toStoredMessageMarkdown(markdown)).toBe(
      `Hello <@${userId}> and @everyone`
    )
  })

  it("leaves ordinary Markdown links unchanged", () => {
    const markdown = "Read [the guide](https://example.com/guide)."

    expect(toStoredMessageMarkdown(markdown)).toBe(markdown)
  })
})
