import { AvatarGroup, AvatarGroupCount } from "@repo/ui/components/avatar"
import { Button } from "@repo/ui/components/button"
import { Skeleton } from "@repo/ui/components/skeleton"
import { differenceInMinutes, formatTime, getDayLabel } from "@repo/utils/date"
import { ParticipantAvatar } from "@/components/voice/participant-avatar"
import type { VoiceParticipant } from "@/hooks/use-voice-presence"
import {
  useVoiceSessions,
  type VoiceSessionSummary,
} from "@/hooks/use-voice-sessions"

const STACK_LIMIT = 4

function formatDuration(minutes: number) {
  const rounded = Math.round(minutes)
  if (rounded < 1) return "Under a minute"
  if (rounded < 60) return `${rounded} min`
  const hours = Math.floor(rounded / 60)
  const rest = rounded % 60
  return rest > 0 ? `${hours} hr ${rest} min` : `${hours} hr`
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`
}

function ParticipantStack({
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

function LiveSessionCard({
  session,
  joinLabel,
  joinDisabled,
  otherCallName,
  onJoin,
}: {
  session: VoiceSessionSummary | undefined
  joinLabel: string
  joinDisabled: boolean
  otherCallName: string | undefined
  onJoin: () => void
}) {
  const connected = session?.participants.filter((p) => p.connected) ?? []
  return (
    <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-4">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {session && connected.length > 0 ? (
          <>
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="size-2 shrink-0 rounded-full bg-success" />
              Live for{" "}
              {formatDuration(
                differenceInMinutes(session.startedAt, new Date())
              )}
            </div>
            <ParticipantStack participants={connected} />
          </>
        ) : (
          <span className="text-sm text-muted-foreground">
            No one is here yet.
          </span>
        )}
        {otherCallName && (
          <span className="text-xs text-muted-foreground">
            You're in a call in {otherCallName}.
          </span>
        )}
      </div>
      <Button onClick={onJoin} disabled={joinDisabled}>
        {joinLabel}
      </Button>
    </div>
  )
}

function SessionRow({ session }: { session: VoiceSessionSummary }) {
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

  return (
    <li className="flex items-center gap-3 rounded-lg px-3 py-2.5">
      <ParticipantStack participants={session.participants} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {getDayLabel(session.startedAt)} · {formatTime(session.startedAt)}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {details.join(" · ")}
        </div>
      </div>
    </li>
  )
}

export function VoiceLobby({
  channelId,
  workspaceId,
  otherCallName,
  joining,
  archived,
  onJoin,
}: {
  channelId: string
  workspaceId: string | undefined
  otherCallName: string | undefined
  joining: boolean
  archived: boolean
  onJoin: () => void
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
  const past = sessions.filter((session) => !session.live)
  const joinLabel = joining
    ? "Joining…"
    : otherCallName
      ? "Switch to this call"
      : "Join"

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-8">
        <LiveSessionCard
          session={live}
          joinLabel={joinLabel}
          joinDisabled={joining || archived}
          otherCallName={otherCallName}
          onJoin={onJoin}
        />
        <section className="flex flex-col gap-2">
          <h2 className="px-3 text-sm font-medium">Past sessions</h2>
          {isPending && (
            <div className="flex flex-col gap-2 px-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}
          {isError && (
            <span className="px-3 text-sm text-muted-foreground">
              Couldn't load past sessions.
            </span>
          )}
          {!isPending && !isError && past.length === 0 && (
            <span className="px-3 text-sm text-muted-foreground">
              No past sessions yet.
            </span>
          )}
          {past.length > 0 && (
            <ul className="flex flex-col">
              {past.map((session) => (
                <SessionRow key={session.id} session={session} />
              ))}
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
              {isFetchingNextPage ? "Loading…" : "Show older sessions"}
            </Button>
          )}
        </section>
      </div>
    </div>
  )
}
