import { type ReactNode, useState } from "react"
import { Text, View } from "react-native"
import type { Message } from "@/lib/api-types"

// Channel events ("Jacob created this channel", "Alice was added") — compact
// iconless system rows mirroring web's ChannelEventRow. See
// reference/channel-events.md; keep copy in sync with the web renderer.

type CreatedPayload = { via?: "proposal"; originChannelName?: string }
type RenamedPayload = { from: string; to: string }
type AddedPayload = { userIds: string[] }
type RemovedPayload = { userId: string }
type LoopPayload = {
  loopId: string
  loopName: string
  reason?: "failures" | "out_of_credits"
}

export type ResolveUserName = (userId: string) => string | undefined

function Name({ children }: { children: ReactNode }) {
  return <Text className="font-semibold text-muted">{children}</Text>
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

export function ChannelEventRow({
  events,
  resolveUserName,
}: {
  events: Message[]
  resolveUserName?: ResolveUserName
}) {
  const [expanded, setExpanded] = useState(false)
  const first = events[0]
  if (!first) return null

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
