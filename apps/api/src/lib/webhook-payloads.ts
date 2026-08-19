import { z } from "@hono/zod-openapi"
import type { Embed } from "@repo/db/schema"

// Inbound webhook payload dialects. The base execute URL speaks Lor's native
// shape ({ content, username? }, markdown); `.../discord` speaks Discord's
// execute-webhook shape and `.../slack` speaks Slack incoming webhooks —
// dialect by URL, never payload sniffing (the same pattern Discord's own
// /slack compatibility route uses). Both normalize to markdown here; the
// renderers are pure so the phase-3 POST effect can reuse them.
// See reference/automation-primitives.md §3.
//
// Identity note: `avatar_url` is deliberately absent from these schemas (zod
// strips unknown keys) — the message avatar always comes from the webhook's
// stored, bucket-restricted config.

// Keep one long delivery from flooding a channel (10 Discord embeds can carry
// ~40k chars of description alone).
const MAX_CONTENT = 8000

function clip(text: string): string {
  return text.length > MAX_CONTENT ? `${text.slice(0, MAX_CONTENT)}…` : text
}

function blockquote(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")
}

// Sender URLs land in markdown links — require http(s) so a payload can't
// smuggle javascript:/data: schemes into rendered messages.
const HTTP_URL_MAX = 2048
function isHttpUrl(value: string): boolean {
  if (value.length > HTTP_URL_MAX) return false
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:"
  } catch {
    return false
  }
}
const httpUrlSchema = z
  .string()
  .max(HTTP_URL_MAX)
  .refine(isHttpUrl, { message: "Must be an http(s) URL" })
// The Slack dialect is lenient by contract — a bad URL drops the link rather
// than failing the delivery.
const lenientHttpUrlSchema = z
  .string()
  .optional()
  .transform((value) => (value && isHttpUrl(value) ? value : undefined))

// --- Embed colors --------------------------------------------------------

// Discord: decimal RGB int. Slack: "#rrggbb" or the good/warning/danger
// aliases (classic attachment palette). Both normalize to #rrggbb so the
// clients' accent strip can respect the sender's choice.
const SLACK_COLOR_ALIASES: Record<string, string> = {
  good: "#2eb886",
  warning: "#daa038",
  danger: "#a30200",
}

function discordColorToHex(
  color: number | null | undefined
): string | undefined {
  if (typeof color !== "number" || !Number.isInteger(color)) return undefined
  if (color < 0 || color > 0xffffff) return undefined
  return `#${color.toString(16).padStart(6, "0")}`
}

function slackColorToHex(color: string | undefined): string | undefined {
  if (!color) return undefined
  const alias = SLACK_COLOR_ALIASES[color.toLowerCase()]
  if (alias) return alias
  const match = /^#?([0-9a-f]{6})$/i.exec(color.trim())
  return match?.[1] ? `#${match[1].toLowerCase()}` : undefined
}

// --- Discord dialect ---------------------------------------------------------

const discordEmbedSchema = z.object({
  title: z.string().max(256).optional(),
  description: z.string().max(4096).optional(),
  url: httpUrlSchema.optional(),
  timestamp: z.string().max(64).optional(),
  color: z.number().int().min(0).max(0xffffff).nullish(),
  author: z
    .object({
      name: z.string().max(256),
      url: httpUrlSchema.optional(),
      icon_url: httpUrlSchema.optional(),
    })
    .optional(),
  footer: z.object({ text: z.string().max(2048) }).optional(),
  image: z.object({ url: httpUrlSchema }).optional(),
  thumbnail: z.object({ url: httpUrlSchema }).optional(),
  fields: z
    .array(
      z.object({
        name: z.string().max(256),
        value: z.string().max(1024),
        inline: z.boolean().optional(),
      })
    )
    .max(25)
    .optional(),
})

// Discord requires at least one of content/embeds. Limits mirror Discord's
// where senders depend on them, generous elsewhere.
export const discordWebhookBodySchema = z
  .object({
    content: z.string().max(4096).optional().nullable(),
    username: z.string().trim().min(1).max(80).optional(),
    embeds: z.array(discordEmbedSchema).max(10).optional().nullable(),
  })
  .refine((v) => !!v.content?.trim() || (v.embeds?.length ?? 0) > 0, {
    message: "Provide content or embeds",
  })

export type DiscordWebhookBody = z.infer<typeof discordWebhookBodySchema>

// Discord embed text is already markdown; the card layout maps to a blockquote.
function renderDiscordEmbed(embed: z.infer<typeof discordEmbedSchema>): string {
  const parts: string[] = []
  if (embed.author?.name) {
    parts.push(
      embed.author.url
        ? `[${embed.author.name}](${embed.author.url})`
        : embed.author.name
    )
  }
  if (embed.title) {
    parts.push(
      `**${embed.url ? `[${embed.title}](${embed.url})` : embed.title}**`
    )
  }
  if (embed.description) parts.push(embed.description)
  for (const field of embed.fields ?? []) {
    parts.push(`**${field.name}**\n${field.value}`)
  }
  const imageUrl = embed.image?.url ?? embed.thumbnail?.url
  if (imageUrl) parts.push(`[image](${imageUrl})`)
  const footer = [embed.footer?.text, embed.timestamp].filter(Boolean)
  if (footer.length > 0) parts.push(`*${footer.join(" · ")}*`)
  return parts.join("\n\n")
}

export function renderDiscordWebhookBody(body: DiscordWebhookBody): string {
  const sections: string[] = []
  const content = body.content?.trim()
  if (content) sections.push(content)
  for (const embed of body.embeds ?? []) {
    const rendered = renderDiscordEmbed(embed)
    if (rendered) sections.push(blockquote(rendered))
  }
  return clip(sections.join("\n\n"))
}

// Chat presentation: embeds become structured cards on the message (the
// markdown renderers above survive for Remember/Act, where Merlin needs a
// text form of the whole payload).
export function discordEmbedsToMessageEmbeds(
  body: DiscordWebhookBody
): Embed[] {
  return (body.embeds ?? []).flatMap((embed) => {
    const fields = (embed.fields ?? []).map((f) => ({
      name: f.name,
      value: f.value,
      ...(f.inline !== undefined ? { inline: f.inline } : {}),
    }))
    const mapped: Embed = {
      type: "rich",
      ...(embed.url ? { url: embed.url } : {}),
      ...(embed.title ? { title: embed.title } : {}),
      ...(embed.description ? { description: embed.description } : {}),
      ...(embed.author
        ? {
            author: {
              name: embed.author.name,
              ...(embed.author.url ? { url: embed.author.url } : {}),
              ...(embed.author.icon_url
                ? { iconUrl: embed.author.icon_url }
                : {}),
            },
          }
        : {}),
      ...(fields.length > 0 ? { fields } : {}),
      ...(embed.image?.url ? { image: embed.image.url } : {}),
      ...(embed.thumbnail?.url ? { thumbnail: embed.thumbnail.url } : {}),
      ...(embed.footer?.text ? { footer: embed.footer.text } : {}),
      ...(embed.timestamp ? { timestamp: embed.timestamp } : {}),
      ...(discordColorToHex(embed.color)
        ? { color: discordColorToHex(embed.color) }
        : {}),
    }
    // An embed with nothing renderable would be an empty card.
    const hasContent =
      mapped.title ||
      mapped.description ||
      mapped.author ||
      (mapped.fields?.length ?? 0) > 0 ||
      mapped.image ||
      mapped.thumbnail ||
      mapped.footer
    return hasContent ? [mapped] : []
  })
}

// --- Slack dialect -----------------------------------------------------------

// Slack mrkdwn → markdown: <url|label> links, *bold*, ~strike~. Italic (_),
// inline code, and fences are already markdown-compatible. `**` sequences are
// left alone (not mrkdwn, and already render as bold).
export function mrkdwnToMarkdown(input: string): string {
  return input
    .replace(/<([^<>|]+)\|([^<>]*)>/g, "[$2]($1)")
    .replace(/<(https?:\/\/[^<>|]+)>/g, "$1")
    .replace(/<!(here|channel|everyone)>/g, "@$1")
    .replace(
      /(^|\s)\*([^\s*](?:[^*\n]*[^\s*])?)\*(?=\s|$|[.,!?:;])/gm,
      "$1**$2**"
    )
    .replace(/~([^~\n]+)~/g, "~~$1~~")
}

const slackTextSchema = z.object({
  type: z.string().optional(),
  text: z.string().max(4096),
})

const slackBlockSchema = z.object({
  type: z.string(),
  text: slackTextSchema.optional(),
  fields: z.array(slackTextSchema).max(10).optional(),
  elements: z.array(z.unknown()).optional(),
  alt_text: z.string().optional(),
  image_url: lenientHttpUrlSchema,
})

const slackAttachmentSchema = z.object({
  pretext: z.string().max(4096).optional(),
  author_name: z.string().max(256).optional(),
  author_link: lenientHttpUrlSchema,
  author_icon: lenientHttpUrlSchema,
  title: z.string().max(1024).optional(),
  title_link: lenientHttpUrlSchema,
  color: z.string().max(32).optional(),
  text: z.string().max(8000).optional(),
  image_url: lenientHttpUrlSchema,
  thumb_url: lenientHttpUrlSchema,
  fallback: z.string().max(8000).optional(),
  footer: z.string().max(2048).optional(),
  fields: z
    .array(
      z.object({
        title: z.string().max(256).optional(),
        value: z.string().max(2048).optional(),
        short: z.boolean().optional(),
      })
    )
    .max(25)
    .optional(),
})

export const slackWebhookBodySchema = z
  .object({
    text: z.string().max(8000).optional(),
    blocks: z.array(slackBlockSchema).max(50).optional(),
    attachments: z.array(slackAttachmentSchema).max(20).optional(),
  })
  .refine(
    (v) =>
      !!v.text?.trim() ||
      (v.blocks?.length ?? 0) > 0 ||
      (v.attachments?.length ?? 0) > 0,
    { message: "Provide text, blocks, or attachments" }
  )

export type SlackWebhookBody = z.infer<typeof slackWebhookBodySchema>

function slackText(text: z.infer<typeof slackTextSchema> | undefined): string {
  if (!text?.text) return ""
  return text.type === "plain_text" ? text.text : mrkdwnToMarkdown(text.text)
}

function renderSlackBlock(block: z.infer<typeof slackBlockSchema>): string {
  switch (block.type) {
    case "header":
      return block.text?.text ? `**${block.text.text}**` : ""
    case "section": {
      const parts = [slackText(block.text)]
      for (const field of block.fields ?? []) parts.push(slackText(field))
      return parts.filter(Boolean).join("\n")
    }
    case "divider":
      return "---"
    case "context": {
      const texts = (block.elements ?? [])
        .map((el) => {
          const parsed = slackTextSchema.safeParse(el)
          return parsed.success ? slackText(parsed.data) : ""
        })
        .filter(Boolean)
      return texts.length > 0 ? `*${texts.join(" · ")}*` : ""
    }
    case "image":
      return block.image_url
        ? `[${block.alt_text || "image"}](${block.image_url})`
        : ""
    // Interactive/rich blocks (actions, input, rich_text, …) have no faithful
    // markdown rendering — drop them rather than half-render.
    default:
      return ""
  }
}

function renderSlackAttachment(
  attachment: z.infer<typeof slackAttachmentSchema>
): string {
  const parts: string[] = []
  if (attachment.pretext) parts.push(mrkdwnToMarkdown(attachment.pretext))
  if (attachment.author_name) {
    parts.push(
      attachment.author_link
        ? `[${attachment.author_name}](${attachment.author_link})`
        : attachment.author_name
    )
  }
  if (attachment.title) {
    parts.push(
      `**${
        attachment.title_link
          ? `[${attachment.title}](${attachment.title_link})`
          : attachment.title
      }**`
    )
  }
  if (attachment.text) parts.push(mrkdwnToMarkdown(attachment.text))
  for (const field of attachment.fields ?? []) {
    const line = [
      field.title ? `**${field.title}**` : null,
      field.value ? mrkdwnToMarkdown(field.value) : null,
    ]
      .filter(Boolean)
      .join("\n")
    if (line) parts.push(line)
  }
  const imageUrl = attachment.image_url ?? attachment.thumb_url
  if (imageUrl) parts.push(`[image](${imageUrl})`)
  if (attachment.footer) parts.push(`*${attachment.footer}*`)
  if (parts.length === 0 && attachment.fallback) {
    parts.push(mrkdwnToMarkdown(attachment.fallback))
  }
  return parts.join("\n\n")
}

export function renderSlackWebhookBody(body: SlackWebhookBody): string {
  const sections: string[] = []
  // Slack semantics: when blocks are present, `text` is only the notification
  // fallback — render the blocks and skip it.
  if (body.blocks?.length) {
    sections.push(
      body.blocks.map(renderSlackBlock).filter(Boolean).join("\n\n")
    )
  } else if (body.text?.trim()) {
    sections.push(mrkdwnToMarkdown(body.text.trim()))
  }
  for (const attachment of body.attachments ?? []) {
    const rendered = renderSlackAttachment(attachment)
    if (rendered) sections.push(blockquote(rendered))
  }
  return clip(sections.filter(Boolean).join("\n\n"))
}

// The message body only (text/blocks) — attachments become structured cards.
export function renderSlackContent(body: SlackWebhookBody): string {
  if (body.blocks?.length) {
    return clip(body.blocks.map(renderSlackBlock).filter(Boolean).join("\n\n"))
  }
  if (body.text?.trim()) return clip(mrkdwnToMarkdown(body.text.trim()))
  return ""
}

export function slackAttachmentsToMessageEmbeds(
  body: SlackWebhookBody
): Embed[] {
  return (body.attachments ?? []).flatMap((attachment) => {
    const fields = (attachment.fields ?? []).flatMap((f) =>
      f.title || f.value
        ? [
            {
              name: f.title ?? "",
              value: f.value ? mrkdwnToMarkdown(f.value) : "",
              ...(f.short !== undefined ? { inline: f.short } : {}),
            },
          ]
        : []
    )
    // Slack renders pretext above the bar; folding it into the card keeps a
    // multi-attachment message unambiguous (UI spin, not a data deviation).
    const description = [
      attachment.pretext ? mrkdwnToMarkdown(attachment.pretext) : null,
      attachment.text ? mrkdwnToMarkdown(attachment.text) : null,
    ]
      .filter(Boolean)
      .join("\n\n")
    const mapped: Embed = {
      type: "rich",
      ...(attachment.title_link ? { url: attachment.title_link } : {}),
      ...(attachment.title ? { title: attachment.title } : {}),
      ...(description ? { description } : {}),
      ...(attachment.author_name
        ? {
            author: {
              name: attachment.author_name,
              ...(attachment.author_link
                ? { url: attachment.author_link }
                : {}),
              ...(attachment.author_icon
                ? { iconUrl: attachment.author_icon }
                : {}),
            },
          }
        : {}),
      ...(fields.length > 0 ? { fields } : {}),
      ...(attachment.image_url ? { image: attachment.image_url } : {}),
      ...(attachment.thumb_url ? { thumbnail: attachment.thumb_url } : {}),
      ...(attachment.footer ? { footer: attachment.footer } : {}),
      ...(slackColorToHex(attachment.color)
        ? { color: slackColorToHex(attachment.color) }
        : {}),
    }
    const hasContent =
      mapped.title ||
      mapped.description ||
      mapped.author ||
      (mapped.fields?.length ?? 0) > 0 ||
      mapped.image ||
      mapped.thumbnail ||
      mapped.footer
    if (hasContent) return [mapped]
    // Content-free attachment: fall back to `fallback`, Slack's own rule.
    if (attachment.fallback) {
      return [
        { type: "rich", description: mrkdwnToMarkdown(attachment.fallback) },
      ]
    }
    return []
  })
}

// A base-URL delivery that failed native validation but looks like a foreign
// dialect gets pointed at the right suffix instead of a bare 400.
export function dialectHint(body: unknown): "discord" | "slack" | null {
  if (typeof body !== "object" || body === null) return null
  if ("embeds" in body) return "discord"
  if ("blocks" in body || "attachments" in body) return "slack"
  return null
}
