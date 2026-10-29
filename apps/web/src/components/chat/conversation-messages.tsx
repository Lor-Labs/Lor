import { LOR_USER_ID } from "@repo/db/constants"
import { MessageScrollerItem } from "@repo/ui/components/message-scroller"
import { Skeleton } from "@repo/ui/components/skeleton"
import { Spinner } from "@repo/ui/components/spinner"
import { cn } from "@repo/ui/lib/utils"
import { differenceInMinutes, isSameDay } from "@repo/utils/date"
import {
  type ComponentProps,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { ChannelEventRow } from "@/components/chat/channel-event-row"
import { DateDivider } from "@/components/chat/date-divider"
import { MessageItem } from "@/components/chat/message-item"
import {
  type RewoundGroup,
  RewoundTurnsRow,
  rewoundGroups,
} from "@/components/chat/rewound-turns"
import { ARRIVE_IN, useAppendedIds } from "@/hooks/use-appended-ids"
import type { Message } from "@/lib/api-types"

const MESSAGE_GROUP_WINDOW_MINUTES = 5

const SKELETON_GROUPS = [
  { key: "a", nameWidth: "4.5rem", lines: ["75%", "40%"] },
  { key: "b", nameWidth: "6rem", lines: ["55%"] },
  { key: "c", nameWidth: "4rem", lines: ["85%", "30%"] },
  { key: "d", nameWidth: "5.5rem", lines: ["50%"] },
]

type ItemProps = Pick<
  ComponentProps<typeof MessageItem>,
  | "currentUserId"
  | "onReact"
  | "onReply"
  | "onDelete"
  | "onEdit"
  | "onJumpToMessage"
  | "mentionCandidates"
  | "onForward"
  | "onFork"
  | "onRewind"
  | "rewindRestoresFiles"
>

// A thread's or session's replies inside a MessageScrollerContent: the
// load-older sentinel, then a skeleton or the grouped replies. `document` is
// the session layout (gutter avatars, no name rows); `chat` the thread one.
export function ConversationMessages({
  layout,
  replies,
  isAwaitingReplies,
  hasOlder,
  isFetchingOlder,
  fetchOlder,
  scrollRef,
  anchorIds,
  replyingToId,
  itemProps,
}: {
  layout: "chat" | "document"
  // Oldest first.
  replies: Message[]
  isAwaitingReplies: boolean
  hasOlder: boolean
  isFetchingOlder: boolean
  fetchOlder: () => unknown
  scrollRef: RefObject<HTMLDivElement | null>
  anchorIds: Set<string>
  replyingToId: string | undefined
  itemProps: ItemProps
}) {
  const isDocument = layout === "document"
  // Sessions fold the turns a rewind set aside (rewound-turns.tsx).
  const groups = useMemo(
    () => (isDocument ? rewoundGroups(replies) : []),
    [isDocument, replies]
  )
  const appended = useAppendedIds(replies.map((msg) => msg.id))
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set())
  const toggleGroup = (id: string) =>
    setUnfolded((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const setAside = (index: number) =>
    groups.some((group) => index >= group.start && index <= group.end)
  const isLorReply = (msg: Message) =>
    msg.authorId === LOR_USER_ID &&
    (msg.type === "default" || msg.type === "reply")
  // The newest reply on the current line; earlier ones can be rewound to,
  // while Lor isn't working.
  let latestLorIndex = -1
  if (isDocument) {
    for (let i = replies.length - 1; i >= 0; i--) {
      const msg = replies[i]
      if (msg && isLorReply(msg) && !setAside(i)) {
        latestLorIndex = i
        break
      }
    }
  }
  const lorBusy = replies.some(
    (msg) =>
      msg.authorId === LOR_USER_ID &&
      (msg.streaming || msg.status === "pending")
  )
  const canRewindAt = (msg: Message, index: number) =>
    !lorBusy &&
    index < latestLorIndex &&
    isLorReply(msg) &&
    msg.status === "complete" &&
    !setAside(index)
  const renderReply = (msg: Message, i: number, history?: RewoundGroup) => {
    // Keep items as direct scroller children so message jumps still work.
    // Joined borders give the expanded history one continuous surface.
    const historyClassName = history
      ? cn(
          "mx-4 border-border/70 border-x bg-muted/35 fade-in-0 animate-in duration-200 ease-out",
          i === history.start && "pt-1",
          i === history.end - 1 && "mb-3 rounded-b-xl border-b pb-3"
        )
      : appended.has(msg.id)
        ? ARRIVE_IN
        : undefined
    const prev = replies[i - 1]
    const isDateBoundary = !prev || !isSameDay(msg.createdAt, prev.createdAt)
    const isWithinGroupWindow =
      !!prev &&
      differenceInMinutes(msg.createdAt, prev.createdAt) <=
        MESSAGE_GROUP_WINDOW_MINUTES
    // A session marks each new day like channel chat. Not above its first
    // message: the heading says when it started.
    const dayDivider =
      isDocument && prev && isDateBoundary ? (
        <div className="px-4">
          <DateDivider date={msg.createdAt} />
        </div>
      ) : null
    // Events (a loop's "ran on schedule" line) are muted rows that break the
    // author group, so Lor's reply after one keeps its avatar.
    if (msg.type === "event") {
      return (
        <MessageScrollerItem
          key={msg.id}
          messageId={msg.id}
          className={historyClassName}
        >
          {dayDivider}
          <ChannelEventRow events={[msg]} layout={layout} />
        </MessageScrollerItem>
      )
    }
    const showHeader =
      isDateBoundary ||
      !prev ||
      prev.authorId !== msg.authorId ||
      prev.type === "event" ||
      !isWithinGroupWindow
    return (
      <MessageScrollerItem
        key={msg.id}
        messageId={msg.id}
        scrollAnchor={anchorIds.has(msg.id)}
        className={historyClassName}
      >
        {dayDivider}
        <MessageItem
          {...itemProps}
          message={msg}
          showHeader={showHeader}
          wrapContentAroundAvatar={!isDocument}
          layout={layout}
          isReplyTarget={replyingToId === msg.id}
          isLatestLorReply={i === latestLorIndex}
          canRewind={canRewindAt(msg, i)}
        />
      </MessageScrollerItem>
    )
  }
  const olderSentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const sentinel = olderSentinelRef.current
    const container = scrollRef.current
    if (!sentinel || !container || !hasOlder) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingOlder) {
          void fetchOlder()
        }
      },
      { root: container, rootMargin: "200px" }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasOlder, isFetchingOlder, fetchOlder, scrollRef])

  return (
    <>
      {hasOlder && (
        <MessageScrollerItem>
          <div ref={olderSentinelRef} className="flex justify-center py-3">
            {isFetchingOlder && (
              <Spinner className="size-5 text-muted-foreground motion-reduce:animate-none" />
            )}
          </div>
        </MessageScrollerItem>
      )}

      {isAwaitingReplies ? (
        <MessageScrollerItem className="flex flex-col py-2">
          {SKELETON_GROUPS.map((group) => (
            <div
              key={group.key}
              className={cn("px-4", isDocument ? "pt-3" : "py-1")}
            >
              <div className="flex gap-3">
                {/* A session's skeleton matches its document rows: a small
                    gutter avatar and text, no name row. */}
                <Skeleton
                  className={cn(
                    "shrink-0 rounded-full",
                    isDocument ? "-mt-0.5 size-7" : "mt-0.5 size-9"
                  )}
                />
                <div className="flex-1 space-y-2">
                  {!isDocument && (
                    <div className="flex items-baseline gap-2">
                      <Skeleton
                        className="h-3 rounded"
                        style={{ width: group.nameWidth }}
                      />
                      <Skeleton className="h-2.5 w-10 rounded" />
                    </div>
                  )}
                  {group.lines.map((width, i) => (
                    <Skeleton
                      key={`${group.key}-${i}`}
                      className="h-3 rounded"
                      style={{ width }}
                    />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </MessageScrollerItem>
      ) : (
        replies.flatMap((msg, i) => {
          const group = groups.find((g) => i >= g.start && i <= g.end)
          if (!group) return [renderReply(msg, i)]
          // The fold's row sits under the reply rewound to; the rewind event
          // itself is that row.
          const open = group.count > 0 && unfolded.has(group.event.id)
          return [
            ...(i === group.start
              ? [
                  <MessageScrollerItem
                    key={`rewound-${group.event.id}`}
                    messageId={group.event.id}
                    className={cn(
                      "mx-4 mt-3 border border-border/70 bg-muted/35",
                      open ? "rounded-t-xl" : "mb-3 rounded-xl"
                    )}
                  >
                    <RewoundTurnsRow
                      group={group}
                      expanded={open}
                      onToggle={() => toggleGroup(group.event.id)}
                    />
                  </MessageScrollerItem>,
                ]
              : []),
            ...(open && i < group.end ? [renderReply(msg, i, group)] : []),
          ]
        })
      )}
    </>
  )
}
