import { useEvent } from "expo"
import { useFocusEffect } from "expo-router"
import { useVideoPlayer, VideoView } from "expo-video"
import { Spinner } from "heroui-native/spinner"
import { useCallback } from "react"
import { AppState, Text, View } from "react-native"

export function VideoPreview({ url, name }: { url: string; name: string }) {
  const player = useVideoPlayer(url)
  const { status } = useEvent(player, "statusChange", { status: player.status })

  useFocusEffect(
    useCallback(() => {
      const subscription = AppState.addEventListener("change", (state) => {
        if (state !== "active") player.pause()
      })
      return () => subscription.remove()
    }, [player])
  )

  return (
    <View className="flex-1 bg-black">
      {status === "error" ? (
        <View className="flex-1 items-center justify-center px-eight">
          <Text
            accessibilityRole="alert"
            className="text-center text-sm text-stone-300"
          >
            Couldn't play this video. Use Share or Open in browser to watch in
            another player.
          </Text>
        </View>
      ) : (
        <>
          <VideoView
            accessibilityLabel={name}
            contentFit="contain"
            fullscreenOptions={{ enable: true }}
            nativeControls
            player={player}
            style={{ flex: 1 }}
          />
          {status === "loading" && (
            <View
              pointerEvents="none"
              className="absolute inset-0 items-center justify-center"
            >
              <Spinner accessibilityLabel="Loading video" />
            </View>
          )}
        </>
      )}
    </View>
  )
}
