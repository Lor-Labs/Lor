import {
  Notification01Icon,
  NotificationOff01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/components/menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@repo/ui/components/tooltip"
import { MUTE_DURATIONS, useChannelMutes } from "@/hooks/use-channel-mutes"

function mutedUntilLabel(mutedUntil: string | null) {
  if (!mutedUntil) return "Muted until you turn it back on"
  const until = new Date(mutedUntil)
  return `Muted until ${until.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`
}

export function ChannelMuteMenu({ channelId }: { channelId: string }) {
  const { getMute, muteChannel, unmuteChannel } = useChannelMutes()
  const mute = getMute(channelId)

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label={
                    mute ? "Muted — notification options" : "Mute channel"
                  }
                  className="rounded-sm p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                />
              }
            />
          }
        >
          {mute ? (
            <HugeiconsIcon
              icon={NotificationOff01Icon}
              className="size-4"
              aria-hidden="true"
              strokeWidth={2}
            />
          ) : (
            <HugeiconsIcon
              icon={Notification01Icon}
              className="size-4"
              aria-hidden="true"
              strokeWidth={2}
            />
          )}
        </TooltipTrigger>
        <TooltipContent>
          {mute ? mutedUntilLabel(mute.mutedUntil) : "Mute channel"}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        {mute ? (
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              {mutedUntilLabel(mute.mutedUntil)}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => unmuteChannel(channelId)}>
              Unmute
            </DropdownMenuItem>
          </DropdownMenuGroup>
        ) : (
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Mute notifications
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {MUTE_DURATIONS.map((duration) => (
              <DropdownMenuItem
                key={duration.label}
                onClick={() =>
                  muteChannel({ channelId, minutes: duration.minutes })
                }
              >
                {duration.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
