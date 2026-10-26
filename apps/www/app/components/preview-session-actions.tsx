"use client"

import {
  ArrowTurnBackwardIcon,
  ArrowTurnForwardIcon,
  Copy01Icon,
  GitForkIcon,
  MoreHorizontalIcon,
  SmilePlusIcon,
  SourceCodeIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
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
import { useState } from "react"

export function PreviewReplyActions({ onFork }: { onFork?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="-ml-1.5 -mb-1 mt-0.5 flex items-center gap-0.5 text-lor-text-tertiary-dark">
      {[
        Copy01Icon,
        SmilePlusIcon,
        ArrowTurnBackwardIcon,
        ArrowTurnForwardIcon,
        MoreHorizontalIcon,
      ].map((icon, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="flex size-7 items-center justify-center"
        >
          <HugeiconsIcon icon={icon} size={15} strokeWidth={1.5} />
        </span>
      ))}
      {onFork ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="size-7"
                aria-label="Fork from here"
                data-preview-target="fork"
                title="Fork from here"
              />
            }
          >
            <HugeiconsIcon icon={GitForkIcon} size={16} strokeWidth={1.5} />
          </PopoverTrigger>
          <PopoverContent side="bottom" align="start" className="w-64">
            <PopoverTitle className="text-sm">
              Fork from this reply?
            </PopoverTitle>
            <PopoverDescription className="mt-1.5 text-xs">
              Starts a new session from here. This one won&rsquo;t change.
            </PopoverDescription>
            <div className="mt-3 flex justify-end gap-2">
              <Button size="xs" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                size="xs"
                onClick={() => {
                  setOpen(false)
                  onFork()
                }}
              >
                Fork
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      ) : (
        <span
          title="Fork from here"
          className="flex size-7 items-center justify-center"
        >
          <HugeiconsIcon icon={GitForkIcon} size={16} strokeWidth={1.5} />
        </span>
      )}
      <span className="ml-1.5 text-[11px] text-lor-text-tertiary-dark/70">
        10:49 AM
      </span>
    </div>
  )
}

export function PreviewSessionMenu({
  onContinueInCode,
}: {
  onContinueInCode: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className="size-7"
            aria-label="Session actions"
          />
        }
      >
        <HugeiconsIcon icon={MoreHorizontalIcon} size={16} strokeWidth={2} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="end">
        <DropdownMenuItem onClick={onContinueInCode}>
          <HugeiconsIcon icon={SourceCodeIcon} strokeWidth={2} />
          Continue in Code
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
