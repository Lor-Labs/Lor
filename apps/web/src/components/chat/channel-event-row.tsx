import { formatTime } from "@repo/utils/date"
import { type ReactNode, useState } from "react"
import type { Message } from "@/lib/api-types"

// Channel events ("Jacob created this channel", "Alice was added") — compact
// system rows in the feed, iconless text on the message-content axis. See
// reference/channel-events.md.

// Wire shapes of eventPayload per kind (mirrors @repo/db ChannelEventPayload —
// the union isn't discriminated, so kinds narrow via these).
type CreatedPayload = {
  via?: "proposal"
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

export type ResolveUserName = (userId: string) => string | undefined

function Name({ children }: { children: ReactNode }) {
  return <span className="font-medium text-foreground/80">{children}</span>
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

// One event's sentence, payload-driven. Falls back to the server-built plain
// content for unknown kinds / missing payloads (forward compat).
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
          {p.via === "proposal" ? " from an approved change proposal" : null}
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
  }
  return message.content
}

// Collapsed sentence for a run of same-kind member events ("Jacob added Alice
// and Bob", "Alice and Bob left the channel").
function groupText(
  events: Message[],
  resolveUserName?: ResolveUserName
): ReactNode {
  const kind = events[0]?.eventType
  const actorIds = new Set(events.map((e) => e.authorId))
  const sameActor = actorIds.size === 1
  const actor = <Name>{events[0]?.author.name}</Name>

  if (kind === "member_added") {
    const userIds = [
      ...new Set(
        events.flatMap(
          (e) => ((e.eventPayload as AddedPayload) ?? {}).userIds ?? []
        )
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
    const userIds = events.map(
      (e) => ((e.eventPayload as RemovedPayload) ?? {}).userId
    )
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
    events.map((e) => <Name key={e.id}>{e.author.name}</Name>)
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
}

export function ChannelEventRow({
  events,
  resolveUserName,
}: ChannelEventRowProps) {
  const [expanded, setExpanded] = useState(false)
  const first = events[0]
  if (!first) return null

  const collapsed = events.length > 1 && !expanded
  const rows = collapsed ? [events] : events.map((event) => [event])

  return (
    <div>
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
            className="group/event flex items-center gap-3 px-4 py-1 hover:bg-muted/40"
          >
            <div className="w-10 shrink-0" />
            <div className="min-w-0 text-xs text-muted-foreground">
              {text} {expandHint}
              <span className="ml-1.5 text-[11px] text-muted-foreground/50 opacity-0 transition-opacity group-hover/event:opacity-100">
                {time}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
