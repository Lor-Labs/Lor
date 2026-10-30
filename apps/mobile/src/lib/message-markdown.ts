import { formatDateTime } from "@repo/utils/date"
import type { Message } from "@/lib/api-types"
import { env } from "@/lib/env"

// Mirrors the token contract in apps/web message-markdown.tsx. Stored message
// content embeds mention/citation tokens; we rewrite them to markdown links
// carrying lor:// schemes so the native renderer styles them via linkVariants
// and routes taps through onLinkPress. The regexes must stay in sync with web.
export const MENTION_SCHEME = "lor://mention/"
export const MSG_SCHEME = "lor://msg/"
export const SRC_SCHEME = "lor://src/"
export const CALL_SCHEME = "lor://call/"

const USER_MENTION_TOKEN_REGEX =
  /<@([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})>/gi
const TIPTAP_MENTION_REGEX =
  /\[@[^\]]*?\bid="([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})"[^\]]*]/gi
const ENRICHED_MENTION_REGEX =
  /\[@(?:\\.|[^\]])*]\(lor:\/\/mention\/(everyone|channel|here|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\)/gi
const EVERYONE_MENTION_REGEX = /(^|\s)@everyone\b/gi
const CHANNEL_MENTION_REGEX = /(^|\s)@channel\b/gi
const HERE_MENTION_REGEX = /(^|\s)@here\b/gi
const BROADCAST_MENTION_TOKENS = new Set(["everyone", "channel", "here"])
const CITATION_REGEX = /\[\[([^\]]+)\]\]/g
// An inline image with a bracket-free alt, or else any other "![" (reference
// images, and alts holding a nested image whose outer src would win).
const IMAGE_SYNTAX_REGEX = /!\[[^[\]\n]*]\(\s*<?([^\s)>]*)>?[^)\n]*\)|!\[/g
const TRUSTED_IMAGE_PREFIX = `${env.EXPO_PUBLIC_S3_PUBLIC_URL}/`

// User ids mentioned in the composer's draft markdown, broadcasts left out.
export function draftMentionIds(markdown: string) {
  return [...markdown.matchAll(ENRICHED_MENTION_REGEX)]
    .map((match) => match[1] ?? "")
    .filter((id) => id && !BROADCAST_MENTION_TOKENS.has(id.toLowerCase()))
}

function getMentionLabel(mention: Message["mentions"][number]) {
  return mention.name
}

// Escapes characters that would break markdown link text.
function escapeLinkText(value: string) {
  return value.replace(/[\\[\]]/g, "\\$&")
}

// Renders a non-clickable inline-code chip; strips backticks so the span can't
// break out of its own delimiters.
function codeChip(value: string) {
  return `\`${value.replace(/`/g, "")}\``
}

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value.trim())
}

function mentionLink(label: string, id: string) {
  return `[@${escapeLinkText(label)}](${MENTION_SCHEME}${id})`
}

// The native renderer loads markdown images with no tap, so a prompt-injected
// reply could leak data in an image URL. Only file-CDN images stay images;
// any other image becomes a link that shows its URL. A bare "![" gets a
// zero-width space after the "!" (not "\!": a preceding backslash would turn
// that back into an image), so "Done![[msg:x]]" keeps its "!".
function neutralizeUntrustedImages(markdown: string) {
  return markdown.replace(
    IMAGE_SYNTAX_REGEX,
    (match, url: string | undefined) => {
      if (url === undefined) return "!​["
      if (url.startsWith(TRUSTED_IMAGE_PREFIX)) return match
      return isHttpUrl(url) ? `[${escapeLinkText(url)}](${url})` : ""
    }
  )
}

export function toStoredMessageMarkdown(markdown: string) {
  return markdown.replace(ENRICHED_MENTION_REGEX, (_match, id: string) =>
    BROADCAST_MENTION_TOKENS.has(id.toLowerCase())
      ? `@${id.toLowerCase()}`
      : `<@${id}>`
  )
}

export function toSearchPreviewText(
  content: string | null,
  mentions: Message["mentions"]
) {
  if (!content) return ""
  const mentionById = new Map(mentions.map((mention) => [mention.id, mention]))
  const mentionLabel = (id: string) => {
    const mention = mentionById.get(id)
    return `@${mention ? getMentionLabel(mention) : "unknown-user"}`
  }

  return content
    .replace(TIPTAP_MENTION_REGEX, (_match, id: string) => mentionLabel(id))
    .replace(USER_MENTION_TOKEN_REGEX, (_match, id: string) => mentionLabel(id))
    .replace(/!\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/^```[^\n]*$/gm, "")
    .replace(/(^|\n)[ \t]{0,3}(?:#{1,6}|>+|[-*+]|\d+[.)])[ \t]+/g, "$1")
    .replace(/(\*\*|__)(\S(?:[\s\S]*?\S)?)\1/g, "$2")
    .replace(/\*(\S(?:[^*\n]*?\S)?)\*/g, "$1")
    .replace(/(^|\W)_(\S(?:[^_\n]*?\S)?)_(?=\W|$)/g, "$1$2")
    .replace(/~~(\S(?:[\s\S]*?\S)?)~~/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .trim()
}

export function toDisplayMarkdown(
  content: string | null,
  mentions: Message["mentions"]
): string {
  if (!content) return ""
  const mentionById = new Map(mentions.map((mention) => [mention.id, mention]))

  return neutralizeUntrustedImages(content)
    .replace(TIPTAP_MENTION_REGEX, (_match, id: string) => {
      const mention = mentionById.get(id)
      return mentionLink(
        mention ? getMentionLabel(mention) : "unknown-user",
        id
      )
    })
    .replace(
      EVERYONE_MENTION_REGEX,
      (_match, prefix: string) =>
        `${prefix}[@everyone](${MENTION_SCHEME}everyone)`
    )
    .replace(
      CHANNEL_MENTION_REGEX,
      (_match, prefix: string) =>
        `${prefix}[@channel](${MENTION_SCHEME}channel)`
    )
    .replace(
      HERE_MENTION_REGEX,
      (_match, prefix: string) => `${prefix}[@here](${MENTION_SCHEME}here)`
    )
    .replace(USER_MENTION_TOKEN_REGEX, (_match, id: string) => {
      const mention = mentionById.get(id)
      return mentionLink(
        mention ? getMentionLabel(mention) : "unknown-user",
        id
      )
    })
    .replace(CITATION_REGEX, (_match, raw: string) => {
      const token = raw.trim()
      if (token.startsWith("msg:")) {
        const id = token.slice(4).trim()
        return `[↗ message](${MSG_SCHEME}${encodeURIComponent(id)})`
      }
      if (token.startsWith("src:")) {
        // [[src:<id>|<title>|<url>]] once grounded; bare [[src:<id>]] while
        // streaming renders as a non-clickable chip until the url is attached.
        const [, title = "", url = ""] = token.slice(4).split("|")
        const label = title.trim() || "source"
        const trimmedUrl = url.trim()
        return isHttpUrl(trimmedUrl)
          ? `[↗ ${escapeLinkText(label)}](${SRC_SCHEME}${encodeURIComponent(trimmedUrl)})`
          : codeChip(`↗ ${label}`)
      }
      if (token.startsWith("call:")) {
        // [[call:<id>@<ms>|<channel>|<startedAt>]] once grounded; a bare
        // [[call:<id>@12:40]] while streaming stays a plain chip.
        const [body = "", channel = "", startedAt = ""] = token
          .slice(5)
          .split("|")
        const [sessionId = "", at = ""] = body.split("@")
        const atMs = /^\d+$/.test(at.trim()) ? Number(at.trim()) : 0
        const start = Date.parse(startedAt.trim())
        if (!channel.trim() || Number.isNaN(start)) return codeChip("↗ call")
        const label = `${channel.trim()} call · ${formatDateTime(new Date(start + atMs))}`
        return `[↗ ${escapeLinkText(label)}](${CALL_SCHEME}${encodeURIComponent(sessionId.trim())}?at=${atMs})`
      }
      // Verified brain-page citation ([[/path]]). Non-clickable (no brain
      // browser yet) — the path renders as a muted mono chip.
      return codeChip(token)
    })
}
