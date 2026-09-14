import { describe, expect, it } from "vitest"
import {
  toSearchPreviewText,
  toStoredMessageMarkdown,
} from "./message-markdown"

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

  it("resolves stored mentions and removes Markdown syntax in search previews", () => {
    const userId = "4f89d7d0-2eb5-4f53-8b06-6dfe9b9f6682"

    expect(
      toSearchPreviewText(
        `<@${userId}> **created** [a ticket](https://example.com)`,
        [
          {
            id: userId,
            name: "Avery Stone",
            image: null,
          },
        ]
      )
    ).toBe("@Avery Stone created a ticket")
  })

  it("preserves literal delimiter characters in ordinary text", () => {
    expect(
      toSearchPreviewText("rename file_name, compute 2 * 3, edit ~/.config", [])
    ).toBe("rename file_name, compute 2 * 3, edit ~/.config")
  })

  it("strips only paired formatting delimiters and block markers", () => {
    expect(
      toSearchPreviewText(
        "# Title\n> quote\n- item\n*em* _solo_ __bold__ ~~gone~~ `code`",
        []
      )
    ).toBe("Title\nquote\nitem\nem solo bold gone code")
  })
})
