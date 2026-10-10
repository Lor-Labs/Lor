import {
  Tick02Icon,
  UserAdd01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import type { RealtimeAgentSession } from "@repo/realtime-types"
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@repo/ui/components/avatar"
import { Combobox, ComboboxPrimitive } from "@repo/ui/components/combobox"
import { Kbd } from "@repo/ui/components/kbd"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@repo/ui/components/tooltip"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"
import { useChannelPeople } from "@/hooks/use-mention-candidates"
import {
  type ThreadSubscriber,
  useThreadSubscribers,
} from "@/hooks/use-thread-subscribers"
import { channelQueryOptions } from "@/lib/channel-query"

const VISIBLE_SUBSCRIBERS = 3

// Session and thread header: Subscribe/Unsubscribe, the subscriber avatars,
// and "Change subscribers…" (⌘⇧S), after Linear's issue subscribers.
export function ThreadSubscribers({
  workspaceSlug,
  channelId,
  threadRootId,
  session,
  facesOnly = false,
}: {
  workspaceSlug: string
  channelId: string
  threadRootId: string
  // Set on a session page, so following it moves its sidebar row at once.
  session?: RealtimeAgentSession
  // Session strip: only the faces show; you follow or leave by ticking
  // yourself in the list.
  facesOnly?: boolean
}) {
  const { data: authSession } = authClient.useSession()
  const currentUserId = authSession?.user.id
  const { subscribers, setSubscribed, subscribeEveryone } =
    useThreadSubscribers({
      workspaceSlug,
      channelId,
      threadRootId,
      session,
    })
  const members = useChannelPeople(workspaceSlug, channelId)
  const { data: channel } = useQuery(
    channelQueryOptions(workspaceSlug, channelId)
  )
  const [open, setOpen] = useState(false)
  // Frozen while the picker is open, so rows don't jump as you tick them.
  const [subscribedAtOpen, setSubscribedAtOpen] = useState<ReadonlySet<string>>(
    () => new Set()
  )

  const people = useMemo(
    () =>
      members.map(
        (member): ThreadSubscriber => ({
          id: member.userId,
          name: member.name,
          image: member.image,
          avatarColor: member.avatarColor,
        })
      ),
    [members]
  )
  // Subscribers who lost channel access stay listed so they can be removed.
  const candidates = useMemo(() => {
    const byId = new Map<string, ThreadSubscriber>()
    for (const subscriber of subscribers) byId.set(subscriber.id, subscriber)
    for (const person of people) {
      if (!byId.has(person.id)) byId.set(person.id, person)
    }
    return [...byId.values()].sort(
      (a, b) =>
        Number(subscribedAtOpen.has(b.id)) -
          Number(subscribedAtOpen.has(a.id)) || a.name.localeCompare(b.name)
    )
  }, [subscribers, people, subscribedAtOpen])
  const subscribedIds = new Set(subscribers.map((person) => person.id))
  const everyoneSubscribed =
    people.length > 0 && people.every((person) => subscribedIds.has(person.id))

  const me = candidates.find((person) => person.id === currentUserId)
  const isSubscribed = subscribers.some((person) => person.id === currentUserId)

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setSubscribedAtOpen(new Set(subscribers.map((person) => person.id)))
    }
    setOpen(next)
  }
  const openRef = useRef(handleOpenChange)
  openRef.current = handleOpenChange
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "s"
      ) {
        event.preventDefault()
        openRef.current(true)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  const handleValueChange = (next: ThreadSubscriber[]) => {
    const nextIds = new Set(next.map((person) => person.id))
    const currentIds = new Set(subscribers.map((person) => person.id))
    for (const person of next) {
      if (!currentIds.has(person.id)) setSubscribed(person, true)
    }
    for (const person of subscribers) {
      if (!nextIds.has(person.id)) setSubscribed(person, false)
    }
  }

  const visible = subscribers.slice(0, VISIBLE_SUBSCRIBERS)
  const overflow = subscribers.length - visible.length

  return (
    <div className="flex items-center gap-1">
      {me && !facesOnly && (
        <button
          type="button"
          onClick={() => setSubscribed(me, !isSubscribed)}
          className="h-7 cursor-pointer rounded-md px-2 text-[13px] text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
        >
          {isSubscribed ? "Unsubscribe" : "Subscribe"}
        </button>
      )}
      <Combobox<ThreadSubscriber, true>
        multiple
        items={candidates}
        value={subscribers}
        onValueChange={handleValueChange}
        itemToStringLabel={(person) => person.name}
        isItemEqualToValue={(a, b) => a.id === b.id}
        open={open}
        onOpenChange={handleOpenChange}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <ComboboxPrimitive.Trigger
                aria-label="Change subscribers"
                className="flex h-7 cursor-pointer items-center rounded-full px-1 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground data-popup-open:bg-foreground/5"
              />
            }
          >
            {subscribers.length > 0 && (
              <AvatarGroup className="-space-x-1">
                {visible.map((person) => (
                  <PersonAvatar key={person.id} person={person} />
                ))}
                {overflow > 0 && (
                  <AvatarGroupCount className="size-5 text-[10px]">
                    +{overflow}
                  </AvatarGroupCount>
                )}
              </AvatarGroup>
            )}
            {subscribers.length === 0 && (
              <HugeiconsIcon
                icon={UserAdd01Icon}
                className="size-4"
                strokeWidth={2}
              />
            )}
          </TooltipTrigger>
          <TooltipContent side="bottom">Change subscribers</TooltipContent>
        </Tooltip>
        <ComboboxPrimitive.Portal>
          <ComboboxPrimitive.Positioner
            align="end"
            sideOffset={4}
            className="z-50"
          >
            <ComboboxPrimitive.Popup className="w-60 origin-(--transform-origin) overflow-hidden rounded-lg border bg-popover text-foreground shadow-lg/5 outline-none not-dark:bg-clip-padding">
              <div className="flex items-center gap-2 border-b border-border/70 py-1.5 ps-3 pe-2">
                <ComboboxPrimitive.Input
                  placeholder="Change subscribers…"
                  className="h-6 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
                />
                <Kbd className="shrink-0 tracking-wide">⌘⇧S</Kbd>
              </div>
              {/* Puts it in every member's sidebar without posting in the
                  chat (a loop's "everyone in the channel" option). */}
              {!everyoneSubscribed && people.length > 1 && (
                <div className="border-border/70 border-b p-1">
                  <button
                    type="button"
                    onClick={() => subscribeEveryone(people)}
                    className="flex min-h-7 w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-left text-[13px] outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <span className="size-3.5 shrink-0" />
                    <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
                      <HugeiconsIcon
                        icon={UserGroupIcon}
                        size={14}
                        strokeWidth={2}
                      />
                    </span>
                    <span className="min-w-0 truncate">
                      Everyone in #{channel?.name ?? "channel"}
                    </span>
                  </button>
                </div>
              )}
              <ComboboxPrimitive.Empty className="px-3 py-2 text-[13px] text-muted-foreground empty:hidden">
                No people found
              </ComboboxPrimitive.Empty>
              <ComboboxPrimitive.List className="max-h-64 overflow-y-auto p-1 empty:hidden">
                {(person: ThreadSubscriber) => (
                  <ComboboxPrimitive.Item
                    key={person.id}
                    value={person}
                    className="group flex min-h-7 cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1 text-[13px] outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                  >
                    <span className="flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border border-input opacity-0 transition-opacity group-data-highlighted:opacity-100 group-data-selected:border-primary group-data-selected:bg-primary group-data-selected:text-primary-foreground group-data-selected:opacity-100">
                      <HugeiconsIcon
                        icon={Tick02Icon}
                        className="size-2.5 opacity-0 group-data-selected:opacity-100"
                        strokeWidth={3}
                      />
                    </span>
                    <PersonAvatar person={person} />
                    <span className="min-w-0 truncate">
                      {person.name}
                      {person.id === currentUserId && (
                        <span className="text-muted-foreground"> (you)</span>
                      )}
                    </span>
                  </ComboboxPrimitive.Item>
                )}
              </ComboboxPrimitive.List>
            </ComboboxPrimitive.Popup>
          </ComboboxPrimitive.Positioner>
        </ComboboxPrimitive.Portal>
      </Combobox>
    </div>
  )
}

function PersonAvatar({ person }: { person: ThreadSubscriber }) {
  return (
    <Avatar size="sm" className="size-5">
      {person.image && <AvatarImage src={person.image} alt={person.name} />}
      <AvatarFallback
        avatarColor={person.avatarColor}
        fallbackSeed={person.name}
        className="text-[10px] font-semibold"
      >
        {person.name.slice(0, 1).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  )
}
