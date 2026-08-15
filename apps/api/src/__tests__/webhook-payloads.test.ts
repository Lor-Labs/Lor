import { describe, expect, it } from "vitest"
import {
  dialectHint,
  discordWebhookBodySchema,
  mrkdwnToMarkdown,
  renderDiscordWebhookBody,
  renderSlackWebhookBody,
  slackWebhookBodySchema,
} from "@/lib/webhook-payloads"

describe("mrkdwnToMarkdown", () => {
  it("converts labeled links", () => {
    expect(mrkdwnToMarkdown("see <https://example.com|the docs> now")).toBe(
      "see [the docs](https://example.com) now"
    )
  })

  it("unwraps bare links", () => {
    expect(mrkdwnToMarkdown("go to <https://example.com>")).toBe(
      "go to https://example.com"
    )
  })

  it("converts single-asterisk bold and tilde strikethrough", () => {
    expect(mrkdwnToMarkdown("this is *bold* and ~gone~")).toBe(
      "this is **bold** and ~~gone~~"
    )
  })

  it("leaves double-asterisk sequences alone", () => {
    expect(mrkdwnToMarkdown("already **bold** here")).toBe(
      "already **bold** here"
    )
  })

  it("converts broadcast mentions to plain text", () => {
    expect(mrkdwnToMarkdown("<!here> heads up")).toBe("@here heads up")
  })
})

describe("discord dialect", () => {
  it("rejects a payload with neither content nor embeds", () => {
    expect(discordWebhookBodySchema.safeParse({ tts: true }).success).toBe(
      false
    )
  })

  it("strips unknown fields like avatar_url", () => {
    const parsed = discordWebhookBodySchema.safeParse({
      content: "hi",
      avatar_url: "https://evil.example/x.png",
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect("avatar_url" in parsed.data).toBe(false)
    }
  })

  it("renders an embed-only payload as a blockquote card", () => {
    const parsed = discordWebhookBodySchema.parse({
      content: null,
      embeds: [
        {
          title: "📞 New Meeting Recording Summary",
          description: "Discussed Q3 pipeline.\n\nNext steps: follow up.",
          timestamp: "2026-08-14T12:00:00.000Z",
          footer: { text: "Attio Call Recording" },
        },
      ],
    })
    const rendered = renderDiscordWebhookBody(parsed)
    expect(rendered).toContain("> **📞 New Meeting Recording Summary**")
    expect(rendered).toContain("> Discussed Q3 pipeline.")
    expect(rendered).toContain(
      "> *Attio Call Recording · 2026-08-14T12:00:00.000Z*"
    )
  })

  it("links the title when the embed has a url and renders fields", () => {
    const rendered = renderDiscordWebhookBody(
      discordWebhookBodySchema.parse({
        content: "heads up",
        embeds: [
          {
            title: "Deploy",
            url: "https://example.com/deploy/1",
            fields: [{ name: "Status", value: "green" }],
          },
        ],
      })
    )
    expect(rendered.startsWith("heads up")).toBe(true)
    expect(rendered).toContain("> **[Deploy](https://example.com/deploy/1)**")
    expect(rendered).toContain("> **Status**\n> green")
  })

  it("clips oversized payloads", () => {
    const rendered = renderDiscordWebhookBody(
      discordWebhookBodySchema.parse({
        embeds: Array.from({ length: 10 }, () => ({
          description: "x".repeat(4000),
        })),
      })
    )
    expect(rendered.length).toBeLessThanOrEqual(8001)
    expect(rendered.endsWith("…")).toBe(true)
  })
})

describe("slack dialect", () => {
  it("rejects an empty payload", () => {
    expect(slackWebhookBodySchema.safeParse({}).success).toBe(false)
  })

  it("renders plain text with mrkdwn conversion", () => {
    const rendered = renderSlackWebhookBody(
      slackWebhookBodySchema.parse({
        text: "Danny left a *1 star* review: <https://example.com|read it>",
      })
    )
    expect(rendered).toBe(
      "Danny left a **1 star** review: [read it](https://example.com)"
    )
  })

  it("prefers blocks over the text fallback", () => {
    const rendered = renderSlackWebhookBody(
      slackWebhookBodySchema.parse({
        text: "fallback notification text",
        blocks: [
          { type: "header", text: { type: "plain_text", text: "Review" } },
          {
            type: "section",
            text: { type: "mrkdwn", text: "*Average Rating*\n1.0" },
          },
          { type: "divider" },
          {
            type: "context",
            elements: [{ type: "mrkdwn", text: "via Overlook Hotel" }],
          },
        ],
      })
    )
    expect(rendered).not.toContain("fallback notification text")
    expect(rendered).toContain("**Review**")
    expect(rendered).toContain("**Average Rating**\n1.0")
    expect(rendered).toContain("---")
    expect(rendered).toContain("*via Overlook Hotel*")
  })

  it("drops interactive blocks rather than half-rendering", () => {
    const rendered = renderSlackWebhookBody(
      slackWebhookBodySchema.parse({
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: "pick one" } },
          { type: "actions", elements: [{ type: "button" }] },
        ],
      })
    )
    expect(rendered).toBe("pick one")
  })

  it("renders legacy attachments as blockquote cards", () => {
    const rendered = renderSlackWebhookBody(
      slackWebhookBodySchema.parse({
        attachments: [
          {
            title: "Build failed",
            title_link: "https://ci.example.com/1",
            text: "step: *test*",
            footer: "CI",
          },
        ],
      })
    )
    expect(rendered).toContain("> **[Build failed](https://ci.example.com/1)**")
    expect(rendered).toContain("> step: **test**")
    expect(rendered).toContain("> *CI*")
  })

  it("falls back to attachment fallback text when nothing else renders", () => {
    const rendered = renderSlackWebhookBody(
      slackWebhookBodySchema.parse({
        attachments: [{ fallback: "plain fallback" }],
      })
    )
    expect(rendered).toBe("> plain fallback")
  })
})

describe("dialectHint", () => {
  it("spots Discord-shaped payloads", () => {
    expect(dialectHint({ embeds: [] })).toBe("discord")
  })

  it("spots Slack-shaped payloads", () => {
    expect(dialectHint({ blocks: [] })).toBe("slack")
    expect(dialectHint({ attachments: [] })).toBe("slack")
  })

  it("returns null for native or junk payloads", () => {
    expect(dialectHint({ content: "hi" })).toBe(null)
    expect(dialectHint("nope")).toBe(null)
  })
})
