import { describe, expect, it } from "vitest"
import {
  attioNotificationEmbed,
  githubNotificationEmbed,
  linearNotificationEmbed,
} from "@/lib/connector-notification-embeds"

describe("connector notification embeds", () => {
  it("builds a branded GitHub pull request card", () => {
    expect(
      githubNotificationEmbed({
        event: "Pull request opened",
        title: "Keep lifecycle timing deterministic",
        url: "https://github.com/lor-town/townhall/pull/292",
        repository: "lor-town/townhall",
        reference: "292",
        body: "Moves timing ownership to the lifecycle boundary.",
        actor: {
          name: "eroub",
          url: "https://github.com/eroub",
          avatarUrl: "https://avatars.githubusercontent.com/u/42?v=4",
        },
      })
    ).toEqual({
      type: "rich",
      url: "https://github.com/lor-town/townhall/pull/292",
      eventLabel: "Pull request opened",
      author: {
        name: "eroub",
        url: "https://github.com/eroub",
        iconUrl: "https://avatars.githubusercontent.com/u/42?v=4",
      },
      title: "lor-town/townhall#292 · Keep lifecycle timing deterministic",
      description: "Moves timing ownership to the lifecycle boundary.",
      siteName: "GitHub",
      color: "#24292f",
    })
  })

  it("builds a branded Linear issue card without optional metadata", () => {
    expect(
      linearNotificationEmbed({
        event: "Issue created",
        title: "Policies should show the assigned policy ID",
        identifier: "CARE-1432",
      })
    ).toEqual({
      type: "rich",
      eventLabel: "Issue created",
      title: "CARE-1432 · Policies should show the assigned policy ID",
      siteName: "Linear",
      color: "#5e6ad2",
    })
  })

  it("builds an informative Attio call recording card", () => {
    expect(
      attioNotificationEmbed({
        event: "Call recording ready",
        title: "EIG x CC | sync",
        url: "https://app.attio.com/acme/meetings/recording",
        body: "Jacob: We agreed to ship the onboarding flow next week.",
        fields: [{ name: "Duration", value: "39 min", inline: true }],
      })
    ).toEqual({
      type: "rich",
      url: "https://app.attio.com/acme/meetings/recording",
      eventLabel: "Call recording ready",
      title: "EIG x CC | sync",
      description: "Jacob: We agreed to ship the onboarding flow next week.",
      fields: [{ name: "Duration", value: "39 min", inline: true }],
      siteName: "Attio",
      color: "#d01e48",
    })
  })

  it("clips long Attio content previews", () => {
    const embed = attioNotificationEmbed({
      event: "Note created",
      title: "Account plan",
      body: "x".repeat(1_401),
    })

    expect(embed.description).toHaveLength(1_401)
    expect(embed.description?.endsWith("…")).toBe(true)
  })
})
