import { UserGroupIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { LOR_USER_ID } from "@repo/db/constants"
import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/avatar"
import {
  useMessageScroller,
  useMessageScrollerVisibility,
} from "@repo/ui/components/message-scroller"
import {
  Tooltip,
  TooltipContent,
  TooltipCreateHandle,
  TooltipTrigger,
} from "@repo/ui/components/tooltip"
import { cn } from "@repo/ui/lib/utils"
import { getAvatarInitials } from "@repo/utils/avatar-colors"
import { timeAgo } from "@repo/utils/date"
import { useMemo, useState } from "react"
import { jumpScrollBehavior } from "@/components/chat/message-scroller-controls"
import type { Message } from "@/lib/api-types"
import { toSearchPreviewText } from "@/lib/search-preview"

// A loop fire or an Act event opens a turn like a person's message does.
const RUN_EVENTS = new Set(["loop_run", "trigger_run"])

type Turn = {
  // The turn's first message, which a click scrolls to.
  id: string
  ids: Set<string>
  start: Message
  // Lor's first written reply in the turn.
  reply: Message | null
  working: boolean
  toPeople: boolean
}

function buildTurns(messages: Message[]): Turn[] {
  const turns: Turn[] = []
  for (const message of messages) {
    const startsTurn =
      message.type === "event"
        ? RUN_EVENTS.has(message.eventType ?? "")
        : message.authorId !== LOR_USER_ID
    const current = turns.at(-1)
    if (startsTurn) {
      turns.push({
        id: message.id,
        ids: new Set([message.id]),
        start: message,
        reply: null,
        working: false,
        toPeople: message.routedToLor === false,
      })
    } else if (current) {
      current.ids.add(message.id)
      if (message.status === "pending") current.working = true
      if (
        !current.reply &&
        message.authorId === LOR_USER_ID &&
        message.content
      ) {
        current.reply = message
      }
    }
  }
  return turns
}

function preview(message: Message) {
  return toSearchPreviewText(message.content, message.mentions ?? [])
}

function turnTitle(turn: Turn) {
  const { start } = turn
  if (start.type !== "event") return preview(start) || "Attachment"
  const payload = start.eventPayload as {
    loopName?: string
    label?: string
  } | null
  return start.eventType === "loop_run"
    ? `${payload?.loopName ?? "A loop"} ran on schedule`
    : `${payload?.label ?? "An automation"} started this session`
}

// Marks rest short and equal. Under the pointer they grow like a dock: the
// hovered mark longest, its neighbors less with each step away.
const REST_WIDTH = 8
const MAGNIFIED_WIDTHS = [28, 20, 16, 12]

// Session turn picker: one mark per turn on the session's right edge, like
// Codex. Turns on screen are slightly brighter; hovering a mark previews the
// turn and clicking scrolls to it. Only loaded turns are listed.
export function SessionTurnRail({ messages }: { messages: Message[] }) {
  const turns = useMemo(() => buildTurns(messages), [messages])
  const { scrollToMessage } = useMessageScroller()
  const { visibleMessageIds } = useMessageScrollerVisibility()
  const [handle] = useState(() => TooltipCreateHandle<number>())
  const [hovered, setHovered] = useState<number | null>(null)

  const inView = new Set(
    turns.flatMap((turn, index) =>
      visibleMessageIds.some((id) => turn.ids.has(id)) ? [index] : []
    )
  )
  const firstInView = Math.min(...inView)

  if (turns.length < 2) return null

  return (
    <div className="pointer-events-none absolute inset-y-0 right-0 z-10 flex items-center pr-4 @max-[54rem]:hidden">
      <nav
        aria-label="Turns"
        onPointerLeave={() => setHovered(null)}
        className="pointer-events-auto flex max-h-[70%] flex-col items-end"
      >
        {turns.map((turn, index) => {
          const distance = hovered === null ? null : Math.abs(index - hovered)
          const width =
            distance === null
              ? REST_WIDTH
              : (MAGNIFIED_WIDTHS[distance] ?? REST_WIDTH)
          return (
            <TooltipTrigger
              key={turn.id}
              handle={handle}
              payload={index}
              delay={0}
              closeDelay={0}
              render={
                <button
                  type="button"
                  aria-label={`Turn ${index + 1}: ${turnTitle(turn)}`}
                  aria-current={index === firstInView ? "location" : undefined}
                  onPointerEnter={() => setHovered(index)}
                  onFocus={() => setHovered(index)}
                  onBlur={() => setHovered(null)}
                  onClick={() =>
                    scrollToMessage(turn.id, {
                      align: "start",
                      behavior: jumpScrollBehavior(),
                    })
                  }
                  className="flex h-3 min-h-[3px] w-8 shrink cursor-pointer items-center justify-end outline-none"
                />
              }
            >
              <span
                className={cn(
                  "h-0.5 rounded-full transition-[width,background-color] duration-150 ease-out",
                  distance === 0
                    ? "bg-foreground"
                    : inView.has(index) || (distance !== null && distance < 4)
                      ? "bg-muted-foreground/80"
                      : "bg-muted-foreground/35"
                )}
                style={{ width }}
              />
            </TooltipTrigger>
          )
        })}
      </nav>
      <Tooltip handle={handle}>
        {({ payload }) => {
          const turn = payload === undefined ? undefined : turns[payload]
          return turn ? (
            <TooltipContent side="left" sideOffset={8} className="text-sm">
              <TurnCard turn={turn} />
            </TooltipContent>
          ) : null
        }}
      </Tooltip>
    </div>
  )
}

function TurnCard({ turn }: { turn: Turn }) {
  const { start, reply } = turn
  const person = start.type === "event" ? null : start
  const name = person ? (person.overrideName ?? person.author.name) : null
  const replyText = turn.toPeople
    ? null
    : reply
      ? preview(reply)
      : turn.working
        ? "Lor is working…"
        : null

  return (
    <div className="w-72 space-y-1.5 px-1 py-1.5 text-left">
      {/* The same words as the reply pill, so Lor turns read at a glance. */}
      {turn.toPeople ? (
        <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
          <HugeiconsIcon
            icon={UserGroupIcon}
            className="size-3.5"
            strokeWidth={2}
          />
          To subscribers
        </p>
      ) : (
        <p className="flex items-center gap-1.5 font-medium text-agent text-xs">
          <img src="/lor-mark.svg" alt="" className="size-3.5" />
          {start.type === "event" ? "Lor run" : "To Lor"}
        </p>
      )}
      <p className="truncate font-medium text-foreground">{turnTitle(turn)}</p>
      {replyText && (
        <div className="flex gap-1.5">
          <img src="/lor-mark.svg" alt="" className="mt-1 size-3 shrink-0" />
          <p className="line-clamp-2 text-muted-foreground">{replyText}</p>
        </div>
      )}
      <div className="flex items-center gap-1.5 border-t pt-2 text-muted-foreground text-xs">
        {person && name && (
          <>
            <Avatar className="size-4">
              {person.author.image && (
                <AvatarImage src={person.author.image} alt="" />
              )}
              <AvatarFallback
                avatarColor={person.author.avatarColor}
                fallbackSeed={name}
                className="font-semibold text-[7px]"
              >
                {getAvatarInitials(name)}
              </AvatarFallback>
            </Avatar>
            <span className="truncate">{name}</span>
            <span aria-hidden="true">·</span>
          </>
        )}
        <span className="shrink-0">{timeAgo(start.createdAt)}</span>
      </div>
    </div>
  )
}
