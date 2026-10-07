import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@repo/ui/components/avatar"
import {
  Tooltip,
  TooltipContent,
  TooltipCreateHandle,
  TooltipTrigger,
} from "@repo/ui/components/tooltip"
import { useState } from "react"
import type { ThreadParticipant } from "@/hooks/use-thread-messages"

const VISIBLE_SUBSCRIBERS = 4

function displayName(participant: ThreadParticipant) {
  return participant.name
}

export function ThreadSubscriberStack({
  subscribers,
}: {
  subscribers: ThreadParticipant[]
}) {
  const [tooltipHandle] = useState(() => TooltipCreateHandle<string>())

  if (subscribers.length === 0) return null

  const visible = subscribers.slice(0, VISIBLE_SUBSCRIBERS)
  const overflow = subscribers.length - visible.length

  return (
    <AvatarGroup
      aria-label={`${subscribers.length} thread ${subscribers.length === 1 ? "subscriber" : "subscribers"}`}
      className="mr-1"
    >
      {visible.map((subscriber) => (
        <TooltipTrigger
          key={subscriber.id}
          handle={tooltipHandle}
          payload={`${displayName(subscriber)} · Subscribed`}
          render={
            <Avatar
              size="sm"
              className="size-6 transition-transform duration-200 hover:-translate-y-0.5"
            />
          }
        >
          {subscriber.image && (
            <AvatarImage src={subscriber.image} alt={displayName(subscriber)} />
          )}
          <AvatarFallback
            avatarColor={subscriber.avatarColor}
            fallbackSeed={subscriber.name}
            className="text-[10px] font-semibold"
          >
            {displayName(subscriber).slice(0, 1).toUpperCase()}
          </AvatarFallback>
        </TooltipTrigger>
      ))}
      {overflow > 0 && (
        <AvatarGroupCount className="size-6 text-[10px]">
          +{overflow}
        </AvatarGroupCount>
      )}
      <Tooltip handle={tooltipHandle}>
        {({ payload }) => (
          <TooltipContent side="bottom">{payload}</TooltipContent>
        )}
      </Tooltip>
    </AvatarGroup>
  )
}
