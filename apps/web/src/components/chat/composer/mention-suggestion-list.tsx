import { cn } from "@repo/ui/lib/utils"
import type { SuggestionKeyDownProps } from "@tiptap/suggestion"
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react"
import type { MentionCandidate } from "@/components/chat/composer/mention-types"
import { UserAvatar } from "@/components/ui/user-avatar"

export interface MentionSuggestionListRef {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
}

export interface MentionSuggestionListProps {
  items: MentionCandidate[]
  command: (item: MentionCandidate) => void
}

const BROADCAST_DESCRIPTIONS: Record<string, string> = {
  channel: "Notify everyone who can see this channel",
  here: "Notify channel members who are online right now",
  everyone: "Notify everyone in the workspace",
}

export const MentionSuggestionList = forwardRef<
  MentionSuggestionListRef,
  MentionSuggestionListProps
>(function MentionSuggestionList({ items, command }, ref) {
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Broadcasts group above people (with a divider), whatever order the
  // filter returned — selection/keyboard indexes follow this order.
  const ordered = useMemo(() => {
    const broadcasts = items.filter((item) => BROADCAST_DESCRIPTIONS[item.id])
    const people = items.filter((item) => !BROADCAST_DESCRIPTIONS[item.id])
    return {
      all: [...broadcasts, ...people],
      broadcastCount: broadcasts.length,
    }
  }, [items])

  const selectItem = useCallback(
    (index: number) => {
      const item = ordered.all[index]
      if (!item) return false
      command(item)
      return true
    },
    [ordered.all, command]
  )

  useEffect(() => {
    setSelectedIndex((currentIndex) => {
      if (ordered.all.length === 0) return 0
      return Math.min(currentIndex, ordered.all.length - 1)
    })
  }, [ordered.all.length])

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown: ({ event }) => {
        if (ordered.all.length === 0) return false

        if (event.key === "ArrowDown") {
          event.preventDefault()
          setSelectedIndex(
            (currentIndex) => (currentIndex + 1) % ordered.all.length
          )
          return true
        }

        if (event.key === "ArrowUp") {
          event.preventDefault()
          setSelectedIndex(
            (currentIndex) =>
              (currentIndex + ordered.all.length - 1) % ordered.all.length
          )
          return true
        }

        if (event.key === "Enter") {
          event.preventDefault()
          return selectItem(selectedIndex)
        }

        return false
      },
    }),
    [ordered.all.length, selectedIndex, selectItem]
  )

  if (ordered.all.length === 0) {
    return (
      <div className="px-2 py-1.5 text-sm text-muted-foreground">
        No matches
      </div>
    )
  }

  return (
    <div className="max-h-64 overflow-y-auto p-1">
      {ordered.all.map((item, index) => {
        const description = BROADCAST_DESCRIPTIONS[item.id]
        const username = item.displayUsername ?? item.username ?? item.label
        const showFullName = Boolean(item.name && item.name !== username)
        return (
          <div key={item.id}>
            {index === ordered.broadcastCount && ordered.broadcastCount > 0 && (
              <div className="mx-2 my-1 h-px bg-border/70" />
            )}
            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                index === selectedIndex
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/70"
              )}
              onMouseDown={(event) => {
                event.preventDefault()
                selectItem(index)
              }}
            >
              {description ? (
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium">@{item.label}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {description}
                  </span>
                </div>
              ) : (
                <>
                  <UserAvatar
                    src={item.image}
                    name={item.name ?? item.label}
                    size="sm"
                  />
                  <span className="truncate">@{username}</span>
                  {showFullName && (
                    <span className="ml-auto truncate pl-2 text-xs text-muted-foreground">
                      {item.name}
                    </span>
                  )}
                </>
              )}
            </button>
          </div>
        )
      })}
    </div>
  )
})
