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
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@repo/ui/components/popover"
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
import type { RunModelLabel } from "@/hooks/use-agent-models"

const ACTION_CLASS = "size-7 text-muted-foreground hover:text-foreground"
const COPIED_MS = 1500

// The row under Lor's replies in a session, like ChatGPT's and Claude's. The
// actions always show; the time shows on the newest reply and on hover for
// older ones (Jacob 2026-11-03). People's messages and channel chat keep the
// floating bar (message-action-bar.tsx).
export function LorReplyActions({
  timeAlwaysVisible,
  time,
  model = null,
  onCopyText,
  onReact,
  onReply,
  onForward,
  onFork,
  onTogglePin,
  isPinned,
}: {
  timeAlwaysVisible: boolean
  // When the reply was sent; date dividers carry the day.
  time: string
  // The model the reply's run used (LOR-160), shown before the time; null
  // on replies from before runs recorded it.
  model?: RunModelLabel | null
  onCopyText?: () => void
  onReact: (emoji: string) => void
  onReply: () => void
  onForward?: () => void
  // Settles when the fork opens or fails (the hook's toast says why).
  onFork?: () => Promise<unknown>
  onTogglePin?: () => void
  isPinned: boolean
}) {
  const [tooltipHandle] = useState(() => TooltipCreateHandle<string>())
  const [menuOpen, setMenuOpen] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [forkOpen, setForkOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])
  const timeShown = timeAlwaysVisible || menuOpen || emojiOpen || forkOpen

  return (
    // The buttons' own padding is the gap: no extra margin above, and the
    // next row tucks under their bottom padding.
    <div className="group/actions -ml-1.5 -mb-1 mt-0.5 flex items-center gap-0.5">
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
      {onTogglePin && (
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
            <DropdownMenuItem onClick={onTogglePin}>
              <HugeiconsIcon
                icon={isPinned ? PinOffIcon : Pin02Icon}
                size={14}
              />
              {isPinned ? "Unpin message" : "Pin message"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {/* Last icon in the row (Jacob 2026-10-24). */}
      {onFork && (
        <ForkAction
          handle={tooltipHandle}
          onFork={onFork}
          onOpenChange={setForkOpen}
        />
      )}
      <span
        className={cn(
          "ml-1.5 flex min-w-0 items-center gap-1 text-muted-foreground/70 text-xs tabular-nums transition-opacity duration-100",
          !timeShown &&
            "opacity-0 group-hover:opacity-100 group-focus-within/actions:opacity-100"
        )}
      >
        {model && (
          <>
            {model.exact ? (
              <TooltipTrigger
                handle={tooltipHandle}
                payload={model.exact}
                render={<button type="button" className="min-w-0 truncate" />}
              >
                {model.name}
              </TooltipTrigger>
            ) : (
              <span className="min-w-0 truncate">{model.name}</span>
            )}
            <span aria-hidden="true">·</span>
          </>
        )}
        <span className="shrink-0">{time}</span>
      </span>
      <Tooltip handle={tooltipHandle}>
        {({ payload }) => (
          <TooltipContent side="bottom">{payload}</TooltipContent>
        )}
      </Tooltip>
    </div>
  )
}

// Forking makes a new session, so it asks first; the button spins until the
// fork opens.
function ForkAction({
  handle,
  onFork,
  onOpenChange,
}: {
  handle: TooltipPrimitive.Handle<string>
  onFork: () => Promise<unknown>
  onOpenChange: (open: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [forking, setForking] = useState(false)
  const changeOpen = (next: boolean) => {
    if (forking) return
    setOpen(next)
    onOpenChange(next)
  }
  const confirm = async () => {
    setForking(true)
    try {
      await onFork()
      setOpen(false)
      onOpenChange(false)
    } catch {
      // The fork hook's toast says why.
    } finally {
      setForking(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <TooltipTrigger
        handle={handle}
        payload="Fork from here"
        disabled={open}
        render={
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className={ACTION_CLASS}
                aria-label="Fork from here"
              />
            }
          />
        }
      >
        <HugeiconsIcon
          icon={GitForkIcon}
          className="size-4"
          strokeWidth={1.5}
        />
      </TooltipTrigger>
      <PopoverContent side="bottom" align="start" className="w-64">
        <PopoverTitle className="text-sm">Fork from this reply?</PopoverTitle>
        <PopoverDescription className="mt-1.5 text-xs">
          Starts a new session from here. This one won't change.
        </PopoverDescription>
        <div className="mt-3 flex justify-end gap-2">
          <Button
            size="xs"
            variant="ghost"
            disabled={forking}
            onClick={() => changeOpen(false)}
          >
            Cancel
          </Button>
          <Button size="xs" loading={forking} onClick={() => void confirm()}>
            Fork
          </Button>
        </div>
      </PopoverContent>
    </Popover>
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
