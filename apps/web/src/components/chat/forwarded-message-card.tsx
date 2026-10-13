import { ArrowTurnForwardIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { RealtimeForwardedMessage } from "@repo/realtime-types"
import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/avatar"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { getAvatarInitials } from "@repo/utils/avatar-colors"
import { formatDateTime } from "@repo/utils/date"
import { useLayoutEffect, useRef, useState } from "react"
import { MessageMarkdown } from "@/components/chat/message-markdown"
import { useMessageIdNavigation } from "@/hooks/use-message-search-navigation"

// A forwarded message (type "forward"), Discord-style: the original as it
// was when forwarded, under the forwarder's note. Renders from the snapshot,
// so it reads the same for people who can't open the source; the footer
// names the source and opens it for those who can. Long ones collapse.
export function ForwardedMessageCard({
  forwarded,
  preview = false,
}: {
  forwarded: RealtimeForwardedMessage
  // The forward dialog's preview: no source footer.
  preview?: boolean
}) {
  const openMessage = useMessageIdNavigation()
  const contentRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [canExpand, setCanExpand] = useState(false)
  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el || expanded) return
    setCanExpand(el.scrollHeight > el.clientHeight + 1)
  }, [expanded])

  const { author, source } = forwarded
  const where = [
    `#${source.channelName ?? "channel"}`,
    source.sessionTitle,
  ].filter(Boolean)

  return (
    <div className="mt-1 max-w-2xl border-border border-l-2 py-0.5 pl-3">
      <p className="flex items-center gap-1 text-muted-foreground text-xs italic">
        <HugeiconsIcon
          icon={ArrowTurnForwardIcon}
          className="size-3.5"
          strokeWidth={2}
        />
        Forwarded
      </p>
      <div className="mt-1.5 flex items-center gap-1.5 text-[13px]">
        <Avatar className="size-4">
          {author.image && <AvatarImage src={author.image} alt={author.name} />}
          <AvatarFallback
            fallbackSeed={author.name}
            className="font-semibold text-[8px]"
          >
            {getAvatarInitials(author.name)}
          </AvatarFallback>
        </Avatar>
        <span className="font-medium">{author.name}</span>
      </div>
      <div
        ref={contentRef}
        className={cn(
          "mt-1 overflow-hidden",
          !expanded && "max-h-60",
          !expanded &&
            canExpand &&
            "[mask-image:linear-gradient(to_bottom,black_75%,transparent)]"
        )}
      >
        <MessageMarkdown
          content={forwarded.content}
          mentions={forwarded.mentions}
        />
      </div>
      {canExpand && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 cursor-pointer text-muted-foreground text-xs transition-colors hover:text-foreground"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
      {!preview && (
        <button
          type="button"
          onClick={() =>
            void openMessage(forwarded.messageId).then((found) => {
              if (!found) toast.error("The original isn't available")
            })
          }
          className="mt-1.5 flex max-w-full cursor-pointer items-center gap-1 text-muted-foreground text-xs transition-colors hover:text-foreground"
        >
          <span className="truncate">{where.join(" › ")}</span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0">
            {formatDateTime(forwarded.createdAt)}
          </span>
        </button>
      )}
    </div>
  )
}
