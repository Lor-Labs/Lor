import Link, { isAllowedUri } from "@tiptap/extension-link"
import Mention, { type MentionOptions } from "@tiptap/extension-mention"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import type { EditorView } from "@tiptap/pm/view"
import { SUGGESTION_PRIORITY } from "@/components/chat/composer/composer-keymap"
import type { MentionCandidate } from "@/components/chat/composer/mention-types"
import { STORED_MENTION_REGEX } from "@/lib/editor-utils"
import { openInNewTab } from "@/lib/open-external"

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

const URL_SCHEME = /^([a-z][a-z\d+.-]*):/i
const EMAIL = /^[^\s@/:]+@[^\s@/:]+\.[^\s@/:]+$/
// "example.com/x" with no scheme, as `[text](example.com)` can store it.
const SCHEMELESS_DOMAIN = /^[\w-]+(?:\.[\w-]+)+(?:[/:?#]|$)/

// What the link popover and Cmd+click accept: a scheme is added when missing
// ("example.com", "localhost:3000", "me@example.com"), and anything Link
// itself would refuse (javascript:, data:) or that can't parse is null.
export function toLinkHref(input: string): string | null {
  const text = input.trim()
  if (!text || /\s/.test(text)) return null
  const scheme = URL_SCHEME.exec(text)
  // "localhost:3000" matches as a scheme but is a port.
  const hasScheme = scheme && !/^\d/.test(text.slice(scheme[0].length))
  const href = hasScheme
    ? text
    : EMAIL.test(text)
      ? `mailto:${text}`
      : `https://${text.replace(/^\/\//, "")}`
  if (!isAllowedUri(href)) return null
  try {
    const url = new URL(href)
    if (/^https?:$/.test(url.protocol) && !url.hostname) return null
  } catch {
    return null
  }
  return href
}

function linkAt(view: EditorView, event: MouseEvent) {
  const anchor =
    event.target instanceof Element ? event.target.closest("a[href]") : null
  return anchor && view.dom.contains(anchor) ? anchor : null
}

// A link whose text is its URL (typed, pasted or autolinked) is stored as the
// bare URL. Marks render only their delimiters; markText is the whole run.
export const ComposerLink = Link.extend({
  // Typing at either edge of a link continues plain text.
  inclusive: () => false,

  renderMarkdown(node, helpers, context) {
    const stored = String(node.attrs?.href ?? "")
    const href = SCHEMELESS_DOMAIN.test(stored) ? `https://${stored}` : stored
    if (context.meta?.markText === href && BARE_URL.test(href)) {
      return helpers.renderChildren(node)
    }
    const linked = { ...node, attrs: { ...node.attrs, href } }
    return this.parent?.(linked, helpers, context) ?? ""
  },

  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        key: new PluginKey("composerLinkClick"),
        props: {
          // A click places the caret (openOnClick is off); Cmd/Ctrl+click
          // opens the link, in the system browser on desktop. Handled here,
          // ProseMirror's Cmd+click node selection never runs.
          handleClick: (view, _pos, event) => {
            if (event.button !== 0 || !(event.metaKey || event.ctrlKey)) {
              return false
            }
            const anchor = linkAt(view, event)
            if (!anchor) return false
            const href = toLinkHref(anchor.getAttribute("href") ?? "")
            if (href) openInNewTab(href)
            return true
          },
          handleDOMEvents: {
            // The desktop app opens any clicked external anchor (main.tsx).
            click: (view, event) => {
              if (linkAt(view, event)) event.preventDefault()
              return false
            },
          },
        },
      }),
    ]
  },
})
