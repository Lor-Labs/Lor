import ArrowUp02Icon from "@hugeicons/core-free-icons/ArrowUp02Icon"
import GitCommitIcon from "@hugeicons/core-free-icons/GitCommitIcon"
import GitForkIcon from "@hugeicons/core-free-icons/GitForkIcon"
import Infinity01Icon from "@hugeicons/core-free-icons/Infinity01Icon"
import SourceCodeIcon from "@hugeicons/core-free-icons/SourceCodeIcon"
import Undo02Icon from "@hugeicons/core-free-icons/Undo02Icon"
import ZapIcon from "@hugeicons/core-free-icons/ZapIcon"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native"
import { router } from "expo-router"
import { useThemeColor } from "heroui-native/hooks"
import { type ReactNode, useState } from "react"
import { Linking, Text, View } from "react-native"
import { useAgentSession } from "@/hooks/use-agent-session"
import type { Message } from "@/lib/api-types"

// Channel events ("Jacob created this channel", "Alice was added") — compact
// iconless system rows mirroring web's ChannelEventRow. See
// reference/channel-events.md; keep copy in sync with the web renderer.
// In a session ("document" layout) they carry the event's icon, like web's
// SessionEventRow.

type CreatedPayload = { via?: "proposal"; originChannelName?: string }
type RenamedPayload = { from: string; to: string }
type AddedPayload = { userIds: string[] }
type RemovedPayload = { userId: string }
type LoopPayload = {
  loopId: string
  loopName: string
  reason?: "failures" | "out_of_credits"
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
  return <Text className="font-semibold text-muted">{children}</Text>
}

// Another session by its current title (renames and Lor's generated title
// show); a tap opens it.
function SessionTitleLink({
  sessionId,
  fallback,
}: {
  sessionId: string
  fallback: string
}) {
  const { data } = useAgentSession(sessionId)
  return (
    <Text
      accessibilityRole="link"
      className="font-semibold text-muted underline"
      onPress={() =>
        router.push({
          pathname: "/session/[sessionId]",
          params: { sessionId },
        })
      }
      suppressHighlighting
    >
      {data?.session.title ?? fallback}
    </Text>
  )
}

function ShortSha({ sha, href }: { sha: string; href?: string }) {
  return (
    <Text
      accessibilityRole={href ? "link" : undefined}
      className={`font-mono text-xs text-muted ${href ? "underline" : ""}`}
      onPress={href ? () => void Linking.openURL(href) : undefined}
      suppressHighlighting
    >
      {sha.slice(0, 7)}
    </Text>
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
    <Name key={id}>{resolveUserName?.(id) ?? "a teammate"}</Name>
  ))
}

function eventText(
  message: Message,
  resolveUserName?: ResolveUserName
): ReactNode {
  const actor = <Name>{message.author.name}</Name>
  const payload = message.eventPayload

  switch (message.eventType) {
    case "channel_created": {
      const p = (payload ?? {}) as CreatedPayload
      if (p.via === "proposal") {
        return (
          <>
            {actor} created this channel from an approved change proposal
            {p.originChannelName ? ` in #${p.originChannelName}` : null}
          </>
        )
      }
      return <>{actor} created this channel</>
    }
    case "channel_renamed": {
      if (!payload) break
      const p = payload as RenamedPayload
      return (
        <>
          {actor} renamed the channel from <Name>#{p.from}</Name> to{" "}
          <Name>#{p.to}</Name>
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
          {actor} created the loop <Name>{p.loopName}</Name>
        </>
      )
    }
    case "loop_paused": {
      if (!payload) break
      const p = payload as LoopPayload
      return (
        <>
          The loop <Name>{p.loopName}</Name> was paused
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
          {actor} completed the loop <Name>{p.loopName}</Name>
        </>
      )
    }
    case "loop_run": {
      if (!payload) break
      const p = payload as LoopPayload
      return (
        <>
          The loop <Name>{p.loopName}</Name> ran on schedule
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
            fallback={`a code session${p.repoFullName ? ` on ${p.repoFullName}` : ""}`}
            sessionId={p.sessionId}
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
          : {p.subject} <ShortSha sha={p.sha} />
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
          <ShortSha
            href={`https://github.com/${p.repoFullName}/commit/${p.headSha}`}
            sha={p.headSha}
          />
        </>
      )
    }
    case "session_forked": {
      if (!payload) break
      const p = payload as SessionForkedPayload
      return (
        <>
          {actor} forked this session into{" "}
          <SessionTitleLink fallback="a new session" sessionId={p.sessionId} />
        </>
      )
    }
    // A session folds the turns after it under the "Previous history" row
    // (thread-message-list.tsx); this line shows only outside one.
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

function groupText(
  events: Message[],
  resolveUserName?: ResolveUserName
): ReactNode {
  const kind = events[0]?.eventType
  const sameActor = new Set(events.map((e) => e.authorId)).size === 1
  const actor = <Name>{events[0]?.author.name}</Name>

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
  const names = joinNodes(
    events.map((e) => <Name key={e.id}>{e.author.name}</Name>)
  )
  return <>{names} left the channel</>
}

// Only membership churn collapses — keep in sync with web's message-list pass.
export function isCollapsibleChannelEvent(message: Message): boolean {
  return (
    message.type === "event" &&
    (message.eventType === "member_added" ||
      message.eventType === "member_removed" ||
      message.eventType === "member_left")
  )
}

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

// One event in a session's transcript: its icon, then the sentence, on the
// messages' content axis (a session's gutter is narrower than chat's).
function SessionEventRow({
  message,
  icon,
  resolveUserName,
}: {
  message: Message
  icon: IconSvgElement
  resolveUserName?: ResolveUserName
}) {
  const muted = useThemeColor("muted")
  return (
    <View className="mt-one flex-row items-start gap-three px-four py-one">
      <View className="w-7" />
      <View className="min-w-0 flex-1 flex-row gap-two">
        <View className="pt-[2px]">
          <HugeiconsIcon color={muted} icon={icon} size={13} strokeWidth={2} />
        </View>
        <Text className="min-w-0 flex-1 text-xs text-muted">
          {eventText(message, resolveUserName)}
        </Text>
      </View>
    </View>
  )
}

export function ChannelEventRow({
  events,
  resolveUserName,
  layout = "chat",
}: {
  events: Message[]
  resolveUserName?: ResolveUserName
  layout?: "chat" | "document"
}) {
  const [expanded, setExpanded] = useState(false)
  const first = events[0]
  if (!first) return null

  const sessionIcon = first.eventType
    ? SESSION_EVENT_ICONS[first.eventType]
    : undefined
  if (layout === "document" && sessionIcon && events.length === 1) {
    return (
      <SessionEventRow
        icon={sessionIcon}
        message={first}
        resolveUserName={resolveUserName}
      />
    )
  }

  const collapsed = events.length > 1 && !expanded
  const rows = collapsed ? [events] : events.map((event) => [event])

  return (
    <View>
      {rows.map((row) => {
        const message = row[0]
        if (!message) return null
        const text =
          row.length > 1
            ? groupText(row, resolveUserName)
            : eventText(message, resolveUserName)
        return (
          <View
            className="my-two flex-row items-center gap-three px-four py-one"
            key={message.id}
          >
            {/* Empty gutter keeps the text on the message-content axis. */}
            <View className="min-w-10" />
            <Text className="min-w-0 flex-1 text-xs text-muted">
              {text}
              {collapsed ? (
                <Text
                  className="text-xs text-muted underline"
                  onPress={() => setExpanded(true)}
                  suppressHighlighting
                >
                  {"  show each"}
                </Text>
              ) : null}
            </Text>
          </View>
        )
      })}
    </View>
  )
}
