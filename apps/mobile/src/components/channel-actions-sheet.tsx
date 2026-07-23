import { BottomSheetScrollView } from "@gorhom/bottom-sheet"
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon"
import HashIcon from "@hugeicons/core-free-icons/HashIcon"
import MailOpen01Icon from "@hugeicons/core-free-icons/MailOpen01Icon"
import Notification03Icon from "@hugeicons/core-free-icons/Notification03Icon"
import NotificationOff03Icon from "@hugeicons/core-free-icons/NotificationOff03Icon"
import VolumeHighIcon from "@hugeicons/core-free-icons/VolumeHighIcon"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native"
import * as Clipboard from "expo-clipboard"
import { BottomSheet } from "heroui-native/bottom-sheet"
import { useThemeColor } from "heroui-native/hooks"
import { useEffect, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { triggerHaptic } from "@/components/ui/haptics"
import { useUnread } from "@/context/unread-context"
import {
  mutedUntilLabel,
  promptChannelMute,
  useChannelMutes,
} from "@/hooks/use-channel-mutes"
import type { Channel } from "@/lib/api-types"

export function ChannelActionsSheet({
  channel,
  onOpenChange,
  workspaceName,
}: {
  channel: Channel | null
  onOpenChange: (isOpen: boolean) => void
  workspaceName: string
}) {
  const [copied, setCopied] = useState(false)
  const foreground = useThemeColor("foreground")
  const { getMute, muteChannel, unmuteChannel } = useChannelMutes()
  const { getUnreadCount, getMentionCount, markChannelRead } = useUnread()

  const channelId = channel?.id
  useEffect(() => {
    setCopied(false)
  }, [channelId])

  const mute = channel ? getMute(channel.id) : null
  const hasActivity = channel
    ? getUnreadCount(channel.id) > 0 || getMentionCount(channel.id) > 0
    : false

  return (
    <BottomSheet isOpen={channel !== null} onOpenChange={onOpenChange}>
      <BottomSheet.Portal unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay className="bg-neutral-950/50" />
        <BottomSheet.Content enableDynamicSizing={false} snapPoints={["52%"]}>
          <BottomSheetScrollView
            contentContainerStyle={{ gap: 24, paddingBottom: 40 }}
            showsVerticalScrollIndicator={false}
          >
            {channel ? (
              <>
                <View className="flex-row items-start gap-three px-one">
                  <View className="size-10 items-center justify-center rounded-lor-sm bg-surface-secondary">
                    <HugeiconsIcon
                      color={foreground}
                      icon={
                        channel.type === "voice" ? VolumeHighIcon : HashIcon
                      }
                      size={20}
                    />
                  </View>
                  <View className="min-w-0 flex-1 gap-px">
                    <BottomSheet.Title>
                      {channel.name ?? "Channel"}
                    </BottomSheet.Title>
                    <BottomSheet.Description>
                      {workspaceName}
                    </BottomSheet.Description>
                  </View>
                  <BottomSheet.Close />
                </View>

                <View className="gap-two px-one">
                  <ActionRow
                    detail={
                      hasActivity
                        ? "Clear unread and mention badges"
                        : "You're all caught up"
                    }
                    icon={MailOpen01Icon}
                    label="Mark as read"
                    onPress={() => {
                      triggerHaptic("soft")
                      markChannelRead(channel.id)
                      onOpenChange(false)
                    }}
                  />
                  <ActionRow
                    detail={
                      mute
                        ? mutedUntilLabel(mute.mutedUntil)
                        : "Silence notifications from this channel"
                    }
                    icon={mute ? NotificationOff03Icon : Notification03Icon}
                    label={mute ? "Muted" : "Mute channel"}
                    onPress={() => {
                      triggerHaptic("soft")
                      promptChannelMute({
                        channelId: channel.id,
                        channelLabel: `#${channel.name ?? "channel"}`,
                        mute,
                        muteChannel,
                        unmuteChannel,
                      })
                    }}
                  />
                  <ActionRow
                    detail={
                      copied
                        ? "Copied to clipboard"
                        : "For webhooks and integrations"
                    }
                    icon={Copy01Icon}
                    label="Copy channel ID"
                    onPress={() => {
                      void Clipboard.setStringAsync(channel.id)
                      triggerHaptic("success")
                      setCopied(true)
                    }}
                  />
                </View>
              </>
            ) : null}
          </BottomSheetScrollView>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  )
}

function ActionRow({
  detail,
  icon,
  label,
  onPress,
}: {
  detail: string
  icon: IconSvgElement
  label: string
  onPress: () => void
}) {
  const foreground = useThemeColor("foreground")
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      className="min-h-14 flex-row items-center gap-three rounded-lor-sm bg-surface-secondary px-three py-three active:bg-surface-tertiary"
      onPress={onPress}
    >
      <View className="size-9 items-center justify-center rounded-lor-sm bg-surface-tertiary">
        <HugeiconsIcon color={foreground} icon={icon} size={19} />
      </View>
      <View className="min-w-0 flex-1 gap-px">
        <Text className="text-[15px] font-semibold text-foreground">
          {label}
        </Text>
        <Text className="text-xs leading-4 text-muted" numberOfLines={1}>
          {detail}
        </Text>
      </View>
    </Pressable>
  )
}
