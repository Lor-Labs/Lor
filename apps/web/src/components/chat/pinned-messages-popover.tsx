import { Cancel01Icon, Pin02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/avatar"
import { Button } from "@repo/ui/components/button"
import {
  Popover,
  PopoverClose,
  PopoverPopup,
  PopoverTitle,
  PopoverTrigger,
} from "@repo/ui/components/popover"
import { Skeleton } from "@repo/ui/components/skeleton"
import {
  type TooltipPrimitive,
  TooltipTrigger,
} from "@repo/ui/components/tooltip"
import { getAvatarInitials } from "@repo/utils/avatar-colors"
import { formatDateTime } from "@repo/utils/date"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { EmbedCard } from "@/components/chat/embed-card"
import { MessageMarkdown } from "@/components/chat/message-markdown"
import { useMessageSearchNavigation } from "@/hooks/use-message-search-navigation"
import { apiClient } from "@/lib/api-client"

export function PinnedMessagesPopover({
  workspaceSlug,
  channelId,
  tooltipHandle,
}: {
  workspaceSlug: string
  channelId: string
  tooltipHandle: TooltipPrimitive.Handle<string>
}) {
  const [open, setOpen] = useState(false)
  const navigateToMessage = useMessageSearchNavigation()
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["pinned-messages", channelId],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].pins.$get({ param: { workspaceSlug, channelId } })
      if (!res.ok) throw new Error("Failed to fetch pinned messages")
      return res.json()
    },
    enabled: open,
  })

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipTrigger
        handle={tooltipHandle}
        payload="Pinned messages"
        render={
          <PopoverTrigger
            render={
              <button
                type="button"
                aria-label="Pinned messages"
                className="relative rounded-sm p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground data-popup-open:bg-accent data-popup-open:text-foreground pointer-fine:after:absolute pointer-fine:after:left-full pointer-fine:after:h-full pointer-fine:after:w-1"
              />
            }
          />
        }
      >
        <HugeiconsIcon icon={Pin02Icon} size={16} aria-hidden="true" />
      </TooltipTrigger>
      <PopoverPopup
        align="end"
        sideOffset={12}
        className="w-[420px] max-w-[calc(100vw-24px)]"
        viewportClassName="flex max-h-[min(640px,70dvh,var(--available-height))] flex-col p-0 not-data-transitioning:overflow-hidden"
      >
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
          <HugeiconsIcon
            icon={Pin02Icon}
            size={18}
            className="text-muted-foreground"
            aria-hidden="true"
          />
          <PopoverTitle className="text-sm">Pinned messages</PopoverTitle>
          {data && data.data.length > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {data.data.length}
            </span>
          )}
          <PopoverClose
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Close pinned messages"
                className="ml-auto text-muted-foreground"
              />
            }
          >
            <HugeiconsIcon icon={Cancel01Icon} size={16} />
          </PopoverClose>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-2">
          {isPending ? (
            <div className="space-y-2" aria-busy="true">
              <span className="sr-only">Loading pinned messages</span>
              {[0, 1, 2].map((item) => (
                <div key={item} className="space-y-3 rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <Skeleton className="size-7 rounded-full" />
                    <Skeleton className="h-3 w-36" />
                  </div>
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className="space-y-3 px-4 py-8 text-center" role="alert">
              <p className="text-sm text-muted-foreground">
                Couldn’t load pinned messages.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void refetch()}
              >
                Try again
              </Button>
            </div>
          ) : data?.data.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <HugeiconsIcon
                icon={Pin02Icon}
                size={28}
                className="mb-1 text-muted-foreground/50"
              />
              <p className="text-sm font-medium">No pinned messages yet</p>
              <p className="max-w-64 text-xs leading-relaxed text-muted-foreground">
                Pin a message from its menu to keep useful information close at
                hand.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {data?.data.map((msg) => {
                const name = msg.overrideName ?? msg.author.name
                const image = msg.overrideAvatarUrl ?? msg.author.image
                return (
                  <article
                    key={msg.id}
                    className="rounded-lg border border-border/70 bg-foreground/[0.02] p-3"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Avatar size="sm">
                        {image && <AvatarImage src={image} alt={name} />}
                        <AvatarFallback
                          avatarColor={msg.author.avatarColor}
                          className="text-[9px] font-semibold"
                          fallbackSeed={name}
                        >
                          {getAvatarInitials(name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 truncate text-xs font-semibold">
                        {name}
                      </span>
                      <time
                        dateTime={msg.createdAt}
                        className="ml-auto shrink-0 text-[10px] text-muted-foreground"
                      >
                        {formatDateTime(msg.createdAt)}
                      </time>
                    </div>
                    <div className="mt-2 min-w-0 [overflow-wrap:anywhere]">
                      <MessageMarkdown
                        content={msg.content}
                        mentions={msg.mentions}
                      />
                      {msg.embeds.map((embed, index) => (
                        <EmbedCard
                          key={`${embed.url ?? "embed"}:${index}`}
                          embed={embed}
                        />
                      ))}
                      {msg.attachments?.map((attachment) => (
                        <a
                          key={attachment.url}
                          href={attachment.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="mt-2 block truncate text-xs font-medium text-primary hover:underline"
                        >
                          {attachment.filename}
                        </a>
                      ))}
                    </div>
                    <div className="mt-2 flex justify-end">
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => {
                          setOpen(false)
                          navigateToMessage({
                            id: msg.id,
                            channelId,
                            threadRootId: msg.threadRootId ?? null,
                          })
                        }}
                      >
                        Jump to message
                      </Button>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  )
}
