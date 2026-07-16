// Plain-text message preview for search results. Keeps the stored-token
// regexes in sync with message-markdown.tsx and the mobile equivalent
// (apps/mobile/src/lib/message-markdown.ts).
const USER_MENTION_TOKEN_REGEX =
  /<@([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})>/gi
const TIPTAP_MENTION_REGEX =
  /\[@[^\]]*?\bid="([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})"[^\]]*]/gi
const CITATION_REGEX = /\[\[([^\]]+)\]\]/g

type PreviewMention = {
  id: string
  name: string
  username: string | null
  displayUsername: string | null
}

export function toSearchPreviewText(
  content: string | null,
  mentions: PreviewMention[]
) {
  if (!content) return ""
  const mentionById = new Map(mentions.map((mention) => [mention.id, mention]))
  const mentionLabel = (id: string) => {
    const mention = mentionById.get(id)
    return `@${mention ? (mention.displayUsername ?? mention.username ?? mention.name) : "unknown-user"}`
  }

  return content
    .replace(TIPTAP_MENTION_REGEX, (_match, id: string) => mentionLabel(id))
    .replace(USER_MENTION_TOKEN_REGEX, (_match, id: string) => mentionLabel(id))
    .replace(CITATION_REGEX, (_match, raw: string) => {
      const token = raw.trim()
      if (token.startsWith("msg:")) return "↗ message"
      if (token.startsWith("src:")) {
        const [, title = ""] = token.slice(4).split("|")
        return `↗ ${title.trim() || "source"}`
      }
      return token
    })
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
