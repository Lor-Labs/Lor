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
  TooltipTrigger,
} from "@repo/ui/components/tooltip"
import type { ThreadParticipant } from "@/hooks/use-thread-messages"

const VISIBLE_SUBSCRIBERS = 4

function displayName(participant: ThreadParticipant) {
  return participant.displayUsername ?? participant.name
}

export function ThreadSubscriberStack({
  subscribers,
}: {
  subscribers: ThreadParticipant[]
}) {
  if (subscribers.length === 0) return null

  const visible = subscribers.slice(0, VISIBLE_SUBSCRIBERS)
  const overflow = subscribers.length - visible.length

  return (
    <AvatarGroup
      aria-label={`${subscribers.length} thread ${subscribers.length === 1 ? "subscriber" : "subscribers"}`}
      className="mr-1"
    >
      {visible.map((subscriber) => (
        <Tooltip key={subscriber.id}>
          <TooltipTrigger
            render={
              <Avatar
                size="sm"
                className="size-6 transition-transform duration-200 hover:-translate-y-0.5"
              />
            }
          >
            {subscriber.image && (
              <AvatarImage
                src={subscriber.image}
                alt={displayName(subscriber)}
              />
            )}
            <AvatarFallback
              avatarColor={subscriber.avatarColor}
              fallbackSeed={subscriber.name}
              className="text-[10px] font-semibold"
            >
              {displayName(subscriber).slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {displayName(subscriber)} · Subscribed
          </TooltipContent>
        </Tooltip>
      ))}
      {overflow > 0 && (
        <AvatarGroupCount className="size-6 text-[10px]">
          +{overflow}
        </AvatarGroupCount>
      )}
    </AvatarGroup>
  )
}
