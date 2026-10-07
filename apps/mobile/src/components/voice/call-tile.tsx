import MicOff01Icon from "@hugeicons/core-free-icons/MicOff01Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import {
  isTrackReference,
  type TrackReference,
  type TrackReferenceOrPlaceholder,
  useIsSpeaking,
  useLocalParticipant,
  useSpeakingParticipants,
  useTracks,
  VideoTrack,
} from "@livekit/react-native"
import { router, usePathname } from "expo-router"
import { useThemeColor } from "heroui-native/hooks"
import { cn } from "heroui-native/utils"
import { Track } from "livekit-client"
import { useEffect, useRef } from "react"
import { StyleSheet, Text, useWindowDimensions, View } from "react-native"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { scheduleOnRN } from "react-native-worklets"
import { Avatar } from "@/components/ui/avatar"
import {
  type ActiveVoiceCall,
  useVoiceCall,
} from "@/context/voice-call-context"
import { useWorkspace } from "@/context/workspace-context"

// A person stands in a tall tile; a screen share (usually landscape) gets a
// wide 16:9 one.
const PERSON_TILE = { width: 108, height: 144 }
const SHARE_TILE = { width: 176, height: 99 }
// Size and position move on one curve, so the edges against the tile's
// corner stay put while it reshapes.
const RESHAPE = { duration: 220, easing: Easing.out(Easing.cubic) }
const EDGE = 12
// Clears screen headers at the top and the tab bar or composer at the bottom.
const HEADER_CLEARANCE = 68
const FOOTER_CLEARANCE = 96
// How far a flick carries the tile before it picks a corner.
const FLICK_SECONDS = 0.15
// Critically damped and clamped: the tile glides into its corner and stops,
// never passing it.
const SNAP = { duration: 300, dampingRatio: 1, overshootClamping: true }

// Keeps a flick's speed only when it heads toward the corner, so the tile
// never drifts away before it comes back.
function speedToward(from: number, to: number, velocity: number) {
  "worklet"
  return Math.sign(to - from) === Math.sign(velocity) ? velocity : 0
}

type Corner = { right: boolean; bottom: boolean }
// The tile comes back where it was last left.
let lastCorner: Corner = { right: true, bottom: false }

// The person to show: whoever spoke last, so the tile follows the
// conversation; yourself when you're the only one here.
function useFeaturedTrack() {
  const tracks = useTracks([
    { source: Track.Source.Camera, withPlaceholder: true },
  ])
  const speaking = useSpeakingParticipants()
  const lastSpeaker = useRef<string | null>(null)
  const people = tracks.filter((track) => !track.participant.isAgent)
  const others = people.filter((track) => !track.participant.isLocal)
  const speaker = speaking.find(
    (participant) => !participant.isLocal && !participant.isAgent
  )
  if (speaker) lastSpeaker.current = speaker.identity
  const featured =
    others.find(
      (track) => track.participant.identity === lastSpeaker.current
    ) ??
    others[0] ??
    people[0]
  return { featured, alone: others.length === 0 }
}

function FeaturedParticipant({
  trackRef,
  alone,
}: {
  trackRef: TrackReferenceOrPlaceholder
  alone: boolean
}) {
  const { participant } = trackRef
  const isSpeaking = useIsSpeaking(participant)
  const { cameraFacing } = useVoiceCall()
  const showVideo = isTrackReference(trackRef) && !trackRef.publication.isMuted
  const name = participant.name || participant.identity

  return (
    <View
      className={cn(
        "flex-1 overflow-hidden rounded-lor-lg border-2",
        isSpeaking ? "border-accent" : "border-transparent"
      )}
    >
      {showVideo ? (
        <VideoTrack
          mirror={participant.isLocal && cameraFacing === "user"}
          objectFit="cover"
          style={StyleSheet.absoluteFill}
          trackRef={trackRef}
        />
      ) : (
        <View className="flex-1 items-center justify-center">
          <Avatar className="size-14" name={name} size="lg" />
        </View>
      )}
      <View className="absolute inset-x-two bottom-two items-start">
        <Text
          className="max-w-full rounded-lor-sm bg-background/80 px-one text-[11px] font-medium text-foreground"
          numberOfLines={1}
        >
          {alone ? "Only you" : name}
        </Text>
      </View>
    </View>
  )
}

// While someone shares their screen the tile shows the share, as Slack's,
// Meet's, and Zoom's call windows do; otherwise whoever spoke last.
function SharePreview({ trackRef }: { trackRef: TrackReference }) {
  const name = trackRef.participant.name || trackRef.participant.identity
  return (
    <View className="flex-1 overflow-hidden rounded-lor-lg">
      <VideoTrack
        objectFit="contain"
        style={StyleSheet.absoluteFill}
        trackRef={trackRef}
      />
      <View className="absolute inset-x-two bottom-two items-start">
        <Text
          className="max-w-full rounded-lor-sm bg-background/80 px-one text-[11px] font-medium text-foreground"
          numberOfLines={1}
        >
          {name}'s screen
        </Text>
      </View>
    </View>
  )
}

function FloatingTile({ call }: { call: ActiveVoiceCall }) {
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const { workspace, selectWorkspace } = useWorkspace()
  const [share] = useTracks([Track.Source.ScreenShare])
  const tile = share ? SHARE_TILE : PERSON_TILE

  const bounds = {
    left: insets.left + EDGE,
    right: width - insets.right - EDGE - tile.width,
    top: insets.top + HEADER_CLEARANCE,
    bottom: height - insets.bottom - FOOTER_CLEARANCE - tile.height,
  }
  const x = useSharedValue(lastCorner.right ? bounds.right : bounds.left)
  const y = useSharedValue(lastCorner.bottom ? bounds.bottom : bounds.top)
  const tileWidth = useSharedValue(tile.width)
  const tileHeight = useSharedValue(tile.height)
  const startX = useSharedValue(0)
  const startY = useSharedValue(0)
  const pressScale = useSharedValue(1)

  // A share starting or ending reshapes the tile in its corner.
  const toX = lastCorner.right ? bounds.right : bounds.left
  const toY = lastCorner.bottom ? bounds.bottom : bounds.top
  useEffect(() => {
    x.value = withTiming(toX, RESHAPE)
    y.value = withTiming(toY, RESHAPE)
    tileWidth.value = withTiming(tile.width, RESHAPE)
    tileHeight.value = withTiming(tile.height, RESHAPE)
  }, [tile, toX, toY, x, y, tileWidth, tileHeight])

  const saveCorner = (next: Corner) => {
    lastCorner = next
  }
  // The call keeps going across a workspace switch; opening it switches back.
  const openCall = async () => {
    if (workspace?.id !== call.workspaceId) {
      const switched = await selectWorkspace(call.workspaceId)
      if (!switched) return
    }
    router.navigate({
      pathname: "/channel/[channelId]",
      params: { channelId: call.channelId },
    } as never)
  }

  const pan = Gesture.Pan()
    .minDistance(6)
    .onStart(() => {
      startX.value = x.value
      startY.value = y.value
    })
    .onUpdate((event) => {
      x.value = startX.value + event.translationX
      y.value = startY.value + event.translationY
    })
    .onEnd((event) => {
      const projectedX = x.value + event.velocityX * FLICK_SECONDS
      const projectedY = y.value + event.velocityY * FLICK_SECONDS
      const next = {
        right: projectedX + tile.width / 2 > width / 2,
        bottom: projectedY + tile.height / 2 > height / 2,
      }
      const toX = next.right ? bounds.right : bounds.left
      const toY = next.bottom ? bounds.bottom : bounds.top
      x.value = withSpring(toX, {
        ...SNAP,
        velocity: speedToward(x.value, toX, event.velocityX),
      })
      y.value = withSpring(toY, {
        ...SNAP,
        velocity: speedToward(y.value, toY, event.velocityY),
      })
      scheduleOnRN(saveCorner, next)
    })
  const tap = Gesture.Tap()
    .onBegin(() => {
      pressScale.value = withTiming(0.96, { duration: 100 })
    })
    .onFinalize(() => {
      pressScale.value = withTiming(1, { duration: 160 })
    })
    .onEnd(() => {
      scheduleOnRN(openCall)
    })
  // A drag wins over a tap once the finger moves.
  const gesture = Gesture.Exclusive(pan, tap)

  const style = useAnimatedStyle(() => ({
    width: tileWidth.value,
    height: tileHeight.value,
    transform: [
      { translateX: x.value },
      { translateY: y.value },
      { scale: pressScale.value },
    ],
  }))

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessibilityHint="Opens the call. Drag to move it."
        accessibilityLabel={`In a call in ${call.channelName}`}
        accessibilityRole="button"
        className="absolute left-0 top-0 rounded-lor-lg bg-surface-secondary shadow-sm"
        entering={FadeIn.duration(180)}
        exiting={FadeOut.duration(140)}
        style={style}
      >
        <TileContent share={share} />
      </Animated.View>
    </GestureDetector>
  )
}

// Re-renders on every speaker change, so it's kept apart from the drag
// gesture above.
function TileContent({ share }: { share: TrackReference | undefined }) {
  const danger = useThemeColor("danger")
  const { isMicrophoneEnabled } = useLocalParticipant()
  const { featured, alone } = useFeaturedTrack()
  return (
    <>
      {share ? (
        <SharePreview trackRef={share} />
      ) : featured ? (
        <FeaturedParticipant alone={alone} trackRef={featured} />
      ) : null}
      {isMicrophoneEnabled ? null : (
        <View className="absolute right-two top-two size-6 items-center justify-center rounded-full bg-background/80">
          <HugeiconsIcon
            color={danger}
            icon={MicOff01Icon}
            size={13}
            strokeWidth={2}
          />
        </View>
      )}
    </>
  )
}

// Floats over every screen while this phone is in a call, except the call's
// own screen, like Discord's and Slack's call windows. Drag it to any corner;
// tap to go back to the call.
export function CallTile() {
  const { call } = useVoiceCall()
  const pathname = usePathname()
  if (!call || pathname === `/channel/${call.channelId}`) return null
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <FloatingTile call={call} />
    </View>
  )
}
