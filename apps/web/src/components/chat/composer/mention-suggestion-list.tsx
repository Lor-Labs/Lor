import { LOR_USER_ID } from "@repo/db/constants"
import { cn } from "@repo/ui/lib/utils"
import { forwardRef } from "react"
import type { MentionCandidate } from "@/components/chat/composer/mention-types"
import {
  type SuggestionListRef,
  useSuggestionList,
} from "@/components/chat/composer/use-suggestion-list"
import { UserAvatar } from "@/components/ui/user-avatar"
import { isBroadcastMention } from "@/lib/broadcast-mentions"

export interface MentionSuggestionListProps {
  items: MentionCandidate[]
  command: (item: MentionCandidate) => void
}

const BROADCAST_DESCRIPTIONS: Record<string, string> = {
  channel: "Notify everyone who can see this channel",
  here: "Notify channel members who are online right now",
  everyone: "Notify everyone in the workspace",
}

const WORD_BREAK = /[\s._()-]+/

// 0: the name starts with the query, 1: a later word does, 2: it appears
// anywhere (search text included).
function matchTier(
  { label, name, search }: MentionCandidate,
  query: string
): number | null {
  if (!query) return 0
  const names = [name ?? label, label].map((value) => value.toLowerCase())
  if (names.some((value) => value.startsWith(query))) return 0
  const texts = search ? [...names, search.toLowerCase()] : names
  if (
    texts.some((text) =>
      text.split(WORD_BREAK).some((word) => word.startsWith(query))
    )
  ) {
    return 1
  }
  return texts.some((text) => text.includes(query)) ? 2 : null
}

// @ menu order. Lor leads its tier, so "@l" + Enter picks Lor. A broadcast
// (@channel, @here, @everyone) shows only once the query starts its name,
// and always last, so a stray Enter never notifies a whole channel.
export function rankMentionCandidates(
  candidates: MentionCandidate[],
  rawQuery: string,
  limit: number
): MentionCandidate[] {
  const query = rawQuery.trim().toLowerCase()
  const people: { candidate: MentionCandidate; rank: number }[] = []
  const broadcasts: MentionCandidate[] = []
  for (const candidate of candidates) {
    if (isBroadcastMention(candidate.id)) {
      if (candidate.label.toLowerCase().startsWith(query)) {
        broadcasts.push(candidate)
      }
      continue
    }
    const tier = matchTier(candidate, query)
    if (tier === null) continue
    people.push({
      candidate,
      rank: tier * 2 + (candidate.id === LOR_USER_ID ? 0 : 1),
    })
  }
  people.sort((a, b) => a.rank - b.rank)
  return [
    ...people.slice(0, limit).map(({ candidate }) => candidate),
    ...broadcasts,
  ]
}

export const MentionSuggestionList = forwardRef<
  SuggestionListRef,
  MentionSuggestionListProps
>(function MentionSuggestionList({ items, command }, ref) {
  const { selectedIndex, getRowProps } = useSuggestionList(items, command, ref)
  const firstBroadcast = items.findIndex((item) => isBroadcastMention(item.id))

  if (items.length === 0) return null

  return (
    <div className="max-h-64 overflow-y-auto p-1">
      {items.map((item, index) => {
        const description = BROADCAST_DESCRIPTIONS[item.id]
        return (
          <div key={item.id}>
            {index === firstBroadcast && index > 0 && (
              <div className="mx-2 my-1 h-px bg-border/70" />
            )}
            <button
              type="button"
              {...getRowProps(index)}
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                index === selectedIndex && "bg-accent text-accent-foreground"
              )}
              onMouseDown={(event) => {
                event.preventDefault()
                command(item)
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
                  <span className="truncate">@{item.name ?? item.label}</span>
                </>
              )}
            </button>
          </div>
        )
      })}
    </div>
  )
})
