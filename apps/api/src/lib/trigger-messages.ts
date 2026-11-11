import { APP_USER_ID } from "@repo/db"
import type {
  ChannelEventPayload,
  TriggerRunPayload,
  TriggerSourceMessage,
} from "@repo/db/schema"
import { triggerMessageContent } from "@repo/utils/trigger-message"
import {
  discordEmbedsToMessageEmbeds,
  discordWebhookBodySchema,
  renderDiscordWebhookBody,
  renderSlackContent,
  renderSlackWebhookBody,
  slackAttachmentsToMessageEmbeds,
  slackWebhookBodySchema,
} from "@/lib/webhook-payloads"

// Older runs have no presentation snapshot. Recover webhook cards with the
// same normalizers as ingestion when their saved raw request is complete.
export function triggerMessagePayload(message: {
  id: string
  eventType: string | null
  eventPayload: ChannelEventPayload
  content: string | null
  createdAt: Date
}): ChannelEventPayload {
  if (message.eventType !== "trigger_run") return message.eventPayload
  const payload = message.eventPayload as TriggerRunPayload | null
  if (!payload || payload.sourceMessages?.length) return message.eventPayload

  const label = payload.label || "An automation"
  const source: TriggerSourceMessage = {
    id: message.id,
    content: triggerMessageContent(message.content),
    createdAt: message.createdAt.toISOString(),
    author: { id: APP_USER_ID, name: label, image: null },
    overrideName: label,
    overrideAvatarUrl: null,
    mentions: [],
    attachments: [],
    embeds: [],
  }
  const content = message.content ?? ""
  const marker = "\n\nRaw payload:\n"
  const rawStart = content.lastIndexOf(marker)
  if (content.startsWith("Event: data_received\n\n") && rawStart >= 0) {
    try {
      const raw: unknown = JSON.parse(content.slice(rawStart + marker.length))
      const saved = content.slice(0, rawStart)
      const matches = (text: string, itemText: string) =>
        saved.startsWith(`Event: data_received\n\n${text}\n\n`) &&
        saved.endsWith(itemText)
      const discord = discordWebhookBodySchema.safeParse(raw)
      const slack = slackWebhookBodySchema.safeParse(raw)
      if (
        discord.success &&
        matches(
          discord.data.content?.trim() ?? "",
          renderDiscordWebhookBody(discord.data)
        )
      ) {
        source.content = discord.data.content?.trim() ?? ""
        source.embeds = discordEmbedsToMessageEmbeds(discord.data)
      } else if (
        slack.success &&
        matches(
          renderSlackContent(slack.data),
          renderSlackWebhookBody(slack.data)
        )
      ) {
        source.content = renderSlackContent(slack.data)
        source.embeds = slackAttachmentsToMessageEmbeds(slack.data)
      } else if (
        typeof raw === "object" &&
        raw !== null &&
        "content" in raw &&
        typeof raw.content === "string" &&
        matches(raw.content.trim(), raw.content.trim())
      ) {
        source.content = raw.content.trim()
      }
    } catch {
      // Capped payloads and old batches retain the saved text.
    }
  }
  return { ...payload, sourceMessages: [source], omittedMessages: 0 }
}
