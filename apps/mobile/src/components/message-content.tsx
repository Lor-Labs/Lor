import { useThemeColor } from "heroui-native/hooks"
import { createContext, useCallback, useContext, useMemo } from "react"
import { useColorScheme } from "react-native"
import {
  EnrichedMarkdownText,
  type MarkdownStyle,
} from "react-native-enriched-markdown"
import { StreamdownText } from "react-native-streamdown"
import { Fonts } from "@/constants/theme"
import { useOpenCallTranscript } from "@/hooks/use-open-call-transcript"
import type { Message } from "@/lib/api-types"
import { BROADCAST_MENTION_IDS } from "@/lib/mentions"
import {
  CALL_SCHEME,
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
  surface: string
  // Web's table frame: muted in light, the page background in dark.
  tableFrame: string
  textSecondary: string
  textTertiary: string
}

// A session transcript reads as a document: roomier leading, and a turn for
// the session's subscribers only (Lor left out) reads as a muted aside.
export const MessageProseContext = createContext({
  document: false,
  muted: false,
})

function buildMarkdownStyle(
  theme: MessageTheme,
  document: boolean
): MarkdownStyle {
  const chip = { color: theme.accent, backgroundColor: theme.accentMuted }
  return {
    paragraph: {
      color: theme.text,
      fontSize: 16,
      lineHeight: document ? 24 : 22,
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
    // Web's message table: muted header text on the frame color, every body
    // row on the card color, quiet lines. The renderer's defaults are fixed
    // light colors, so each one is set. It always bolds the header and draws
    // a full grid, so those two differ from web.
    table: {
      color: theme.text,
      fontSize: 13,
      lineHeight: 19,
      headerTextColor: theme.textSecondary,
      headerBackgroundColor: theme.tableFrame,
      rowEvenBackgroundColor: theme.surface,
      rowOddBackgroundColor: theme.surface,
      borderColor: theme.backgroundSelected,
      borderWidth: 1,
      borderRadius: 12,
      cellPaddingHorizontal: 10,
      cellPaddingVertical: 6,
      marginTop: 4,
      marginBottom: 8,
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
    surface,
    background,
    textSecondary,
  ] = useThemeColor([
    "foreground",
    "accent",
    "accent-soft",
    "surface-tertiary",
    "border",
    "surface-secondary",
    "surface",
    "background",
    "muted",
  ])
  const dark = useColorScheme() === "dark"
  const prose = useContext(MessageProseContext)
  const theme = useMemo<MessageTheme>(
    () => ({
      text: prose.muted ? textSecondary : text,
      accent,
      accentMuted,
      backgroundSelected,
      border,
      backgroundElement,
      surface,
      tableFrame: dark ? background : backgroundElement,
      textSecondary,
      textTertiary: textSecondary,
    }),
    [
      prose.muted,
      text,
      accent,
      accentMuted,
      backgroundSelected,
      border,
      backgroundElement,
      surface,
      dark,
      background,
      textSecondary,
    ]
  )
  const markdown = useMemo(
    () => toDisplayMarkdown(content, mentions),
    [content, mentions]
  )
  const markdownStyle = useMemo(
    () => buildMarkdownStyle(theme, prose.document),
    [theme, prose.document]
  )
  const openCallTranscript = useOpenCallTranscript()

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
      if (url.startsWith(CALL_SCHEME)) {
        // lor://call/<sessionId>?at=<ms into the call>
        const [id = "", query = ""] = url.slice(CALL_SCHEME.length).split("?")
        const at = /(?:^|&)at=(\d+)/.exec(query)?.[1]
        const sessionId = decodeURIComponent(id)
        if (sessionId) {
          void openCallTranscript(sessionId, at ? Number(at) : undefined)
        }
        return
      }
      if (/^https?:\/\//i.test(url)) openExternalUrl(url)
    },
    [onMentionPress, onCitationJump, openCallTranscript]
  )

  if (markdown.trim().length === 0) return null

  // Complete messages render directly through the native renderer. StreamdownText
  // routes through remend on a worklet thread to repair partial markdown — only
  // needed while a Lor reply is actively streaming.
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
