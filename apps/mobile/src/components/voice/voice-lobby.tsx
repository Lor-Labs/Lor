import Mic01Icon from "@hugeicons/core-free-icons/Mic01Icon"
import MicOff01Icon from "@hugeicons/core-free-icons/MicOff01Icon"
import Video01Icon from "@hugeicons/core-free-icons/Video01Icon"
import VideoOffIcon from "@hugeicons/core-free-icons/VideoOffIcon"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native"
import {
  type MediaStream,
  mediaDevices,
  RTCView,
} from "@livekit/react-native-webrtc"
import { whoIsHere } from "@repo/realtime-types/voice-presence"
import {
  differenceInMinutes,
  formatDuration,
  formatTime,
  getDayLabel,
} from "@repo/utils/date"
import { useThemeColor } from "heroui-native/hooks"
import { useEffect, useRef, useState } from "react"
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native"
import { MentionBadge } from "@/components/channel-list"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Skeleton } from "@/components/ui/skeleton"
import type { JoinDevices } from "@/context/voice-call-context"
import { useWorkspace } from "@/context/workspace-context"
import {
  useVoiceSessions,
  type VoiceParticipant,
  type VoiceSessionSummary,
} from "@/hooks/use-voice-sessions"
import { authClient } from "@/lib/auth-client"

const STACK_LIMIT = 4
// The lobby's `p-four` padding, for the preview's height.
const LOBBY_PADDING = 16

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

function DeviceToggle({
  on,
  label,
  onIcon,
  offIcon,
  disabled,
  onToggle,
}: {
  on: boolean
  label: string
  onIcon: IconSvgElement
  offIcon: IconSvgElement
  disabled: boolean
  onToggle: () => void
}) {
  const [foreground, dangerForeground] = useThemeColor([
    "foreground",
    "danger-foreground",
  ])
  return (
    <IconButton
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      className="rounded-full"
      isDisabled={disabled}
      onPress={onToggle}
      size="lg"
      variant={on ? "secondary" : "danger"}
    >
      <HugeiconsIcon
        color={on ? foreground : dangerForeground}
        icon={on ? onIcon : offIcon}
        size={20}
        strokeWidth={2}
      />
    </IconButton>
  )
}

// Your camera, before you join. Started only when you turn the camera on, so
// opening a voice channel never asks for camera access; stopped when it's
// turned off or you join.
function CameraPreview({ onFail }: { onFail: () => void }) {
  const [stream, setStream] = useState<MediaStream | null>(null)
  const failRef = useRef(onFail)
  failRef.current = onFail
  useEffect(() => {
    let cancelled = false
    let current: MediaStream | null = null
    mediaDevices
      .getUserMedia({ video: { facingMode: "user" }, audio: false })
      .then((next) => {
        if (cancelled) {
          for (const track of next.getTracks()) track.stop()
          return
        }
        current = next
        setStream(next)
      })
      .catch(() => failRef.current())
    return () => {
      cancelled = true
      for (const track of current?.getTracks() ?? []) track.stop()
    }
  }, [])
  if (!stream) return null
  return (
    <RTCView
      mirror
      objectFit="cover"
      streamURL={stream.toURL()}
      style={StyleSheet.absoluteFill}
    />
  )
}

// A voice channel before you join, like Google Meet's: how you'll appear
// (your camera, or your avatar with it off) with the microphone and camera
// choices on it, then who's in the call and Join. Same as web.
function CallHero({
  channelName,
  session,
  joinLabel,
  joinDisabled,
  note,
  onJoin,
}: {
  channelName: string
  session: VoiceSessionSummary | undefined
  // Replaces "Join call" / "Start call" while joining, transferring, or
  // switching calls.
  joinLabel: string | undefined
  joinDisabled: boolean
  note: string | undefined
  onJoin: (devices: JoinDevices) => void
}) {
  const { width } = useWindowDimensions()
  const { data: auth } = authClient.useSession()
  const { avatarColor } = useWorkspace()
  const [microphone, setMicrophone] = useState(true)
  const [camera, setCamera] = useState(false)
  // The preview lets go of the camera before the call takes it.
  const [previewing, setPreviewing] = useState(true)
  const connected = session?.participants.filter((p) => p.connected) ?? []
  const live = session !== undefined && connected.length > 0
  // 4:3, across the lobby's padded width.
  const previewHeight = ((width - LOBBY_PADDING * 2) * 3) / 4

  return (
    <View className="gap-four">
      <View
        className="overflow-hidden rounded-lor-lg bg-surface-secondary"
        style={{ height: previewHeight }}
      >
        {camera && previewing ? (
          <CameraPreview
            onFail={() => {
              setCamera(false)
              Alert.alert("Camera unavailable")
            }}
          />
        ) : (
          <View className="flex-1 items-center justify-center gap-three">
            {auth?.user ? (
              <Avatar
                avatarColor={avatarColor}
                className="size-20"
                image={auth.user.image}
                name={auth.user.name}
                size="lg"
              />
            ) : null}
            <Text className="text-[14px] text-muted">Camera is off</Text>
          </View>
        )}
        <View className="absolute inset-x-0 bottom-three flex-row justify-center gap-three">
          <DeviceToggle
            disabled={joinDisabled}
            label="Microphone"
            offIcon={MicOff01Icon}
            on={microphone}
            onIcon={Mic01Icon}
            onToggle={() => setMicrophone((on) => !on)}
          />
          <DeviceToggle
            disabled={joinDisabled}
            label="Camera"
            offIcon={VideoOffIcon}
            on={camera}
            onIcon={Video01Icon}
            onToggle={() => setCamera((on) => !on)}
          />
        </View>
      </View>
      <View className="items-center gap-two">
        {live ? <ParticipantStack participants={connected} /> : null}
        <Text className="text-center text-[18px] font-semibold leading-6 text-foreground">
          {live
            ? whoIsHere(connected.map((participant) => participant.name))
            : `It's quiet in ${channelName}`}
        </Text>
        {live ? (
          <View className="flex-row items-center gap-two">
            <View className="size-2 rounded-full bg-success" />
            <Text className="text-[14px] text-muted">
              Live for{" "}
              {formatDuration(
                differenceInMinutes(session.startedAt, new Date())
              ).toLowerCase()}
            </Text>
          </View>
        ) : (
          <Text className="text-center text-[14px] text-muted">
            Start a call and others can drop in.
          </Text>
        )}
      </View>
      <Button
        isDisabled={joinDisabled}
        onPress={() => {
          setPreviewing(false)
          onJoin({ microphone, camera })
        }}
        size="lg"
      >
        <Button.Label>
          {joinLabel ?? (live ? "Join call" : "Start call")}
        </Button.Label>
      </Button>
      {note ? (
        <Text className="text-center text-[13px] text-muted">{note}</Text>
      ) : null}
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
// call opens its chat, where Lor's summary card sits; a call with an empty
// chat opens on its transcript, like web.
export function VoiceLobby({
  channelId,
  channelName,
  workspaceId,
  joining,
  onJoin,
  onOpenCall,
  otherCallName,
}: {
  channelId: string
  channelName: string
  workspaceId: string | undefined
  joining: boolean
  onJoin: (devices: JoinDevices) => void
  onOpenCall: (threadRootId: string, tab: "chat" | "transcript") => void
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
      <CallHero
        channelName={channelName}
        joinDisabled={joining}
        joinLabel={
          joining
            ? "Joining…"
            : onAnotherDevice
              ? "Transfer here"
              : otherCallName
                ? "Switch to this call"
                : undefined
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
              const tab =
                session.hasSummaryCard || session.replyCount > 0
                  ? "chat"
                  : "transcript"
              return (
                <CallRow
                  key={session.id}
                  onOpen={
                    threadRootId ? () => onOpenCall(threadRootId, tab) : null
                  }
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
