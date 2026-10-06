import {
  differenceInMinutes,
  formatDuration,
  formatTime,
  getDayLabel,
} from "@repo/utils/date"
import { useThemeColor } from "heroui-native/hooks"
import { Pressable, ScrollView, Text, View } from "react-native"
import { MentionBadge } from "@/components/channel-list"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  useVoiceSessions,
  type VoiceParticipant,
  type VoiceSessionSummary,
} from "@/hooks/use-voice-sessions"
import { authClient } from "@/lib/auth-client"

const STACK_LIMIT = 4

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`
}

export function ParticipantStack({
  participants,
  ringColor,
}: {
  participants: VoiceParticipant[]
  // The surface behind the stack, so overlapping avatars read as cut out.
  ringColor?: string
}) {
  const background = useThemeColor("background")
  const shown = participants.slice(0, STACK_LIMIT)
  const extra = participants.length - shown.length
  return (
    <View className="flex-row items-center">
      {shown.map((participant, index) => (
        <Avatar
          avatarColor={participant.avatarColor}
          className={index === 0 ? "size-7" : "-ml-two size-7"}
          image={participant.image}
          key={participant.userId}
          name={participant.name}
          size="xs"
          style={{ borderColor: ringColor ?? background, borderWidth: 2 }}
        />
      ))}
      {extra > 0 ? (
        <View className="-ml-two size-7 items-center justify-center rounded-full bg-surface-secondary">
          <Text className="text-[11px] font-semibold text-muted">+{extra}</Text>
        </View>
      ) : null}
    </View>
  )
}

function LiveCallCard({
  session,
  joinLabel,
  joinDisabled,
  note,
  onJoin,
}: {
  session: VoiceSessionSummary | undefined
  joinLabel: string
  joinDisabled: boolean
  note: string | undefined
  onJoin: () => void
}) {
  const surface = useThemeColor("surface")
  const connected = session?.participants.filter((p) => p.connected) ?? []
  return (
    <View className="gap-three rounded-lor-md border border-separator bg-surface p-four">
      {session && connected.length > 0 ? (
        <View className="flex-row items-center gap-three">
          <View className="min-w-0 flex-1 flex-row items-center gap-two">
            <View className="size-2 rounded-full bg-success" />
            <Text className="text-[15px] font-semibold text-foreground">
              Live for{" "}
              {formatDuration(
                differenceInMinutes(session.startedAt, new Date())
              ).toLowerCase()}
            </Text>
          </View>
          <ParticipantStack participants={connected} ringColor={surface} />
        </View>
      ) : (
        <Text className="text-[15px] text-muted">No one is here yet.</Text>
      )}
      {note ? <Text className="text-[13px] text-muted">{note}</Text> : null}
      <Button isDisabled={joinDisabled} onPress={onJoin}>
        <Button.Label>{joinLabel}</Button.Label>
      </Button>
    </View>
  )
}

function CallRow({
  session,
  onOpen,
}: {
  session: VoiceSessionSummary
  onOpen: (() => void) | null
}) {
  const minutes = session.endedAt
    ? differenceInMinutes(session.startedAt, session.endedAt)
    : 0
  const when = `${getDayLabel(session.startedAt)} · ${formatTime(session.startedAt)}`
  const details = [
    formatDuration(minutes),
    plural(session.participants.length, "person", "people"),
    session.replyCount > 0
      ? plural(session.replyCount, "message", "messages")
      : null,
  ]
    .filter(Boolean)
    .join(" · ")
  const emphasized = session.unreadCount > 0 || session.mentionCount > 0

  return (
    <Pressable
      accessibilityHint={onOpen ? "Opens the call chat" : undefined}
      accessibilityLabel={`${when}, ${details}${
        session.mentionCount > 0
          ? `, ${plural(session.mentionCount, "mention", "mentions")}`
          : session.unreadCount > 0
            ? ", unread messages"
            : ""
      }`}
      accessibilityRole={onOpen ? "button" : undefined}
      className="min-h-[56px] flex-row items-center gap-three rounded-lor-sm px-two py-two active:bg-surface-secondary"
      disabled={!onOpen}
      onPress={onOpen ?? undefined}
    >
      <ParticipantStack participants={session.participants} />
      <View className="min-w-0 flex-1 gap-px">
        <Text
          className={`text-[15px] ${
            emphasized
              ? "font-semibold text-foreground"
              : "font-medium text-foreground/80"
          }`}
          numberOfLines={1}
        >
          {when}
        </Text>
        <Text className="text-[13px] text-muted" numberOfLines={1}>
          {details}
        </Text>
      </View>
      {/* Like the channel list: a count only for mentions, a dot for unread. */}
      {session.mentionCount > 0 ? (
        <MentionBadge count={session.mentionCount} />
      ) : session.unreadCount > 0 ? (
        <View className="mr-one size-2 rounded-full bg-foreground" />
      ) : null}
    </Pressable>
  )
}

// A voice channel before you join: the live call, then past calls. A past
// call opens its chat, where Lor's summary card sits.
export function VoiceLobby({
  channelId,
  workspaceId,
  joining,
  onJoin,
  onOpenChat,
  otherCallName,
}: {
  channelId: string
  workspaceId: string | undefined
  joining: boolean
  onJoin: () => void
  onOpenChat: (threadRootId: string) => void
  // This phone is in a call in another channel.
  otherCallName: string | undefined
}) {
  const { data: auth } = authClient.useSession()
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
  // Joining moves the call here; the server ends it on the other device.
  const onAnotherDevice = Boolean(
    live?.participants.some(
      (participant) =>
        participant.connected && participant.userId === auth?.user.id
    )
  )

  return (
    <ScrollView contentContainerClassName="gap-six p-four">
      <LiveCallCard
        joinDisabled={joining}
        joinLabel={
          joining
            ? "Joining…"
            : onAnotherDevice
              ? "Transfer here"
              : otherCallName
                ? "Switch to this call"
                : "Join"
        }
        note={
          onAnotherDevice
            ? "You're in this call on another device."
            : otherCallName
              ? `You're in a call in ${otherCallName}.`
              : undefined
        }
        onJoin={onJoin}
        session={live}
      />
      <View className="gap-two">
        <Text className="px-two text-[13px] font-semibold text-muted">
          Past calls
        </Text>
        {isPending ? (
          <View className="gap-two px-two">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </View>
        ) : isError ? (
          <Text className="px-two text-[15px] text-muted">
            Couldn't load past calls.
          </Text>
        ) : past.length === 0 ? (
          <Text className="px-two text-[15px] text-muted">
            No past calls yet.
          </Text>
        ) : (
          <View>
            {past.map((session) => {
              const threadRootId = session.threadRootId
              return (
                <CallRow
                  key={session.id}
                  onOpen={threadRootId ? () => onOpenChat(threadRootId) : null}
                  session={session}
                />
              )
            })}
          </View>
        )}
        {hasNextPage ? (
          <Button
            className="self-start"
            isDisabled={isFetchingNextPage}
            onPress={() => void fetchNextPage()}
            size="sm"
            variant="ghost"
          >
            <Button.Label>
              {isFetchingNextPage ? "Loading…" : "Show older calls"}
            </Button.Label>
          </Button>
        ) : null}
      </View>
    </ScrollView>
  )
}
