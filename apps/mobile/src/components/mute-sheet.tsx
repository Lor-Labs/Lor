import { BottomSheet } from "heroui-native/bottom-sheet"
import { useCallback, useState } from "react"
import { Alert, Text, View } from "react-native"
import { triggerHaptic } from "@/components/ui/haptics"
import { PressableRow } from "@/components/ui/pressable-row"
import {
  type ChannelMute,
  MUTE_DURATIONS,
  mutedUntilLabel,
  useChannelMutes,
} from "@/hooks/use-channel-mutes"

type MuteTarget = { channelId: string; channelLabel: string }

const showError = (cause: unknown) => {
  triggerHaptic("error")
  Alert.alert(
    "Something went wrong",
    cause instanceof Error ? cause.message : "Please try again in a moment."
  )
}

// Mute a chat for a while, or unmute it. The durations are a sheet, not an
// Alert: Android's Alert keeps only three buttons.
export function useMutePrompt() {
  const { muteChannel, unmuteChannel } = useChannelMutes()
  const [target, setTarget] = useState<MuteTarget | null>(null)

  const promptMute = useCallback(
    (options: MuteTarget & { mute: ChannelMute | null }) => {
      if (!options.mute) {
        setTarget({
          channelId: options.channelId,
          channelLabel: options.channelLabel,
        })
        return
      }
      Alert.alert(
        `Unmute ${options.channelLabel}?`,
        mutedUntilLabel(options.mute.mutedUntil),
        [
          { style: "cancel", text: "Cancel" },
          {
            text: "Unmute",
            onPress: () => {
              triggerHaptic("selection")
              void unmuteChannel(options.channelId).catch(showError)
            },
          },
        ],
        { cancelable: true }
      )
    },
    [unmuteChannel]
  )

  const muteSheet = (
    <BottomSheet
      isOpen={target !== null}
      onOpenChange={(isOpen) => {
        if (!isOpen) setTarget(null)
      }}
    >
      <BottomSheet.Portal unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay className="bg-neutral-950/50" />
        <BottomSheet.Content>
          <View className="gap-four pb-six">
            <View className="gap-one px-one">
              <BottomSheet.Title numberOfLines={1}>
                Mute {target?.channelLabel ?? "chat"}
              </BottomSheet.Title>
              <BottomSheet.Description>
                You won't get notifications from this chat while it's muted, on
                any device. Unread badges are unaffected.
              </BottomSheet.Description>
            </View>
            <View className="overflow-hidden rounded-lor-lg bg-surface-secondary">
              {MUTE_DURATIONS.map((duration, index) => (
                <PressableRow
                  accessibilityLabel={`Mute ${duration.label.toLowerCase()}`}
                  accessibilityRole="button"
                  className="min-h-[52px] justify-center px-four"
                  highlightClassName="bg-surface-tertiary"
                  key={duration.label}
                  onPress={() => {
                    if (!target) return
                    triggerHaptic("selection")
                    setTarget(null)
                    void muteChannel(target.channelId, duration.minutes).catch(
                      showError
                    )
                  }}
                >
                  <View
                    className={`min-h-[52px] justify-center ${
                      index === MUTE_DURATIONS.length - 1
                        ? ""
                        : "border-b border-separator"
                    }`}
                  >
                    <Text className="text-[16px] text-foreground">
                      {duration.label}
                    </Text>
                  </View>
                </PressableRow>
              ))}
            </View>
          </View>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  )

  return { promptMute, muteSheet }
}
