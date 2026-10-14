import { env } from "@repo/env/client"
import { MessageMarkdown as NexusMessageMarkdown } from "@repo/ui/components/nexus-ui/message"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { formatDateTime } from "@repo/utils/date"
import { memo, type ReactNode, useMemo, useState } from "react"
import type { Components } from "streamdown"
import { UserHoverCard } from "@/components/ui/user-profile-card"
import { useCallCitation } from "@/hooks/use-call-citation"
import { useMessageLocation } from "@/hooks/use-message-search-navigation"
import type { Message } from "@/lib/api-types"
import { CODE_THEMES } from "@/lib/code-themes"
import { connectorForUrl, connectorLogo } from "@/lib/connector-ui"

const USER_MENTION_TOKEN_REGEX =
  /<@([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})>/gi
const TIPTAP_MENTION_REGEX =
  /\[@[^\]]*?\bid="([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})"[^\]]*]/gi
const EVERYONE_MENTION_REGEX = /(^|\s)@everyone\b/gi
const CHANNEL_MENTION_REGEX = /(^|\s)@channel\b/gi
const HERE_MENTION_REGEX = /(^|\s)@here\b/gi
const BROADCAST_MENTION_IDS = new Set(["everyone", "channel", "here"])
// Lor cites grounded sources, all verified server-side: [[/path]] (brain
// page), [[msg:<id>]] (message), [[src:<id>|<title>|<url>]] (connected-tool
// source, enriched with its verified title + url at grounding time), or
// [[call:<id>@<ms>|<channel>|<startedAt>]] (a moment in a past call).
const CITATION_REGEX = /\[\[([^\]]+)\]\]/g

// Escapes for both text and double-quoted attribute contexts (data-id below),
// so a citation token can't break out of its attribute.
function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

// Only http(s) urls become clickable. Our custom <srcref> tag bypasses
// Streamdown's href sanitizer, so guard the scheme here (defense-in-depth —
// these urls come from our own source rows, but never trust by construction).
function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim())
}

function getMentionLabel(mention: Message["mentions"][number]) {
  return mention.name
}

// Codex-style link icon, a renderer concern only (the markdown stays a plain
// link): connector hosts wear their brand mark, other external links get the
// site's favicon by domain. The rounded plate normalizes favicons of any
// shape/resolution to one consistent glyph; a failed favicon drops the plate
// entirely rather than leaving an empty square.
function IconPlate({ children }: { children: ReactNode }) {
  return (
    <span className="mr-[5px] inline-flex size-4 items-center justify-center rounded-[4px] bg-muted align-[-0.22em] ring-1 ring-border ring-inset">
      {children}
    </span>
  )
}

function LinkIcon({ href }: { href?: string }) {
  const [failed, setFailed] = useState(false)
  if (!href || !isHttpUrl(href) || failed) return null
  const connector = connectorForUrl(href)
  if (connector) {
    const Logo = connectorLogo(connector)
    return (
      <IconPlate>
        <Logo className="size-3" />
      </IconPlate>
    )
  }
  let host: string
  try {
    host = new URL(href).hostname
  } catch {
    return null
  }
  return (
    <IconPlate>
      <img
        src={`${env.NEXT_PUBLIC_API_URL}/v1/favicon/${encodeURIComponent(host)}`}
        alt=""
        loading="lazy"
        className={cn(
          "size-3 rounded-[2px] object-contain",
          /(^|\.)githubstatus\.com$/i.test(host) && "dark:invert"
        )}
        onError={() => setFailed(true)}
      />
    </IconPlate>
  )
}

// Mentions are emitted as a custom <mention> tag rather than a link so they
// survive Streamdown's HTML sanitizer (which strips non-http href schemes). The
// label is kept as the tag's (literal) children so it renders even before the
// component resolves, and so the element isn't dropped as empty.
function toRenderableMarkdown(
  content: string,
  mentions: Message["mentions"]
): string {
  const mentionById = new Map(mentions.map((m) => [m.id, m]))
  return content
    .replace(TIPTAP_MENTION_REGEX, (_match, userId: string) => `<@${userId}>`)
    .replace(
      EVERYONE_MENTION_REGEX,
      (_match, prefix: string) =>
        `${prefix}<mention data-id="everyone">@everyone</mention>`
    )
    .replace(
      CHANNEL_MENTION_REGEX,
      (_match, prefix: string) =>
        `${prefix}<mention data-id="channel">@channel</mention>`
    )
    .replace(
      HERE_MENTION_REGEX,
      (_match, prefix: string) =>
        `${prefix}<mention data-id="here">@here</mention>`
    )
    .replace(USER_MENTION_TOKEN_REGEX, (_match, userId: string) => {
      const mention = mentionById.get(userId)
      const label = mention ? getMentionLabel(mention) : "unknown-user"
      return `<mention data-id="${userId}">@${escapeHtml(label)}</mention>`
    })
    .replace(CITATION_REGEX, (_match, raw: string) => {
      const token = raw.trim()
      if (token.startsWith("msg:")) {
        const id = token.slice(4).trim()
        return `<msgref data-id="${escapeHtml(id)}">↗ message</msgref>`
      }
      if (token.startsWith("src:")) {
        // Enriched [[src:<id>|<title>|<url>]] once grounded; bare [[src:<id>]]
        // while still streaming (renders as a non-clickable chip until settled).
        const [, title = "", url = ""] = token.slice(4).split("|")
        const label = title.trim() || "source"
        const trimmedUrl = url.trim()
        const safeUrl = isHttpUrl(trimmedUrl) ? trimmedUrl : ""
        return safeUrl
          ? `<srcref data-url="${escapeHtml(safeUrl)}">↗ ${escapeHtml(label)}</srcref>`
          : `<srcref>↗ ${escapeHtml(label)}</srcref>`
      }
      if (token.startsWith("call:")) {
        // Grounded tokens carry the channel and start time; a bare
        // [[call:<id>@12:40]] while streaming stays a plain chip.
        const [body = "", channel = "", startedAt = ""] = token
          .slice(5)
          .split("|")
        const [sessionId = "", at = ""] = body.split("@")
        const atMs = /^\d+$/.test(at.trim()) ? Number(at.trim()) : 0
        const start = Date.parse(startedAt.trim())
        if (!channel.trim() || Number.isNaN(start)) {
          return "<callref>↗ call</callref>"
        }
        const label = `${channel.trim()} call · ${formatDateTime(new Date(start + atMs))}`
        return `<callref data-id="${escapeHtml(sessionId.trim())}" data-at="${atMs}">↗ ${escapeHtml(label)}</callref>`
      }
      return `<pageref>${escapeHtml(token)}</pageref>`
    })
}

interface MentionProps {
  "data-id"?: string
  "data-url"?: string
  "data-at"?: string
  children?: ReactNode
  node?: { properties?: Record<string, unknown> }
}

// A [[call:…]] citation: opens the call's transcript at the cited moment.
function CallCitation({
  sessionId,
  atMs,
  children,
}: {
  sessionId: string | undefined
  atMs: number
  children: ReactNode
}) {
  const { open, prefetch } = useCallCitation()
  if (!sessionId) {
    return (
      <span className="inline-flex items-center rounded bg-muted px-1 py-0.5 text-[0.82em] text-muted-foreground">
        {children}
      </span>
    )
  }
  const failed = () => toast.error("Couldn't open that call")
  return (
    <button
      type="button"
      onClick={() =>
        void open(sessionId, atMs).then((found) => found || failed(), failed)
      }
      onPointerEnter={() => prefetch(sessionId)}
      onFocus={() => prefetch(sessionId)}
      className="inline-flex items-center rounded bg-primary/10 px-1 py-0.5 text-[0.82em] text-primary hover:bg-primary/20"
    >
      {children}
    </button>
  )
}

function srcUrl(props: MentionProps): string | undefined {
  const candidate =
    props["data-url"] ??
    (props.node?.properties?.dataUrl as string | undefined) ??
    (props.node?.properties?.["data-url"] as string | undefined)
  return candidate && isHttpUrl(candidate) ? candidate : undefined
}

function mentionId(props: MentionProps): string | undefined {
  return (
    props["data-id"] ??
    (props.node?.properties?.dataId as string | undefined) ??
    (props.node?.properties?.["data-id"] as string | undefined)
  )
}

interface MessageMarkdownProps {
  content: string | null
  mentions: Message["mentions"]
  className?: string
  editedAt?: string | null
  // Jump to a cited message ([[msg:<id>]]); resolves cross-channel.
  onCitationJump?: (messageId: string) => void
}

export const MessageMarkdown = memo(function MessageMarkdown({
  content,
  mentions,
  className,
  editedAt,
  onCitationJump,
}: MessageMarkdownProps) {
  const { prefetch: prefetchLocation } = useMessageLocation()
  const mentionById = useMemo(
    () => new Map(mentions.map((mention) => [mention.id, mention])),
    [mentions]
  )

  const markdown = useMemo(
    () => toRenderableMarkdown(content ?? "", mentions),
    [content, mentions]
  )

  const components = useMemo<Components>(
    () => ({
      a: ({ href, children }) => (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="break-words font-medium text-primary underline-offset-2 hover:underline"
        >
          <LinkIcon href={href} />
          {children}
        </a>
      ),
      // Verified brain-page citation ([[/path]]). Subtle, non-clickable for now
      // (no brain browser yet); the path is the children text.
      pageref: (props: MentionProps) => (
        <span className="inline-flex items-center rounded bg-muted px-1 py-0.5 font-mono text-[0.82em] text-muted-foreground">
          {props.children}
        </span>
      ),
      // Verified connected-tool source citation ([[src:<id>]]). Links out to the
      // source's verified url (carried inline post-grounding); falls back to a
      // non-clickable chip while streaming, before the url is attached.
      srcref: (props: MentionProps) => {
        const url = srcUrl(props)
        if (url) {
          return (
            <a
              href={url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center rounded bg-primary/10 px-1 py-0.5 text-[0.82em] text-primary hover:bg-primary/20"
            >
              {props.children}
            </a>
          )
        }
        return (
          <span className="inline-flex items-center rounded bg-muted px-1 py-0.5 text-[0.82em] text-muted-foreground">
            {props.children}
          </span>
        )
      },
      // Verified message citation ([[msg:<id>]]). Clickable — jumps to the
      // message (resolving its channel if elsewhere in the workspace).
      msgref: (props: MentionProps) => {
        const id = mentionId(props)
        return (
          <button
            type="button"
            disabled={!(id && onCitationJump)}
            onClick={() => id && onCitationJump?.(id)}
            onPointerEnter={() => id && onCitationJump && prefetchLocation(id)}
            onFocus={() => id && onCitationJump && prefetchLocation(id)}
            className="inline-flex items-center rounded bg-primary/10 px-1 py-0.5 text-[0.82em] text-primary hover:bg-primary/20 disabled:cursor-default disabled:opacity-70"
          >
            {props.children}
          </button>
        )
      },
      callref: (props: MentionProps) => {
        const at =
          props["data-at"] ??
          (props.node?.properties?.dataAt as string | undefined)
        return (
          <CallCitation sessionId={mentionId(props)} atMs={Number(at) || 0}>
            {props.children}
          </CallCitation>
        )
      },
      mention: (props: MentionProps) => {
        const id = mentionId(props)
        const children = props.children
        if (id && BROADCAST_MENTION_IDS.has(id)) {
          return (
            <span className="cursor-default rounded-[3px] bg-mention px-0.5 font-medium text-primary box-decoration-clone">
              {children}
            </span>
          )
        }

        const pill = (
          <span className="cursor-pointer rounded-[3px] bg-mention px-0.5 font-medium text-primary box-decoration-clone transition-colors hover:bg-primary hover:text-primary-foreground">
            {children}
          </span>
        )
        const mention = id ? mentionById.get(id) : undefined
        if (!(id && mention)) return pill

        return (
          <UserHoverCard avatarColor={mention.avatarColor} userId={id}>
            {pill}
          </UserHoverCard>
        )
      },
    }),
    [mentionById, onCitationJump, prefetchLocation]
  )

  if (markdown.trim().length === 0) {
    return null
  }

  return (
    <div
      className={cn(
        "message-markdown break-words text-sm leading-snug text-foreground/90",
        editedAt && "[&>p:last-of-type]:inline",
        className
      )}
    >
      <NexusMessageMarkdown
        // Nexus supplies the code/math/mermaid/cjk plugin bundle and the
        // codeblock + table UI; only the dark theme is overridden to keep
        // parity with the rest of the app's chrome.
        shikiTheme={CODE_THEMES}
        // Keys here are matched by hast-util-sanitize against the HAST property
        // names, which rehype-raw camelCases — so it MUST be `dataId`/`dataUrl`,
        // not `data-id`/`data-url`. With the hyphenated form the attribute is
        // silently stripped and reaches the component as undefined (breaking
        // mention hover cards, [[msg:]] jumps, and [[src:]] links). to-jsx-runtime
        // converts the surviving `dataId` back to the `data-id` prop the
        // components read.
        allowedTags={{
          mention: ["dataId"],
          pageref: [],
          msgref: ["dataId"],
          srcref: ["dataUrl"],
          callref: ["dataId", "dataAt"],
        }}
        literalTagContent={[
          "mention",
          "pageref",
          "msgref",
          "srcref",
          "callref",
        ]}
        components={components}
      >
        {markdown}
      </NexusMessageMarkdown>
      {editedAt && (
        <span className="ml-1 text-[10px] leading-snug text-muted-foreground/50">
          (edited)
        </span>
      )}
    </div>
  )
})
