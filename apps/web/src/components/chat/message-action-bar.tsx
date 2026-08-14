import {
  ArrowTurnBackwardIcon,
  MessageMultiple01Icon,
  MoreHorizontalIcon,
  Pin02Icon,
  PinOffIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/components/menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@repo/ui/components/tooltip"
import { useCallback, useEffect, useRef, useState } from "react"
import { EmojiReactionPicker } from "@/components/chat/emoji-reaction-picker"

interface MessageActionBarProps {
  onReact?: (emoji: string) => void
  onReply?: () => void
  onReplyInThread?: () => void
  onCopyText?: () => void
  onEdit?: () => void
  onDelete?: () => void
  onTogglePin?: () => void
  isPinned?: boolean
  canManageMessage?: boolean
  canPin?: boolean
  onOverlayOpenChange?: (open: boolean) => void
}

export function MessageActionBar({
  onReact,
  onReply,
  onReplyInThread,
  onCopyText,
  onEdit,
  onDelete,
  onTogglePin,
  isPinned = false,
  canManageMessage = false,
  canPin = false,
  onOverlayOpenChange,
}: MessageActionBarProps) {
  const [isEmojiOpen, setIsEmojiOpen] = useState(false)
  const [isMoreOpen, setIsMoreOpen] = useState(false)
  const [suppressTooltip, setSuppressTooltip] = useState(false)
  const suppressTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null)

  useEffect(() => {
    onOverlayOpenChange?.(isEmojiOpen || isMoreOpen)
  }, [isEmojiOpen, isMoreOpen, onOverlayOpenChange])

  useEffect(() => {
    return () => {
      if (suppressTimeoutRef.current) clearTimeout(suppressTimeoutRef.current)
    }
  }, [])

  const handleMoreOpenChange = useCallback((open: boolean) => {
    setIsMoreOpen(open)
    if (!open) {
      // Suppress tooltip briefly after dropdown closes to prevent it from sticking
      setSuppressTooltip(true)
      if (suppressTimeoutRef.current) clearTimeout(suppressTimeoutRef.current)
      suppressTimeoutRef.current = setTimeout(
        () => setSuppressTooltip(false),
        150
      )
    }
  }, [])

  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5 shadow-sm">
      <EmojiReactionPicker onSelect={onReact} onOpenChange={setIsEmojiOpen} />

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="size-7"
              onClick={onReply}
              aria-label="Reply"
            />
          }
        >
          <HugeiconsIcon
            icon={ArrowTurnBackwardIcon}
            className="size-4"
            strokeWidth={1.5}
          />
        </TooltipTrigger>
        <TooltipContent side="top">Reply</TooltipContent>
      </Tooltip>

      {onReplyInThread && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={onReplyInThread}
                aria-label="Reply in thread"
              />
            }
          >
            <HugeiconsIcon icon={MessageMultiple01Icon} size={8} />
          </TooltipTrigger>
          <TooltipContent side="top">Reply in thread</TooltipContent>
        </Tooltip>
      )}

      <DropdownMenu open={isMoreOpen} onOpenChange={handleMoreOpenChange}>
        <Tooltip open={isMoreOpen || suppressTooltip ? false : undefined}>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="size-7"
                    aria-label="More actions"
                  />
                }
              />
            }
          >
            <HugeiconsIcon
              icon={MoreHorizontalIcon}
              className="size-4"
              strokeWidth={2}
            />
          </TooltipTrigger>
          <TooltipContent side="top">More actions</TooltipContent>
        </Tooltip>

        <DropdownMenuContent side="top" align="end">
          {canManageMessage && (
            <DropdownMenuItem onClick={onEdit} disabled={!onEdit}>
              Edit message
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={onCopyText}>Copy text</DropdownMenuItem>
          {canPin && (
            <DropdownMenuItem onClick={onTogglePin} disabled={!onTogglePin}>
              <HugeiconsIcon
                icon={isPinned ? PinOffIcon : Pin02Icon}
                size={14}
              />
              {isPinned ? "Unpin message" : "Pin message"}
            </DropdownMenuItem>
          )}
          {canManageMessage && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onDelete}
                disabled={!onDelete}
                className="text-destructive focus:text-destructive"
              >
                Delete message
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
