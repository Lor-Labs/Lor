import {
  ArrowTurnBackwardIcon,
  ArrowTurnForwardIcon,
  Copy01Icon,
  GitForkIcon,
  MoreHorizontalIcon,
  Pin02Icon,
  PinOffIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui/components/menu"
import {
  Tooltip,
  TooltipContent,
  TooltipCreateHandle,
  type TooltipPrimitive,
  TooltipTrigger,
} from "@repo/ui/components/tooltip"
import { cn } from "@repo/ui/lib/utils"
import { useEffect, useState } from "react"
import { EmojiReactionPicker } from "@/components/chat/emoji-reaction-picker"

const ACTION_CLASS = "size-7 text-muted-foreground hover:text-foreground"
const COPIED_MS = 1500

// The row under Lor's replies in a session, like ChatGPT's and Claude's:
// always shown on the newest reply, on hover for older ones (their space is
// kept, so nothing moves). People's messages and channel chat keep the
// floating bar (message-action-bar.tsx).
export function LorReplyActions({
  alwaysVisible,
  onCopyText,
  onReact,
  onReply,
  onForward,
  onFork,
  onTogglePin,
  isPinned,
}: {
  alwaysVisible: boolean
  onCopyText?: () => void
  onReact: (emoji: string) => void
  onReply: () => void
  onForward?: () => void
  onFork?: () => void
  onTogglePin?: () => void
  isPinned: boolean
}) {
  const [tooltipHandle] = useState(() => TooltipCreateHandle<string>())
  const [menuOpen, setMenuOpen] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])
  const shown = alwaysVisible || menuOpen || emojiOpen

  return (
    <div
      className={cn(
        "-ml-1.5 mt-1.5 flex items-center gap-0.5 transition-opacity duration-100",
        !shown &&
          "pointer-events-none opacity-0 focus-within:pointer-events-auto focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
      )}
    >
      {onCopyText && (
        <RowAction
          handle={tooltipHandle}
          label={copied ? "Copied" : "Copy"}
          icon={copied ? Tick02Icon : Copy01Icon}
          onClick={() => {
            onCopyText()
            setCopied(true)
          }}
        />
      )}
      <EmojiReactionPicker
        tooltipHandle={tooltipHandle}
        onSelect={onReact}
        onOpenChange={setEmojiOpen}
        triggerClassName={ACTION_CLASS}
      />
      <RowAction
        handle={tooltipHandle}
        label="Reply"
        icon={ArrowTurnBackwardIcon}
        onClick={onReply}
      />
      {onForward && (
        <RowAction
          handle={tooltipHandle}
          label="Forward to chat"
          icon={ArrowTurnForwardIcon}
          onClick={onForward}
        />
      )}
      {(onFork || onTogglePin) && (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <TooltipTrigger
            handle={tooltipHandle}
            payload="More"
            disabled={menuOpen}
            render={
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className={ACTION_CLASS}
                    aria-label="More"
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
          <DropdownMenuContent side="bottom" align="start">
            {onFork && (
              <DropdownMenuItem onClick={onFork}>
                <HugeiconsIcon icon={GitForkIcon} size={14} />
                Fork from here
              </DropdownMenuItem>
            )}
            {onTogglePin && (
              <DropdownMenuItem onClick={onTogglePin}>
                <HugeiconsIcon
                  icon={isPinned ? PinOffIcon : Pin02Icon}
                  size={14}
                />
                {isPinned ? "Unpin message" : "Pin message"}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Tooltip handle={tooltipHandle}>
        {({ payload }) => (
          <TooltipContent side="bottom">{payload}</TooltipContent>
        )}
      </Tooltip>
    </div>
  )
}

function RowAction({
  handle,
  label,
  icon,
  onClick,
}: {
  handle: TooltipPrimitive.Handle<string>
  label: string
  icon: IconSvgElement
  onClick: () => void
}) {
  return (
    <TooltipTrigger
      handle={handle}
      payload={label}
      render={
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={ACTION_CLASS}
          onClick={onClick}
          aria-label={label}
        />
      }
    >
      <HugeiconsIcon icon={icon} className="size-4" strokeWidth={1.5} />
    </TooltipTrigger>
  )
}
