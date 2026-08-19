import { describe, expect, it } from "vitest"
import { connectorMessageEmbed } from "@/lib/connector-message-embed"

describe("connectorMessageEmbed", () => {
  it("turns a legacy GitHub post into a structured activity card", () => {
    expect(
      connectorMessageEmbed(
        "github",
        "**PR merged** [care-cycle/mobius#292](https://github.com/care-cycle/mobius/pull/292) Replace observed lifecycle boundaries — by eroub",
        "GitHub"
      )
    ).toEqual({
      type: "rich",
      url: "https://github.com/care-cycle/mobius/pull/292",
      author: {
        name: "eroub",
        url: "https://github.com/eroub",
        iconUrl: "https://github.com/eroub.png?size=40",
      },
      eventLabel: "Pull request merged",
      title: "care-cycle/mobius#292 · Replace observed lifecycle boundaries",
      siteName: "GitHub",
      color: "#24292f",
    })
  })

  it("turns a legacy Linear post into a structured issue card", () => {
    expect(
      connectorMessageEmbed(
        "linear",
        "**Issue created** [CARE-1431 Trust device login failure](https://linear.app/care/issue/CARE-1431)",
        "Linear"
      )
    ).toEqual({
      type: "rich",
      url: "https://linear.app/care/issue/CARE-1431",
      eventLabel: "Issue created",
      title: "CARE-1431 · Trust device login failure",
      siteName: "Linear",
      color: "#5e6ad2",
    })
  })
})
