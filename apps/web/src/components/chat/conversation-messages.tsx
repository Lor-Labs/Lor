import { MessageScrollerItem } from "@repo/ui/components/message-scroller"
import { Skeleton } from "@repo/ui/components/skeleton"
import { Spinner } from "@repo/ui/components/spinner"
import { cn } from "@repo/ui/lib/utils"
import { differenceInMinutes, isSameDay } from "@repo/utils/date"
import { type ComponentProps, type RefObject, useEffect, useRef } from "react"
import { ChannelEventRow } from "@/components/chat/channel-event-row"
import { MessageItem } from "@/components/chat/message-item"
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
        replies.map((msg, i) => {
          const prev = replies[i - 1]
          const isDateBoundary =
            !prev || !isSameDay(msg.createdAt, prev.createdAt)
          const isWithinGroupWindow =
            !!prev &&
            differenceInMinutes(msg.createdAt, prev.createdAt) <=
              MESSAGE_GROUP_WINDOW_MINUTES
          // Events (a loop's "ran on schedule" line) are muted rows that
          // break the author group, so Lor's reply after one keeps its
          // avatar.
          if (msg.type === "event") {
            return (
              <MessageScrollerItem key={msg.id} messageId={msg.id}>
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
            >
              <MessageItem
                {...itemProps}
                message={msg}
                showHeader={showHeader}
                wrapContentAroundAvatar={!isDocument}
                layout={layout}
                isReplyTarget={replyingToId === msg.id}
              />
            </MessageScrollerItem>
          )
        })
      )}
    </>
  )
}
