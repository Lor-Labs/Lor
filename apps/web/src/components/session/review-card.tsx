import {
  AiMagicIcon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  GitPullRequestIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { RealtimeChannelEventPayload } from "@repo/realtime-types"
import { Button } from "@repo/ui/components/button"
import { Skeleton } from "@repo/ui/components/skeleton"
import { formatTime } from "@repo/utils/date"
import { useState } from "react"
import { MessageMarkdown } from "@/components/chat/message-markdown"
import {
  ReviewerAvatar,
  ReviewThreadRow,
  sendFixWithLor,
  threadFixItem,
} from "@/components/session/review-threads"
import { useSessionReview } from "@/hooks/use-session-review"
import type { Message } from "@/lib/api-types"

// A GitHub review of the session's pull request as a card in the session
// thread: posted when the review lands, its comments read live so resolving
// one on GitHub updates it. Open at first; collapsing is remembered per
// person (reference/planned/pr-reviews.md).

type ReviewedPayload = Extract<
  NonNullable<RealtimeChannelEventPayload>,
  { reviewId: number }
>

const collapsedKey = (messageId: string) =>
  `lor:review-card-collapsed:${messageId}`

function readCollapsed(messageId: string) {
  try {
    return localStorage.getItem(collapsedKey(messageId)) === "1"
  } catch {
    return false
  }
}

function writeCollapsed(messageId: string, collapsed: boolean) {
  try {
    if (collapsed) localStorage.setItem(collapsedKey(messageId), "1")
    else localStorage.removeItem(collapsedKey(messageId))
  } catch {}
}

const VERB = {
  approved: "approved",
  changes_requested: "requested changes on",
  commented: "reviewed",
} as const

export function isReviewedEvent(message: Message) {
  return (
    message.eventType === "session_reviewed" &&
    Boolean(message.eventPayload) &&
    Boolean(message.threadRootId)
  )
}

export function ReviewCard({ message }: { message: Message }) {
  const payload = message.eventPayload as ReviewedPayload
  const threadRootId = message.threadRootId ?? ""
  const [collapsed, setCollapsed] = useState(() => readCollapsed(message.id))
  const {
    data: review,
    isPending,
    isError,
  } = useSessionReview(payload.sessionId, threadRootId)
  const own = review?.reviews.find((item) => item.id === payload.reviewId)
  const threads =
    review?.threads.filter((thread) => thread.reviewId === payload.reviewId) ??
    []
  const open = threads.filter((thread) => !thread.resolved)
  const toggle = () => {
    writeCollapsed(message.id, !collapsed)
    setCollapsed(!collapsed)
  }

  return (
    <div className="group/event mt-1 flex gap-3 px-4 py-1">
      <div className="w-7 shrink-0" />
      <div className="min-w-0 flex-1 rounded-lg border border-border/70 bg-card/40">
        <div className="flex min-w-0 items-center gap-1.5 px-3 py-2 text-[13px]">
          <button
            type="button"
            onClick={toggle}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand review" : "Collapse review"}
            className="flex min-w-0 cursor-pointer items-center gap-1.5 text-left"
          >
            <HugeiconsIcon
              icon={collapsed ? ArrowRight01Icon : ArrowDown01Icon}
              className="size-3.5 shrink-0 text-muted-foreground"
              strokeWidth={2}
            />
            <ReviewerAvatar
              author={{
                login: payload.reviewer,
                avatarUrl: own?.author.avatarUrl ?? null,
              }}
            />
            <span className="min-w-0 truncate">
              <span className="font-medium">{payload.reviewer}</span>
              <span className="text-muted-foreground">
                {" "}
                {VERB[payload.state]}
              </span>
            </span>
          </button>
          <a
            href={payload.pullRequestUrl}
            target="_blank"
            rel="noreferrer"
            className="flex shrink-0 items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <HugeiconsIcon
              icon={GitPullRequestIcon}
              className="size-3.5"
              strokeWidth={2}
            />
            #{payload.pullRequestNumber}
          </a>
          {threads.length > 0 && (
            <span className="shrink-0 text-muted-foreground">
              · {open.length} open of {threads.length}
            </span>
          )}
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground/50 opacity-0 transition-opacity group-hover/event:opacity-100">
            {formatTime(message.createdAt)}
          </span>
          {!collapsed && review && open.length > 1 && (
            <Button
              size="xs"
              variant="outline"
              className="shrink-0"
              onClick={() =>
                sendFixWithLor(
                  threadRootId,
                  open.map(threadFixItem),
                  review.pullRequest
                )
              }
            >
              <HugeiconsIcon icon={AiMagicIcon} className="size-3.5" />
              Fix all open
            </Button>
          )}
        </div>
        {!collapsed && (
          <div className="flex flex-col gap-1 border-border/70 border-t px-1 py-1.5">
            {isPending ? (
              <Skeleton className="mx-2 my-1 h-4 w-48" />
            ) : isError ? (
              <p className="px-2 py-1 text-muted-foreground text-xs">
                Couldn't load the review from GitHub
              </p>
            ) : !review ? (
              <p className="px-2 py-1 text-muted-foreground text-xs">
                The pull request isn't available
              </p>
            ) : (
              <>
                {own?.body && (
                  <div className="px-2 text-muted-foreground text-sm">
                    <MessageMarkdown content={own.body} mentions={[]} />
                  </div>
                )}
                {/* A review bot's prompt for the whole review also covers
                  findings with no thread (nitpicks, outside the diff). */}
                {own?.agentPrompt && (
                  <Button
                    size="xs"
                    variant="ghost"
                    className="mx-1 self-start"
                    onClick={() =>
                      sendFixWithLor(
                        threadRootId,
                        [
                          {
                            where: "the whole review",
                            author: own.author.login,
                            url: own.url,
                            text: own.agentPrompt ?? "",
                          },
                        ],
                        review.pullRequest
                      )
                    }
                  >
                    <HugeiconsIcon icon={AiMagicIcon} className="size-3.5" />
                    Fix the whole review with Lor
                  </Button>
                )}
                {threads.map((thread) => (
                  <ReviewThreadRow
                    key={thread.id}
                    thread={thread}
                    onFix={() =>
                      sendFixWithLor(
                        threadRootId,
                        [threadFixItem(thread)],
                        review.pullRequest
                      )
                    }
                  />
                ))}
                {!own?.body && threads.length === 0 && (
                  <p className="px-2 py-1 text-muted-foreground text-xs">
                    No comments
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
