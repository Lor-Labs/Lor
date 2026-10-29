import { describe, expect, it } from "vitest"
import { connectorMessageEmbed } from "@/lib/connector-message-embed"

describe("connectorMessageEmbed", () => {
  it("turns a legacy GitHub post into a structured activity card", () => {
    expect(
      connectorMessageEmbed(
        "github",
        "**PR merged** [acme/api#292](https://github.com/acme/api/pull/292) Add retries to webhook delivery — by octocat",
        "GitHub"
      )
    ).toEqual({
      type: "rich",
      url: "https://github.com/acme/api/pull/292",
      author: {
        name: "octocat",
        url: "https://github.com/octocat",
        iconUrl: "https://github.com/octocat.png?size=40",
      },
      eventLabel: "Pull request merged",
      title: "acme/api#292 · Add retries to webhook delivery",
      siteName: "GitHub",
      color: "#24292f",
    })
  })

  it("turns a legacy Linear post into a structured issue card", () => {
    expect(
      connectorMessageEmbed(
        "linear",
        "**Issue created** [ENG-1431 Login fails on new devices](https://linear.app/acme/issue/ENG-1431)",
        "Linear"
      )
    ).toEqual({
      type: "rich",
      url: "https://linear.app/acme/issue/ENG-1431",
      eventLabel: "Issue created",
      title: "ENG-1431 · Login fails on new devices",
      siteName: "Linear",
      color: "#5e6ad2",
    })
  })
})
