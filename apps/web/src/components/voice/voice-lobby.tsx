import { Delete02Icon, MoreHorizontalIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { AvatarGroup, AvatarGroupCount } from "@repo/ui/components/avatar"
import { Button } from "@repo/ui/components/button"
import { MentionBadge } from "@repo/ui/components/mention-badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui/components/menu"
import { Skeleton } from "@repo/ui/components/skeleton"
import { cn } from "@repo/ui/lib/utils"
import {
  differenceInMinutes,
  formatDuration,
  formatTime,
  getDayLabel,
} from "@repo/utils/date"
import { useState } from "react"
import { CallHero } from "@/components/voice/call-hero"
import { ParticipantAvatar } from "@/components/voice/participant-avatar"
import type { JoinDevices } from "@/context/voice-call-context"
import { isCallBeingDeleted } from "@/hooks/use-delete-call"
import type { VoiceParticipant } from "@/hooks/use-voice-presence"
import {
  useVoiceSessions,
  type VoiceSessionSummary,
} from "@/hooks/use-voice-sessions"

const STACK_LIMIT = 4

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`
}

export function ParticipantStack({
  participants,
}: {
  participants: VoiceParticipant[]
}) {
  const shown = participants.slice(0, STACK_LIMIT)
  const extra = participants.length - shown.length
  return (
    <AvatarGroup className="shrink-0">
      {shown.map((participant) => (
        <ParticipantAvatar key={participant.userId} participant={participant} />
      ))}
      {extra > 0 && (
        <AvatarGroupCount className="size-6 text-xs">+{extra}</AvatarGroupCount>
      )}
    </AvatarGroup>
  )
}

function SessionRow({
  session,
  active,
  onOpen,
  onDelete,
}: {
  session: VoiceSessionSummary
  active: boolean
  onOpen: (() => void) | null
  onDelete: (() => void) | null
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const minutes = session.endedAt
    ? differenceInMinutes(session.startedAt, session.endedAt)
    : 0
  const details = [
    formatDuration(minutes),
    plural(session.participants.length, "person", "people"),
    session.replyCount > 0
      ? plural(session.replyCount, "message", "messages")
      : null,
  ].filter(Boolean)
  // The open chat marks itself read; don't flash a badge on it meanwhile.
  const mentions = active ? 0 : session.mentionCount
  const unread = active ? 0 : session.unreadCount
  const body = (
    <>
      <ParticipantStack participants={session.participants} />
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate text-sm",
            unread > 0 || mentions > 0
              ? "font-semibold text-foreground"
              : "font-medium text-foreground/80"
          )}
        >
          {getDayLabel(session.startedAt)} · {formatTime(session.startedAt)}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {details.join(" · ")}
        </div>
      </div>
      {/* Like the sidebar: a count only for mentions, a dot for unread. The
          options button takes their place on hover. */}
      <span
        className={cn(
          "flex shrink-0 items-center",
          onDelete && "group-hover/row:opacity-0",
          menuOpen && "opacity-0"
        )}
      >
        {mentions > 0 ? (
          <MentionBadge count={mentions} />
        ) : (
          unread > 0 && (
            <span className="mr-1 size-1.5 rounded-full bg-foreground">
              <span className="sr-only">Unread messages</span>
            </span>
          )
        )}
      </span>
    </>
  )

  return (
    <li className="group/row relative">
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className={cn(
            "flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent",
            (active || menuOpen) && "bg-accent"
          )}
        >
          {body}
        </button>
      ) : (
        <div className="flex items-center gap-3 rounded-lg px-3 py-2.5">
          {body}
        </div>
      )}
      {onDelete && (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Call options"
                className={cn(
                  "absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity duration-150 hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100",
                  menuOpen && "opacity-100"
                )}
              />
            }
          >
            <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={2} />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="end">
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
              Delete call
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  )
}

export function VoiceLobby({
  channelId,
  channelName,
  workspaceId,
  joinLabel,
  joinDisabled,
  note,
  onJoin,
  openThreadRootId,
  onOpenSession,
  onDeleteSession,
}: {
  channelId: string
  channelName: string
  workspaceId: string | undefined
  joinLabel: string | undefined
  joinDisabled: boolean
  note: string | undefined
  onJoin: (devices: JoinDevices) => void
  openThreadRootId: string | null
  onOpenSession: (threadRootId: string, tab: "chat" | "transcript") => void
  // Only for people allowed to delete calls.
  onDeleteSession?: (session: VoiceSessionSummary) => void
}) {
  const {
    data,
    isPending,
    isError,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useVoiceSessions(channelId, workspaceId)
  const sessions = data?.pages.flatMap((page) => page.sessions) ?? []
  const live = sessions.find((session) => session.live)
  const past = sessions.filter(
    (session) => !session.live && !isCallBeingDeleted(session.id)
  )

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
        <CallHero
          channelName={channelName}
          session={live}
          joinLabel={joinLabel}
          joinDisabled={joinDisabled}
          note={note}
          onJoin={onJoin}
        />
        <section className="flex flex-col gap-2">
          <h2 className="px-3 text-sm font-medium">Past calls</h2>
          {isPending && (
            <div className="flex flex-col gap-2 px-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}
          {isError && (
            <span className="px-3 text-sm text-muted-foreground">
              Couldn't load past calls.
            </span>
          )}
          {!isPending && !isError && past.length === 0 && (
            <span className="px-3 text-sm text-muted-foreground">
              No past calls yet.
            </span>
          )}
          {past.length > 0 && (
            <ul className="flex flex-col">
              {past.map((session) => {
                const threadRootId = session.threadRootId
                // Chat holds Lor's summary card and anything people wrote,
                // so a past call opens there; a call with an empty chat
                // opens on its transcript.
                const tab =
                  session.hasSummaryCard || session.replyCount > 0
                    ? "chat"
                    : "transcript"
                return (
                  <SessionRow
                    key={session.id}
                    session={session}
                    active={
                      threadRootId !== null && threadRootId === openThreadRootId
                    }
                    onOpen={
                      threadRootId
                        ? () => onOpenSession(threadRootId, tab)
                        : null
                    }
                    onDelete={
                      onDeleteSession ? () => onDeleteSession(session) : null
                    }
                  />
                )
              })}
            </ul>
          )}
          {hasNextPage && (
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              disabled={isFetchingNextPage}
              onClick={() => void fetchNextPage()}
            >
              {isFetchingNextPage ? "Loading…" : "Show older calls"}
            </Button>
          )}
        </section>
      </div>
    </div>
  )
}
