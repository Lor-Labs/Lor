import {
  ArrowRight01Icon,
  BubbleChatIcon,
  GitForkIcon,
  HashtagIcon,
  MessageQuestionIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import type { RealtimeAgentSession } from "@repo/realtime-types"
import { cn } from "@repo/ui/lib/utils"
import { differenceInMinutes, isSameDay } from "@repo/utils/date"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { type ReactNode, useState } from "react"
import { ChannelEventRow } from "@/components/chat/channel-event-row"
import { MessageItem } from "@/components/chat/message-item"
import {
  type SessionContextSegment,
  sessionContextQueryOptions,
} from "@/hooks/use-agent-session"
import type { Message } from "@/lib/api-types"

// What Lor started the session with, folded at the top of its transcript:
// a fork's conversation up to the forked reply (up the fork chain), a
// continued session's newest messages, the chat before `@Lor`, or the
// "Ask Lor about this" message. The real messages, read-only. Replaces the
// plain "Forked from" line (Jacob 2026-11-03: people couldn't tell what Lor
// was given). Collapsed with a count, except an asked-about message.

const GROUP_WINDOW_MINUTES = 5

type Kind = SessionContextSegment["kind"]

const KIND_ICON: Record<Kind, IconSvgElement> = {
  fork: GitForkIcon,
  continued: BubbleChatIcon,
  conversation: HashtagIcon,
  asked: MessageQuestionIcon,
}

const KIND_NOTE: Record<Kind, string> = {
  fork: "Lor has this conversation up to the reply it was forked from",
  continued: "Lor started with the newest messages from that session",
  conversation: "Lor started with the chat that led up to @Lor",
  asked: "Lor started with this message",
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`
}

export function SessionContextFold({
  session,
  source,
  channelName,
  workspaceSlug,
}: {
  session: RealtimeAgentSession
  source: { id: string; title: string } | null
  channelName: string
  workspaceSlug: string
}) {
  const mayHaveContext =
    session.sourceSessionId !== null ||
    session.origin === "chat" ||
    session.origin === "new"
  const { data } = useQuery({
    ...sessionContextQueryOptions(session.id),
    enabled: mayHaveContext,
  })
  const segments = data?.segments ?? []
  const newest = segments.at(-1)
  const [open, setOpen] = useState<boolean | null>(null)

  if (!newest) {
    // Loading, or nothing readable: the source still shows as a link.
    return source ? (
      <SourceLine
        session={session}
        source={source}
        workspaceSlug={workspaceSlug}
      />
    ) : null
  }

  const expanded = open ?? newest.kind === "asked"
  const count = segments.reduce(
    (total, segment) =>
      total +
      segment.omitted +
      segment.messages.filter((message) => message.type !== "event").length,
    0
  )
  const sourceLink = (title: string, id: string, msgId?: string | null) => (
    <Link
      to="/$workspaceSlug/session/$sessionId"
      params={{ workspaceSlug, sessionId: id }}
      search={msgId ? { msgId } : {}}
      title={title}
      className="relative z-10 min-w-0 truncate font-medium text-foreground underline-offset-2 hover:underline"
    >
      {title}
    </Link>
  )
  const heading: ReactNode =
    newest.kind === "fork" && newest.session ? (
      <>
        <span className="shrink-0">Forked from</span>
        {sourceLink(
          newest.session.title,
          newest.session.id,
          session.forkedFromMessageId
        )}
      </>
    ) : newest.kind === "continued" && newest.session ? (
      <>
        <span className="shrink-0">Continued from</span>
        {sourceLink(newest.session.title, newest.session.id)}
      </>
    ) : newest.kind === "asked" ? (
      <span className="shrink-0">Asked about a message in #{channelName}</span>
    ) : (
      <span className="shrink-0">Started from #{channelName}</span>
    )

  return (
    <div className="mt-4 rounded-xl border border-border/70 bg-muted/35">
      <div
        className={cn(
          "relative flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60",
          expanded ? "rounded-t-xl" : "rounded-xl"
        )}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background/70 text-muted-foreground">
          <HugeiconsIcon
            icon={KIND_ICON[newest.kind]}
            className="size-3.5"
            strokeWidth={2}
            aria-hidden="true"
          />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 items-baseline gap-1.5 text-foreground text-sm">
            {heading}
            <span className="shrink-0 text-muted-foreground text-xs">
              {plural(count, "message")}
            </span>
          </span>
          <span className="truncate text-muted-foreground text-xs">
            {KIND_NOTE[newest.kind]}
          </span>
        </span>
        {/* Stretched over the row; the source link sits above it. */}
        <button
          type="button"
          onClick={() => setOpen(!expanded)}
          aria-expanded={expanded}
          className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md text-muted-foreground text-xs outline-none transition-colors after:absolute after:inset-0 after:rounded-xl hover:text-foreground focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
        >
          {expanded ? "Hide" : "View"}
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            className={cn(
              "size-3.5 transition-transform duration-200 ease-out motion-reduce:transition-none",
              expanded && "rotate-90"
            )}
            strokeWidth={2}
            aria-hidden="true"
          />
        </button>
      </div>
      {expanded && (
        <div className="fade-in-0 animate-in border-border/70 border-t pt-1 pb-3 duration-200 ease-out motion-reduce:animate-none">
          {segments.map((segment, index) => (
            <ContextSegment
              key={`${segment.kind}-${segment.session?.id ?? index}`}
              segment={segment}
              labelled={segments.length > 1}
              channelName={channelName}
              workspaceSlug={workspaceSlug}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ContextSegment({
  segment,
  labelled,
  channelName,
  workspaceSlug,
}: {
  segment: SessionContextSegment
  // A fork chain: each conversation says where it's from.
  labelled: boolean
  channelName: string
  workspaceSlug: string
}) {
  const { data: auth } = authClient.useSession()
  const layout =
    segment.kind === "fork" || segment.kind === "continued"
      ? "document"
      : "chat"
  const messages = segment.messages as Message[]
  const from = segment.session
    ? `“${segment.session.title}”`
    : `#${channelName}`
  return (
    <div>
      {labelled && (
        <p className="px-4 pt-3 pb-1 font-medium text-muted-foreground text-xs">
          {segment.kind === "fork" ? `In ${from}` : `From ${from}`}
        </p>
      )}
      {segment.omitted > 0 && (
        <p className="px-4 pt-2 pb-1 text-muted-foreground text-xs">
          {plural(segment.omitted, "earlier message")} not shown
          {segment.session && (
            <>
              {" · "}
              <Link
                to="/$workspaceSlug/session/$sessionId"
                params={{ workspaceSlug, sessionId: segment.session.id }}
                className="font-medium text-foreground underline-offset-2 hover:underline"
              >
                Open
              </Link>
            </>
          )}
        </p>
      )}
      {messages.map((message, index) => {
        const prev = messages[index - 1]
        if (message.type === "event") {
          return (
            <ChannelEventRow
              key={message.id}
              events={[message]}
              layout={layout}
            />
          )
        }
        const showHeader =
          !prev ||
          prev.type === "event" ||
          prev.authorId !== message.authorId ||
          !isSameDay(message.createdAt, prev.createdAt) ||
          differenceInMinutes(message.createdAt, prev.createdAt) >
            GROUP_WINDOW_MINUTES
        return (
          <MessageItem
            key={message.id}
            message={message}
            showHeader={showHeader}
            wrapContentAroundAvatar={layout === "chat"}
            layout={layout}
            currentUserId={auth?.user.id}
            readOnly
          />
        )
      })}
    </div>
  )
}

// The source as a plain link while the fold loads, or when its messages
// can't be read.
function SourceLine({
  session,
  source,
  workspaceSlug,
}: {
  session: RealtimeAgentSession
  source: { id: string; title: string }
  workspaceSlug: string
}) {
  return (
    <div className="mt-2 flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
      <HugeiconsIcon
        icon={session.forkedFromMessageId ? GitForkIcon : BubbleChatIcon}
        className="size-3.5 shrink-0"
        strokeWidth={2}
        aria-hidden="true"
      />
      <span className="shrink-0">
        {session.forkedFromMessageId ? "Forked from" : "Continued from"}
      </span>
      <Link
        to="/$workspaceSlug/session/$sessionId"
        params={{ workspaceSlug, sessionId: source.id }}
        // A fork opens its source at the reply it was forked from.
        search={
          session.forkedFromMessageId
            ? { msgId: session.forkedFromMessageId }
            : {}
        }
        title={source.title}
        className="min-w-0 truncate font-medium transition-colors hover:text-foreground"
      >
        {source.title}
      </Link>
    </div>
  )
}
