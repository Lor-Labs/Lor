import { useConnectionState } from "@livekit/react-native"
import { useThemeColor } from "heroui-native/hooks"
import { ConnectionState } from "livekit-client"
import { ActivityIndicator, Text, View } from "react-native"

// A dropped connection would otherwise just look like silence. A pill at the
// top of the call screen, or over the whole floating tile (`overlay`). Only
// the full reconnect: during a signal-only one the audio keeps flowing.
export function ReconnectingNotice({ overlay = false }: { overlay?: boolean }) {
  const state = useConnectionState()
  const foreground = useThemeColor("foreground")
  if (state !== ConnectionState.Reconnecting) return null
  return (
    <View
      className={
        overlay
          ? "absolute inset-0 items-center justify-center bg-background/60"
          : "absolute inset-x-0 top-three items-center"
      }
      pointerEvents="none"
    >
      <View className="flex-row items-center gap-two rounded-lor-sm bg-background/90 px-two py-one">
        <ActivityIndicator color={foreground} size="small" />
        <Text
          className={`font-medium text-foreground ${
            overlay ? "text-[11px]" : "text-[13px]"
          }`}
        >
          Reconnecting…
        </Text>
      </View>
    </View>
  )
}
