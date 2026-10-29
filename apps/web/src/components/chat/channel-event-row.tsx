import {
  ArrowUp02Icon,
  GitCommitIcon,
  GitForkIcon,
  HashtagIcon,
  Infinity01Icon,
  SourceCodeIcon,
  Undo02Icon,
  ZapIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { describeLoopSchedule } from "@repo/realtime-types/loops"
import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/avatar"
import { HeightTransition } from "@repo/ui/components/height-transition"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@repo/ui/components/preview-card"
import { Skeleton } from "@repo/ui/components/skeleton"
import { cn } from "@repo/ui/lib/utils"
import { getAvatarInitials } from "@repo/utils/avatar-colors"
import { formatDateTime, formatTime, timeAgo } from "@repo/utils/date"
import { useQuery } from "@tanstack/react-query"
import { Link, useParams } from "@tanstack/react-router"
import { type ReactNode, useState } from "react"
import { PrivateHashIcon } from "@/components/ui/private-hash-icon"
import { UserHoverCard } from "@/components/ui/user-profile-card"
import { agentSessionQueryOptions } from "@/hooks/use-agent-session"
import { channelLoopsQueryOptions } from "@/hooks/use-channel-loops"
import { apiClient } from "@/lib/api-client"
import type { Message } from "@/lib/api-types"

// Channel events ("Jacob created this channel", "Alice was added") — compact
// system rows in the feed, iconless text on the message-content axis. See
// reference/channel-events.md.

// Wire shapes of eventPayload per kind (mirrors @repo/db ChannelEventPayload —
// the union isn't discriminated, so kinds narrow via these).
type CreatedPayload = {
  via?: "proposal"
  originChannelId?: string
  originChannelName?: string
}
type RenamedPayload = { from: string; to: string }
type AddedPayload = { userIds: string[] }
type RemovedPayload = { userId: string }
type LoopPayload = {
  loopId: string
  loopName: string
  reason?: "failures" | "out_of_credits"
  via?: "proposal"
}
type TriggerRunPayload = { triggerId: string; label: string }
type SessionContinuedPayload = {
  sessionId: string
  repoFullName: string | null
}
type SessionCommittedPayload = {
  sha: string
  subject: string
  branch: string | null
  fileCount: number
}
type SessionPushedPayload = {
  repoFullName: string
  branch: string
  commitCount: number
  headSha: string
}
type SessionForkedPayload = { sessionId: string; fromMessageId: string }

export type ResolveUserName = (userId: string) => string | undefined

function Name({ children }: { children: ReactNode }) {
  return <span className="font-medium text-foreground/80">{children}</span>
}

const HOVER_NAME_CLASS =
  "cursor-pointer font-medium text-foreground/80 underline-offset-2 hover:underline"

// A user's name in event copy — a 500ms hover opens the profile card
// (Notion-mention style), same card the avatar popover shows.
function UserName({
  userId,
  avatarColor,
  children,
}: {
  userId: string
  avatarColor?: string | null
  children: ReactNode
}) {
  return (
    <UserHoverCard userId={userId} avatarColor={avatarColor}>
      <span className={HOVER_NAME_CLASS}>{children}</span>
    </UserHoverCard>
  )
}

// A loop's name in event copy — a 500ms hover shows the loop's schedule/status,
// resolved from the channel-loops cache (fetch mounts only when the card opens).
function LoopName({
  channelId,
  loopId,
  children,
}: {
  channelId: string
  loopId: string
  children: ReactNode
}) {
  return (
    <HoverCard>
      <HoverCardTrigger
        delay={500}
        closeDelay={100}
        render={<span className={HOVER_NAME_CLASS} />}
      >
        {children}
      </HoverCardTrigger>
      <HoverCardContent side="top" align="start" className="w-72">
        <LoopHoverContent channelId={channelId} loopId={loopId} />
      </HoverCardContent>
    </HoverCard>
  )
}

// The code session a "Continue in Code" event points at.
function SessionLink({
  sessionId,
  children,
}: {
  sessionId: string
  children: ReactNode
}) {
  const { workspaceSlug } = useParams({ strict: false })
  if (!workspaceSlug) return <Name>{children}</Name>
  return (
    <Link
      to="/$workspaceSlug/session/$sessionId"
      params={{ workspaceSlug, sessionId }}
      className={HOVER_NAME_CLASS}
    >
      {children}
    </Link>
  )
}

// Another session by its current title (renames and Lor's generated title
// show), shared with that session's page cache.
function SessionTitleLink({
  sessionId,
  fallback,
}: {
  sessionId: string
  fallback: string
}) {
  const { data } = useQuery(agentSessionQueryOptions(sessionId))
  return (
    <SessionLink sessionId={sessionId}>
      {data?.session.title ?? fallback}
    </SessionLink>
  )
}

// A channel reference in event copy — 500ms hover previews the channel
// (topic, private/archived state); click navigates to it. Shares the channel
// page's ["channel", slug, id] query cache.
function ChannelName({
  channelId,
  children,
}: {
  channelId: string
  children: ReactNode
}) {
  const { workspaceSlug } = useParams({ strict: false })
  return (
    <HoverCard>
      <HoverCardTrigger
        delay={500}
        closeDelay={100}
        render={
          workspaceSlug ? (
            <Link
              to="/$workspaceSlug/$channelId"
              params={{ workspaceSlug, channelId }}
              className={HOVER_NAME_CLASS}
            />
          ) : (
            <span className={HOVER_NAME_CLASS} />
          )
        }
      >
        {children}
      </HoverCardTrigger>
      <HoverCardContent side="top" align="start" className="w-72">
        {workspaceSlug ? (
          <ChannelHoverContent
            workspaceSlug={workspaceSlug}
            channelId={channelId}
          />
        ) : null}
      </HoverCardContent>
    </HoverCard>
  )
}

function ChannelHoverContent({
  workspaceSlug,
  channelId,
}: {
  workspaceSlug: string
  channelId: string
}) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["channel", workspaceSlug, channelId],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].$get({ param: { workspaceSlug, channelId } })
      if (!res.ok) throw new Error("Failed to fetch channel")
      return res.json()
    },
  })

  if (isPending) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-36 rounded" />
        <Skeleton className="h-3 w-24 rounded" />
      </div>
    )
  }
  if (isError || !data) {
    return (
      <div className="text-sm text-muted-foreground">
        This channel is private or no longer exists.
      </div>
    )
  }

  const isPrivate = data.audience === "members"
  const meta = [
    isPrivate ? "Private channel" : null,
    data.archivedAt ? "Archived" : null,
    `Created ${formatDateTime(data.createdAt)}`,
  ].filter(Boolean)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        {isPrivate ? (
          <PrivateHashIcon className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <HugeiconsIcon
            icon={HashtagIcon}
            size={15}
            className="shrink-0 text-muted-foreground"
          />
        )}
        <span className="min-w-0 truncate text-sm font-semibold">
          {data.name}
        </span>
      </div>
      {data.topic ? (
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {data.topic}
        </p>
      ) : null}
      <div className="text-xs text-muted-foreground/70">{meta.join(" · ")}</div>
    </div>
  )
}

function LoopHoverContent({
  channelId,
  loopId,
}: {
  channelId: string
  loopId: string
}) {
  const { data, isPending } = useQuery(channelLoopsQueryOptions(channelId))
  const loop = data?.find((candidate) => candidate.id === loopId)

  if (isPending) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-36 rounded" />
        <Skeleton className="h-3 w-24 rounded" />
      </div>
    )
  }
  if (!loop) {
    return (
      <div className="text-sm text-muted-foreground">
        This loop no longer exists.
      </div>
    )
  }

  const scheduleText = describeLoopSchedule(loop.schedule, null)
  const isLive = loop.status === "active" || loop.status === "draft"
  const lead =
    loop.status === "paused"
      ? `Paused · ${scheduleText}`
      : loop.status === "completed"
        ? `Completed · ${scheduleText}`
        : scheduleText

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <HugeiconsIcon
          icon={Infinity01Icon}
          size={15}
          className={cn(
            "shrink-0",
            isLive ? "text-primary" : "text-muted-foreground"
          )}
        />
        <span className="min-w-0 truncate text-sm font-semibold">
          {loop.name}
        </span>
      </div>
      <div className="text-xs text-muted-foreground">{lead}</div>
      {loop.status === "active" && loop.nextRunAt ? (
        <div className="text-xs text-muted-foreground">
          Next run {formatDateTime(loop.nextRunAt)}
        </div>
      ) : null}
      {loop.lastRunAt ? (
        <div className="text-xs text-muted-foreground">
          Last ran {timeAgo(loop.lastRunAt)}
        </div>
      ) : null}
    </div>
  )
}

function joinNodes(nodes: ReactNode[]): ReactNode[] {
  return nodes.flatMap((node, i) => {
    if (i === 0) return [node]
    const sep = i === nodes.length - 1 ? " and " : ", "
    return [sep, node]
  })
}

function memberNames(
  userIds: string[],
  resolveUserName?: ResolveUserName
): ReactNode[] {
  return userIds.map((id) => (
    <UserName key={id} userId={id}>
      {resolveUserName?.(id) ?? "a teammate"}
    </UserName>
  ))
}

// One event's sentence, payload-driven. Falls back to the server-built plain
// content for unknown kinds / missing payloads (forward compat).
function eventText(
  message: Message,
  resolveUserName?: ResolveUserName,
  // Session rows: the event's icon, between the person and the verb.
  afterActor?: ReactNode
): ReactNode {
  const actor = (
    <>
      <UserName
        userId={message.authorId}
        avatarColor={message.author.avatarColor}
      >
        {message.author.name}
      </UserName>
      {afterActor}
    </>
  )
  const payload = message.eventPayload

  switch (message.eventType) {
    case "channel_created": {
      const p = (payload ?? {}) as CreatedPayload
      if (p.via === "proposal") {
        return (
          <>
            {actor} created this channel from an approved change proposal
            {p.originChannelName ? (
              <>
                {" in "}
                {p.originChannelId ? (
                  <ChannelName channelId={p.originChannelId}>
                    #{p.originChannelName}
                  </ChannelName>
                ) : (
                  <Name>#{p.originChannelName}</Name>
                )}
              </>
            ) : null}
          </>
        )
      }
      return <>{actor} created this channel</>
    }
    case "channel_renamed": {
      if (!payload) break
      const p = payload as RenamedPayload
      // The old name no longer resolves to anything — plain text; the new
      // name is the channel itself.
      return (
        <>
          {actor} renamed the channel from <Name>#{p.from}</Name> to{" "}
          <ChannelName channelId={message.channelId}>#{p.to}</ChannelName>
        </>
      )
    }
    case "member_added": {
      if (!payload) break
      const p = payload as AddedPayload
      return (
        <>
          {actor} added {joinNodes(memberNames(p.userIds, resolveUserName))}
        </>
      )
    }
    case "member_removed": {
      if (!payload) break
      const p = payload as RemovedPayload
      return (
        <>
          {actor} removed {memberNames([p.userId], resolveUserName)}
        </>
      )
    }
    case "member_left":
      return <>{actor} left the channel</>
    case "loop_created": {
      if (!payload) break
      const p = payload as LoopPayload
      return (
        <>
          {actor} created the loop{" "}
          <LoopName channelId={message.channelId} loopId={p.loopId}>
            {p.loopName}
          </LoopName>
          {p.via === "proposal" ? " from an approved change proposal" : null}
        </>
      )
    }
    case "loop_paused": {
      if (!payload) break
      const p = payload as LoopPayload
      return (
        <>
          The loop{" "}
          <LoopName channelId={message.channelId} loopId={p.loopId}>
            {p.loopName}
          </LoopName>{" "}
          was paused
          {p.reason === "out_of_credits"
            ? " — out of credits"
            : " after repeated failures"}
        </>
      )
    }
    case "loop_completed": {
      if (!payload) break
      const p = payload as LoopPayload
      return (
        <>
          {actor} completed the loop{" "}
          <LoopName channelId={message.channelId} loopId={p.loopId}>
            {p.loopName}
          </LoopName>
        </>
      )
    }
    case "loop_run": {
      if (!payload) break
      const p = payload as LoopPayload
      return (
        <>
          The loop{" "}
          <LoopName channelId={message.channelId} loopId={p.loopId}>
            {p.loopName}
          </LoopName>{" "}
          ran on schedule
        </>
      )
    }
    case "session_continued": {
      if (!payload) break
      const p = payload as SessionContinuedPayload
      return (
        <>
          {actor} continued this in{" "}
          <SessionTitleLink
            sessionId={p.sessionId}
            fallback={`a code session${p.repoFullName ? ` on ${p.repoFullName}` : ""}`}
          />
        </>
      )
    }
    case "session_committed": {
      if (!payload) break
      const p = payload as SessionCommittedPayload
      return (
        <>
          {actor} committed {p.fileCount} {p.fileCount === 1 ? "file" : "files"}
          {p.branch ? (
            <>
              {" "}
              to <Name>{p.branch}</Name>
            </>
          ) : null}
          : {p.subject}{" "}
          <span className="font-mono text-xs">{p.sha.slice(0, 7)}</span>
        </>
      )
    }
    case "session_pushed": {
      if (!payload) break
      const p = payload as SessionPushedPayload
      return (
        <>
          {actor} pushed {p.commitCount}{" "}
          {p.commitCount === 1 ? "commit" : "commits"} to{" "}
          <Name>{p.branch}</Name>{" "}
          <a
            href={`https://github.com/${p.repoFullName}/commit/${p.headSha}`}
            target="_blank"
            rel="noreferrer"
            className={cn(HOVER_NAME_CLASS, "font-mono text-xs")}
          >
            {p.headSha.slice(0, 7)}
          </a>
        </>
      )
    }
    // The fork's heading links back to the reply it was forked at.
    case "session_forked": {
      if (!payload) break
      const p = payload as SessionForkedPayload
      return (
        <>
          {actor} forked this session into{" "}
          <SessionTitleLink sessionId={p.sessionId} fallback="a new session" />
        </>
      )
    }
    // Sessions show it right under the reply it went back to, folding the
    // turns after it (rewound-turns.tsx).
    case "session_rewound":
      return <>{actor} rewound to here</>
    // Content is the event payload Lor reads, never shown as the line.
    case "trigger_run": {
      const p = payload as TriggerRunPayload | null
      return (
        <>
          <Name>{p?.label ?? "An automation"}</Name> started this session
        </>
      )
    }
  }
  return message.content
}

// Collapsed sentence for a run of same-kind member events ("Jacob added Alice
// and Bob", "Alice and Bob left the channel").
function groupText(
  events: Message[],
  resolveUserName?: ResolveUserName
): ReactNode {
  const first = events[0]
  if (!first) return null
  const kind = first.eventType
  const actorIds = new Set(events.map((e) => e.authorId))
  const sameActor = actorIds.size === 1
  const actor = (
    <UserName userId={first.authorId} avatarColor={first.author.avatarColor}>
      {first.author.name}
    </UserName>
  )

  if (kind === "member_added") {
    const userIds = [
      ...new Set(
        events.flatMap((e) => (e.eventPayload as AddedPayload)?.userIds ?? [])
      ),
    ]
    const names = joinNodes(memberNames(userIds, resolveUserName))
    return sameActor ? (
      <>
        {actor} added {names}
      </>
    ) : (
      <>{names} were added</>
    )
  }
  if (kind === "member_removed") {
    const userIds = events
      .map((e) => (e.eventPayload as RemovedPayload | null)?.userId)
      .filter((id): id is string => typeof id === "string")
    const names = joinNodes(memberNames(userIds, resolveUserName))
    return sameActor ? (
      <>
        {actor} removed {names}
      </>
    ) : (
      <>{names} were removed</>
    )
  }
  // member_left — the actors ARE the subjects.
  const names = joinNodes(
    events.map((e) => (
      <UserName
        key={e.id}
        userId={e.authorId}
        avatarColor={e.author.avatarColor}
      >
        {e.author.name}
      </UserName>
    ))
  )
  return <>{names} left the channel</>
}

// Only membership churn collapses — renames and loop lifecycle stay one row
// each. Keep in sync with the grouping pass in message-list.
export function isCollapsibleChannelEvent(message: Message): boolean {
  return (
    message.type === "event" &&
    (message.eventType === "member_added" ||
      message.eventType === "member_removed" ||
      message.eventType === "member_left")
  )
}

interface ChannelEventRowProps {
  // One or more consecutive same-kind events (only member kinds arrive >1).
  events: Message[]
  resolveUserName?: ResolveUserName
  // A session's document rows have a 28px avatar gutter, chat's 40px.
  layout?: "chat" | "document"
}

// Session events (Jacob 2026-10-24): the person's avatar before their name
// and the event's icon inline before the verb ("tester ⑂ forked…"). Channel
// chat keeps the iconless row.
const SESSION_EVENT_ICONS: Partial<
  Record<NonNullable<Message["eventType"]>, IconSvgElement>
> = {
  session_continued: SourceCodeIcon,
  session_committed: GitCommitIcon,
  session_pushed: ArrowUp02Icon,
  session_forked: GitForkIcon,
  session_rewound: Undo02Icon,
  loop_run: Infinity01Icon,
  trigger_run: ZapIcon,
}

// The events whose sentence starts with the person who did it.
const ACTOR_EVENTS: ReadonlySet<string> = new Set([
  "session_continued",
  "session_committed",
  "session_pushed",
  "session_forked",
  "session_rewound",
])

export function SessionEventRow({
  message,
  icon = message.eventType ? SESSION_EVENT_ICONS[message.eventType] : undefined,
  resolveUserName,
  trailing,
}: {
  message: Message
  icon?: IconSvgElement
  resolveUserName?: ResolveUserName
  // After the sentence, before the time (the folded turns' "Show").
  trailing?: ReactNode
}) {
  const { author } = message
  const byPerson = Boolean(
    message.eventType && ACTOR_EVENTS.has(message.eventType)
  )
  // After a name the sentence's own space follows; leading, it needs one.
  const inlineIcon = icon ? (
    <HugeiconsIcon
      icon={icon}
      size={13}
      strokeWidth={2}
      className={cn("inline align-[-2px]", byPerson ? "ml-1" : "mr-1")}
    />
  ) : null
  return (
    <div className="group/event mt-1 flex items-center gap-3 px-4 py-0.5">
      {/* Empty gutter: the row starts on the message-content axis. */}
      <div className="w-7 shrink-0" />
      <div className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
        {byPerson && (
          <Avatar className="size-4 shrink-0">
            {author.image && <AvatarImage src={author.image} alt="" />}
            <AvatarFallback
              avatarColor={author.avatarColor}
              fallbackSeed={author.name}
              className="font-semibold text-[7px]"
            >
              {getAvatarInitials(author.name)}
            </AvatarFallback>
          </Avatar>
        )}
        <span className="min-w-0">
          {!byPerson && inlineIcon}
          {eventText(
            message,
            resolveUserName,
            byPerson ? inlineIcon : undefined
          )}
          {trailing}
          <span className="ml-1.5 text-[11px] text-muted-foreground/50 opacity-0 transition-opacity group-hover/event:opacity-100">
            {formatTime(message.createdAt)}
          </span>
        </span>
      </div>
    </div>
  )
}

export function ChannelEventRow({
  events,
  resolveUserName,
  layout = "chat",
}: ChannelEventRowProps) {
  const [expanded, setExpanded] = useState(false)
  const first = events[0]
  if (!first) return null

  const sessionIcon = first.eventType
    ? SESSION_EVENT_ICONS[first.eventType]
    : undefined
  if (layout === "document" && sessionIcon && events.length === 1) {
    return (
      <SessionEventRow
        message={first}
        icon={sessionIcon}
        resolveUserName={resolveUserName}
      />
    )
  }

  const collapsed = events.length > 1 && !expanded
  const rows = collapsed ? [events] : events.map((event) => [event])

  return (
    <HeightTransition contentKey={collapsed ? "grouped" : "each"} fadeIn>
      {rows.map((row) => {
        const message = row[0]
        if (!message) return null
        const text =
          row.length > 1
            ? groupText(row, resolveUserName)
            : eventText(message, resolveUserName)
        const time = formatTime(row[row.length - 1]?.createdAt ?? "")
        const expandHint = collapsed ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="cursor-pointer text-muted-foreground/60 underline-offset-2 hover:underline"
          >
            show each
          </button>
        ) : null

        // Empty gutter keeps the text on the message-content axis (locked
        // 2026-09-05: gutter layout, no icon).
        return (
          <div
            key={message.id}
            className={cn(
              "group/event flex items-center gap-3 px-4 py-1",
              layout === "document" ? "mt-3" : "my-2 hover:bg-muted/40"
            )}
          >
            <div
              className={cn("shrink-0", layout === "document" ? "w-7" : "w-10")}
            />
            <div className="min-w-0 text-xs text-muted-foreground">
              {text} {expandHint}
              <span className="ml-1.5 text-[11px] text-muted-foreground/50 opacity-0 transition-opacity group-hover/event:opacity-100">
                {time}
              </span>
            </div>
          </div>
        )
      })}
    </HeightTransition>
  )
}
