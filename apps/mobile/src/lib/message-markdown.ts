import type { Message } from "@/lib/api-types"

// Mirrors the token contract in apps/web message-markdown.tsx. Stored message
// content embeds mention/citation tokens; we rewrite them to markdown links
// carrying lor:// schemes so the native renderer styles them via linkVariants
// and routes taps through onLinkPress. The regexes must stay in sync with web.
export const MENTION_SCHEME = "lor://mention/"
export const MSG_SCHEME = "lor://msg/"
export const SRC_SCHEME = "lor://src/"

const USER_MENTION_TOKEN_REGEX =
  /<@([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})>/gi
const TIPTAP_MENTION_REGEX =
  /\[@[^\]]*?\bid="([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})"[^\]]*]/gi
const EVERYONE_MENTION_REGEX = /(^|\s)@everyone\b/gi
const CITATION_REGEX = /\[\[([^\]]+)\]\]/g

function getMentionLabel(mention: Message["mentions"][number]) {
  return mention.displayUsername ?? mention.username ?? mention.name
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

export function toDisplayMarkdown(
  content: string | null,
  mentions: Message["mentions"]
): string {
  if (!content) return ""
  const mentionById = new Map(mentions.map((mention) => [mention.id, mention]))

  return content
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
      // Verified brain-page citation ([[/path]]). Non-clickable (no brain
      // browser yet) — the path renders as a muted mono chip.
      return codeChip(token)
    })
}
