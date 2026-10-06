import Mic01Icon from "@hugeicons/core-free-icons/Mic01Icon"
import MicOff01Icon from "@hugeicons/core-free-icons/MicOff01Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useLocalParticipant } from "@livekit/react-native"
import { formatCallOffset } from "@repo/utils/date"
import { router, usePathname } from "expo-router"
import { useThemeColor } from "heroui-native/hooks"
import { useEffect, useState } from "react"
import { Alert, Pressable, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { IconButton } from "@/components/ui/icon-button"
import {
  type ActiveVoiceCall,
  useVoiceCall,
} from "@/context/voice-call-context"
import { useWorkspace } from "@/context/workspace-context"

function useElapsed(since: number) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return formatCallOffset(Math.max(0, now - since))
}

function CallBarContent({ call }: { call: ActiveVoiceCall }) {
  const insets = useSafeAreaInsets()
  const [foreground, danger] = useThemeColor(["foreground", "danger"])
  const { workspace, selectWorkspace } = useWorkspace()
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant()
  const elapsed = useElapsed(call.connectedAt)

  // The call keeps going across a workspace switch; returning to it switches
  // back.
  const returnToCall = async () => {
    if (workspace?.id !== call.workspaceId) {
      const switched = await selectWorkspace(call.workspaceId)
      if (!switched) return
    }
    router.navigate({
      pathname: "/channel/[channelId]",
      params: { channelId: call.channelId },
    } as never)
  }
  const toggleMicrophone = async () => {
    try {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)
    } catch {
      Alert.alert("Microphone unavailable")
    }
  }

  return (
    <View
      className="border-b border-separator bg-surface"
      style={{ paddingTop: insets.top }}
    >
      <View className="h-11 flex-row items-center gap-two pl-four pr-two">
        <Pressable
          accessibilityHint="Opens the call"
          accessibilityLabel={`In a call in ${call.channelName}, ${elapsed}`}
          accessibilityRole="button"
          className="h-full min-w-0 flex-1 flex-row items-center gap-two active:opacity-70"
          onPress={() => void returnToCall()}
        >
          <View className="size-2 rounded-full bg-success" />
          <Text
            className="shrink text-[15px] font-semibold text-foreground"
            numberOfLines={1}
          >
            {call.channelName}
          </Text>
          <Text className="text-[13px] text-muted tabular-nums">{elapsed}</Text>
        </Pressable>
        <IconButton
          accessibilityLabel={isMicrophoneEnabled ? "Mute" : "Unmute"}
          onPress={() => void toggleMicrophone()}
          variant="ghost"
        >
          <HugeiconsIcon
            color={isMicrophoneEnabled ? foreground : danger}
            icon={isMicrophoneEnabled ? Mic01Icon : MicOff01Icon}
            size={19}
            strokeWidth={2}
          />
        </IconButton>
      </View>
    </View>
  )
}

// Shown at the top of every screen while this phone is in a call, except the
// call's own screen. It takes the status bar's space, so screens below it
// lay out from its bottom edge (see the nested SafeAreaProvider in the root
// layout).
export function CallBar() {
  const { call } = useVoiceCall()
  const pathname = usePathname()
  if (!call || pathname === `/channel/${call.channelId}`) return null
  return <CallBarContent call={call} />
}
