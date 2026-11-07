import Link from "@tiptap/extension-link"
import Mention, { type MentionOptions } from "@tiptap/extension-mention"
import { SUGGESTION_PRIORITY } from "@/components/chat/composer/composer-keymap"
import type { MentionCandidate } from "@/components/chat/composer/mention-types"
import { STORED_MENTION_REGEX } from "@/lib/editor-utils"

// Stored message markdown for mentions and links, written and read back by
// the nodes themselves. The server, renderer and mention extraction read
// `<@id>` for a person and a lowercase `@channel`, `@here` or `@everyone`
// for a broadcast (packages/messaging/src/mentions.ts).
const BROADCAST_MENTION_IDS = new Set(["everyone", "channel", "here"])
const USER_MENTION = new RegExp(`^${STORED_MENTION_REGEX.source}`, "i")
// A broadcast counts only at the start or after whitespace, as the server
// matches it.
const BROADCAST_MENTION = /^@(everyone|channel|here)\b/i
const MENTION_START = new RegExp(
  `${STORED_MENTION_REGEX.source}|(?:^|\\s)@(?:everyone|channel|here)\\b`,
  "i"
)

export type ComposerMentionOptions = MentionOptions<MentionCandidate> & {
  // Name shown for a stored `<@id>` loaded back into the editor.
  mentionLabel?: (id: string) => string | null
}

export const ComposerMention = Mention.extend<ComposerMentionOptions>({
  // The @ menu takes Enter before the composer keymap sends.
  priority: SUGGESTION_PRIORITY,

  markdownTokenizer: {
    name: "mention",
    level: "inline",
    start: (src) => {
      const match = MENTION_START.exec(src)
      if (!match) return -1
      return match.index + (/^\s/.test(match[0]) ? 1 : 0)
    },
    tokenize: (src, tokens) => {
      const user = USER_MENTION.exec(src)
      const broadcast = user ? null : BROADCAST_MENTION.exec(src)
      const raw = (user ?? broadcast)?.[0]
      const id = user?.[1] ?? broadcast?.[1]?.toLowerCase()
      if (!raw || !id) return undefined
      const previous = tokens.at(-1)?.raw
      if (broadcast && previous && !/\s$/.test(previous)) return undefined
      // Tokenizers are shared by every editor (marked's global instance), so
      // one without mentions (workspace instructions) keeps this as text.
      return {
        type: "mention",
        raw,
        id,
        tokens: [{ type: "text", raw, text: raw }],
      }
    },
  },

  parseMarkdown(token, helpers) {
    const id = String(token.id ?? "")
    const label = BROADCAST_MENTION_IDS.has(id)
      ? id
      : (this.options.mentionLabel?.(id) ?? null)
    return helpers.createNode(this.name, { id, label })
  },

  renderMarkdown(node) {
    const id = String(node.attrs?.id ?? "")
    const broadcast = id.toLowerCase()
    if (BROADCAST_MENTION_IDS.has(broadcast)) return `@${broadcast}`
    return id ? `<@${id}>` : ""
  },
})

// The serializer escapes some of these characters in text, and GFM autolinks
// drop trailing punctuation and parens, so such URLs keep `[text](url)`.
const BARE_URL =
  /^https?:\/\/[^\s\\`*_[\]~&<>()'"]*[^\s\\`*_[\]~&<>()'".,:;!?]$/i

// A link whose text is its URL (typed, pasted or autolinked) is stored as the
// bare URL. Marks render only their delimiters; markText is the whole run.
export const ComposerLink = Link.extend({
  renderMarkdown(node, helpers, context) {
    const href = String(node.attrs?.href ?? "")
    if (context.meta?.markText === href && BARE_URL.test(href)) {
      return helpers.renderChildren(node)
    }
    return this.parent?.(node, helpers, context) ?? ""
  },
})
