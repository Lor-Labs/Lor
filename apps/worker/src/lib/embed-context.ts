import type { Embed } from "@repo/db/schema"

// Webhook cards (Better Stack alerts, GitHub activity, Discord/Slack-style
// embeds) carry their text in embeds, not content, so Lor reads them as
// text. Link unfurls and meeting cards are left out: the message names the
// link, and meetingThreadContext reads recordings.
export function isCardEmbed(embed: Embed) {
  return embed.type === "rich" && !embed.meeting
}

export function cardEmbedsText(embeds: Embed[] | null): string {
  const cards = (embeds ?? [])
    .filter(isCardEmbed)
    .map((embed) =>
      [
        embed.eventLabel,
        embed.author?.name,
        embed.title,
        embed.description,
        ...(embed.fields ?? []).map((field) => `${field.name}: ${field.value}`),
        embed.footer,
        embed.url,
      ]
        .filter((line) => line?.trim())
        .join("\n")
    )
  return cards.length > 0 ? `\n\n${cards.join("\n\n")}` : ""
}
