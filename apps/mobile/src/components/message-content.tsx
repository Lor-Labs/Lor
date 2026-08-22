import { useThemeColor } from "heroui-native/hooks"
import { useCallback, useMemo } from "react"
import {
  EnrichedMarkdownText,
  type MarkdownStyle,
} from "react-native-enriched-markdown"
import { StreamdownText } from "react-native-streamdown"
import { Fonts } from "@/constants/theme"
import type { Message } from "@/lib/api-types"
import { BROADCAST_MENTION_IDS } from "@/lib/mentions"
import {
  MENTION_SCHEME,
  MSG_SCHEME,
  SRC_SCHEME,
  toDisplayMarkdown,
} from "@/lib/message-markdown"
import { openExternalUrl } from "@/lib/open-url"

type MessageTheme = {
  text: string
  accent: string
  accentMuted: string
  backgroundSelected: string
  border: string
  backgroundElement: string
  textSecondary: string
  textTertiary: string
}

function buildMarkdownStyle(theme: MessageTheme): MarkdownStyle {
  const chip = { color: theme.accent, backgroundColor: theme.accentMuted }
  return {
    paragraph: {
      color: theme.text,
      fontSize: 16,
      lineHeight: 22,
      marginTop: 0,
      marginBottom: 4,
    },
    strong: { color: theme.text },
    em: { color: theme.text },
    link: { color: theme.accent, underline: true },
    // Per-scheme chip styling (regex tested against the full URL). Mentions and
    // citations get muted-accent chips; real URLs fall back to the base link.
    linkVariants: {
      "^lor://mention/": { ...chip, underline: false },
      "^lor://msg/": { ...chip, underline: false },
      "^lor://src/": { ...chip, underline: false },
    },
    code: {
      color: theme.text,
      backgroundColor: theme.backgroundSelected,
      // `CodeStyle` takes borderColor but not borderWidth — the renderer owns the
      // edge, so this is as close to web's outlined chip as the library allows.
      borderColor: theme.border,
      fontFamily: Fonts?.mono,
      fontSize: 14,
    },
    codeBlock: {
      color: theme.text,
      backgroundColor: theme.backgroundElement,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: 8,
      padding: 10,
      fontFamily: Fonts?.mono,
      fontSize: 14,
    },
    blockquote: {
      color: theme.textSecondary,
      borderColor: theme.border,
      backgroundColor: theme.backgroundElement,
    },
    list: {
      color: theme.text,
      bulletColor: theme.textTertiary,
      markerColor: theme.textTertiary,
    },
    h1: { color: theme.text, fontSize: 22 },
    h2: { color: theme.text, fontSize: 20 },
    h3: { color: theme.text, fontSize: 18 },
  }
}

export function MessageContent({
  content,
  mentions,
  streaming = false,
  onMentionPress,
  onCitationJump,
}: {
  content: string | null
  mentions: Message["mentions"]
  streaming?: boolean
  onMentionPress?: (id: string) => void
  onCitationJump?: (messageId: string) => void
}) {
  const [
    text,
    accent,
    accentMuted,
    backgroundSelected,
    border,
    backgroundElement,
    textSecondary,
  ] = useThemeColor([
    "foreground",
    "accent",
    "accent-soft",
    "surface-tertiary",
    "border",
    "surface-secondary",
    "muted",
  ])
  const theme = useMemo<MessageTheme>(
    () => ({
      text,
      accent,
      accentMuted,
      backgroundSelected,
      border,
      backgroundElement,
      textSecondary,
      textTertiary: textSecondary,
    }),
    [
      text,
      accent,
      accentMuted,
      backgroundSelected,
      border,
      backgroundElement,
      textSecondary,
    ]
  )
  const markdown = useMemo(
    () => toDisplayMarkdown(content, mentions),
    [content, mentions]
  )
  const markdownStyle = useMemo(() => buildMarkdownStyle(theme), [theme])

  const onLinkPress = useCallback(
    ({ url }: { url: string }) => {
      if (url.startsWith(MENTION_SCHEME)) {
        const id = url.slice(MENTION_SCHEME.length)
        if (id && !BROADCAST_MENTION_IDS.has(id)) onMentionPress?.(id)
        return
      }
      if (url.startsWith(MSG_SCHEME)) {
        onCitationJump?.(decodeURIComponent(url.slice(MSG_SCHEME.length)))
        return
      }
      if (url.startsWith(SRC_SCHEME)) {
        const target = decodeURIComponent(url.slice(SRC_SCHEME.length))
        if (/^https?:\/\//i.test(target)) openExternalUrl(target)
        return
      }
      if (/^https?:\/\//i.test(url)) openExternalUrl(url)
    },
    [onMentionPress, onCitationJump]
  )

  if (markdown.trim().length === 0) return null

  // Complete messages render directly through the native renderer. StreamdownText
  // routes through remend on a worklet thread to repair partial markdown — only
  // needed while a Merlin reply is actively streaming.
  if (streaming) {
    return (
      <StreamdownText
        flavor="github"
        markdown={markdown}
        markdownStyle={markdownStyle}
        md4cFlags={{ latexMath: false }}
        onLinkPress={onLinkPress}
        selectable={false}
      />
    )
  }

  return (
    <EnrichedMarkdownText
      flavor="github"
      markdown={markdown}
      markdownStyle={markdownStyle}
      md4cFlags={{ latexMath: false }}
      onLinkPress={onLinkPress}
      selectable={false}
    />
  )
}
