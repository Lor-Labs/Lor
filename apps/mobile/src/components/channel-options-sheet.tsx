import {
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet"
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon"
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon"
import Edit02Icon from "@hugeicons/core-free-icons/Edit02Icon"
import HashIcon from "@hugeicons/core-free-icons/HashIcon"
import Notification03Icon from "@hugeicons/core-free-icons/Notification03Icon"
import NotificationOff03Icon from "@hugeicons/core-free-icons/NotificationOff03Icon"
import Pin02Icon from "@hugeicons/core-free-icons/Pin02Icon"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native"
import * as Clipboard from "expo-clipboard"
import { SymbolView } from "expo-symbols"
import { BottomSheet } from "heroui-native/bottom-sheet"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import { useEffect, useState } from "react"
import { Alert, Pressable, Text, View } from "react-native"
import { KeyboardController } from "react-native-keyboard-controller"
import { Button } from "@/components/ui/button"
import { SectionLabel } from "@/components/ui/section-label"
import {
  MUTE_DURATIONS,
  mutedUntilLabel,
  useChannelMutes,
} from "@/hooks/use-channel-mutes"
import { api, responseMessage } from "@/lib/api"
import type { ChannelDetail } from "@/lib/api-types"

type SheetView = "options" | "edit"

export function ChannelOptionsSheet({
  canDeleteChannel,
  canUpdateChannel,
  channel,
  isOpen,
  onChannelDeleted,
  onChannelUpdated,
  onOpenPinnedMessages,
  onOpenChange,
  workspaceName,
  workspaceSlug,
}: {
  canDeleteChannel: boolean
  canUpdateChannel: boolean
  channel: ChannelDetail
  isOpen: boolean
  onChannelDeleted: () => void
  onChannelUpdated: (channel: ChannelDetail) => void
  onOpenPinnedMessages: () => void
  onOpenChange: (isOpen: boolean) => void
  workspaceName: string
  workspaceSlug: string
}) {
  const [view, setView] = useState<SheetView>("options")
  const [name, setName] = useState(channel.name ?? "")
  const [topic, setTopic] = useState(channel.topic ?? "")
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [foreground, accent, danger] = useThemeColor([
    "foreground",
    "accent",
    "danger",
  ])
  const { getMute, muteChannel, unmuteChannel } = useChannelMutes()
  const mute = getMute(channel.id)
  useEffect(() => {
    if (!isOpen) return
    setView("options")
    setName(channel.name ?? "")
    setTopic(channel.topic ?? "")
    setFormError(null)
  }, [isOpen, channel.name, channel.topic])

  const saveChannel = async () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setFormError("Channel name is required.")
      return
    }

    setIsSaving(true)
    setFormError(null)
    try {
      const response = await api.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].$patch({
        param: { workspaceSlug, channelId: channel.id },
        json: { name: trimmedName, topic: topic.trim() || null },
      })
      if (!response.ok) {
        throw new Error(
          await responseMessage(response, "Could not save channel")
        )
      }
      const updated = await response.json()
      onChannelUpdated(updated)
      setView("options")
    } catch (cause) {
      setFormError(
        cause instanceof Error ? cause.message : "Could not save channel"
      )
    } finally {
      setIsSaving(false)
    }
  }

  const showMuteError = (cause: unknown) => {
    Alert.alert(
      "Something went wrong",
      cause instanceof Error ? cause.message : "Please try again in a moment."
    )
  }

  const pressMute = () => {
    const channelLabel = `#${channel.name ?? "channel"}`
    if (mute) {
      Alert.alert(`Unmute ${channelLabel}?`, mutedUntilLabel(mute.mutedUntil), [
        { style: "cancel", text: "Cancel" },
        {
          text: "Unmute",
          onPress: () => void unmuteChannel(channel.id).catch(showMuteError),
        },
      ])
      return
    }
    Alert.alert(
      `Mute ${channelLabel}`,
      "You won't get notifications from this channel while it's muted, on any device. Unread badges are unaffected.",
      [
        ...MUTE_DURATIONS.map((duration) => ({
          text: duration.label,
          onPress: () =>
            void muteChannel(channel.id, duration.minutes).catch(showMuteError),
        })),
        { style: "cancel" as const, text: "Cancel" },
      ]
    )
  }

  const confirmDelete = () => {
    Alert.alert(
      `Delete #${channel.name ?? "channel"}?`,
      "Every message and thread in this channel will be permanently deleted. This cannot be undone.",
      [
        { style: "cancel", text: "Cancel" },
        {
          style: "destructive",
          text: "Delete channel",
          onPress: () => {
            setIsDeleting(true)
            void api.v1.workspaces[":workspaceSlug"].channels[":channelId"]
              .$delete({
                param: { workspaceSlug, channelId: channel.id },
              })
              .then(async (response) => {
                if (!response.ok) {
                  throw new Error(
                    await responseMessage(response, "Could not delete channel")
                  )
                }
                onOpenChange(false)
                onChannelDeleted()
              })
              .catch((cause) => {
                Alert.alert(
                  "Channel not deleted",
                  cause instanceof Error
                    ? cause.message
                    : "Please try again in a moment."
                )
              })
              .finally(() => setIsDeleting(false))
          },
        },
      ]
    )
  }

  return (
    <BottomSheet isOpen={isOpen} onOpenChange={onOpenChange}>
      <BottomSheet.Portal unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay className="bg-neutral-950/50" />
        <BottomSheet.Content
          enableDynamicSizing={false}
          keyboardBehavior="interactive"
          keyboardBlurBehavior="restore"
          onAnimate={(fromIndex, toIndex) => {
            if (fromIndex !== -1 || toIndex < 0) return
            requestAnimationFrame(() => {
              void KeyboardController.dismiss().catch(() => undefined)
            })
          }}
          snapPoints={["68%", "92%"]}
        >
          <BottomSheetScrollView
            contentContainerStyle={{ gap: 24, paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {view === "edit" ? (
              <EditChannelView
                error={formError}
                foreground={foreground}
                isSaving={isSaving}
                name={name}
                onBack={() => {
                  setFormError(null)
                  setView("options")
                }}
                onChangeName={setName}
                onChangeTopic={setTopic}
                onSave={() => void saveChannel()}
                topic={topic}
              />
            ) : (
              <>
                <View className="flex-row items-start gap-three px-one">
                  <View className="size-10 items-center justify-center rounded-lor-sm bg-surface-secondary">
                    <HugeiconsIcon
                      color={foreground}
                      icon={HashIcon}
                      size={20}
                    />
                  </View>
                  <View className="min-w-0 flex-1 gap-px">
                    <BottomSheet.Title>
                      {channel.name ?? "Channel"}
                    </BottomSheet.Title>
                    <BottomSheet.Description>
                      {workspaceName} · Text channel
                    </BottomSheet.Description>
                  </View>
                  <BottomSheet.Close />
                </View>

                <View className="gap-two px-one">
                  <SectionLabel>Topic</SectionLabel>
                  <Text className="text-sm leading-5 text-foreground">
                    {channel.topic?.trim() || "No topic has been set."}
                  </Text>
                </View>

                <View className="flex-row gap-three px-one">
                  <ActionTile
                    icon={Copy01Icon}
                    label="Copy ID"
                    onPress={() => {
                      void Clipboard.setStringAsync(channel.id)
                    }}
                    tint={foreground}
                  />
                  {canUpdateChannel ? (
                    <ActionTile
                      icon={Edit02Icon}
                      label="Edit"
                      onPress={() => setView("edit")}
                      tint={accent}
                    />
                  ) : null}
                </View>

                <View className="gap-three px-one">
                  <SectionLabel>Notifications</SectionLabel>
                  <Pressable
                    accessibilityLabel={
                      mute ? "Unmute channel" : "Mute channel"
                    }
                    accessibilityRole="button"
                    className="min-h-14 flex-row items-center gap-three rounded-lor-sm bg-surface-secondary px-three py-three active:bg-surface-tertiary"
                    onPress={pressMute}
                  >
                    <View className="size-9 items-center justify-center rounded-lor-sm bg-surface-tertiary">
                      <HugeiconsIcon
                        color={foreground}
                        icon={mute ? NotificationOff03Icon : Notification03Icon}
                        size={19}
                      />
                    </View>
                    <View className="min-w-0 flex-1 gap-px">
                      <Text className="text-[15px] font-semibold text-foreground">
                        {mute ? "Muted" : "Mute channel"}
                      </Text>
                      <Text className="text-xs leading-4 text-muted">
                        {mute
                          ? mutedUntilLabel(mute.mutedUntil)
                          : "Silence notifications from this channel"}
                      </Text>
                    </View>
                    <SymbolView
                      name={{
                        ios: "chevron.right",
                        android: "chevron_right",
                        web: "chevron_right",
                      }}
                      size={17}
                      tintColor={foreground}
                    />
                  </Pressable>
                </View>

                <View className="gap-three px-one">
                  <SectionLabel>Channel content</SectionLabel>
                  <Pressable
                    accessibilityHint="Opens a scrollable list"
                    accessibilityLabel="Pinned messages"
                    accessibilityRole="button"
                    className="min-h-14 flex-row items-center gap-three rounded-lor-sm bg-surface-secondary px-three py-three active:bg-surface-tertiary"
                    onPress={onOpenPinnedMessages}
                  >
                    <View className="size-9 items-center justify-center rounded-lor-sm bg-surface-tertiary">
                      <HugeiconsIcon
                        color={foreground}
                        icon={Pin02Icon}
                        size={19}
                      />
                    </View>
                    <View className="min-w-0 flex-1 gap-px">
                      <Text className="text-[15px] font-semibold text-foreground">
                        Pinned messages
                      </Text>
                      <Text className="text-xs leading-4 text-muted">
                        Browse important messages from this channel
                      </Text>
                    </View>
                    <SymbolView
                      name={{
                        ios: "chevron.right",
                        android: "chevron_right",
                        web: "chevron_right",
                      }}
                      size={17}
                      tintColor={foreground}
                    />
                  </Pressable>
                </View>

                {canDeleteChannel ? (
                  <View className="gap-three border-t border-separator px-one pt-five">
                    <SectionLabel>Danger zone</SectionLabel>
                    <Pressable
                      accessibilityLabel={`Delete ${channel.name ?? "channel"}`}
                      accessibilityRole="button"
                      className="min-h-14 flex-row items-center gap-three rounded-lor-sm bg-danger-soft px-four py-three active:opacity-70"
                      disabled={isDeleting}
                      onPress={confirmDelete}
                    >
                      {isDeleting ? (
                        <Spinner color="danger" size="sm" />
                      ) : (
                        <HugeiconsIcon
                          color={danger}
                          icon={Delete02Icon}
                          size={21}
                        />
                      )}
                      <View className="min-w-0 flex-1">
                        <Text className="text-[15px] font-semibold text-danger">
                          Delete channel
                        </Text>
                        <Text className="text-xs leading-4 text-muted">
                          Permanently remove its messages and threads
                        </Text>
                      </View>
                    </Pressable>
                  </View>
                ) : null}
              </>
            )}
          </BottomSheetScrollView>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  )
}

function EditChannelView({
  error,
  foreground,
  isSaving,
  name,
  onBack,
  onChangeName,
  onChangeTopic,
  onSave,
  topic,
}: {
  error: string | null
  foreground: string
  isSaving: boolean
  name: string
  onBack: () => void
  onChangeName: (value: string) => void
  onChangeTopic: (value: string) => void
  onSave: () => void
  topic: string
}) {
  return (
    <>
      <View className="flex-row items-center gap-three px-one">
        <Pressable
          accessibilityLabel="Back to channel options"
          accessibilityRole="button"
          className="size-10 items-center justify-center rounded-lor-sm active:bg-surface-secondary"
          onPress={onBack}
        >
          <SymbolView
            name={{
              ios: "chevron.left",
              android: "arrow_back",
              web: "arrow_back",
            }}
            size={20}
            tintColor={foreground}
          />
        </Pressable>
        <View className="min-w-0 flex-1">
          <BottomSheet.Title>Edit channel</BottomSheet.Title>
          <BottomSheet.Description>
            Update how this channel appears to your team.
          </BottomSheet.Description>
        </View>
        <BottomSheet.Close />
      </View>

      <View className="gap-two px-one">
        <Text className="text-sm font-semibold text-foreground">Name</Text>
        <BottomSheetTextInput
          accessibilityLabel="Channel name"
          autoCapitalize="none"
          className="min-h-12 rounded-lor-sm border border-border bg-surface px-three text-base text-foreground"
          maxLength={100}
          onChangeText={onChangeName}
          placeholder="channel-name"
          placeholderTextColor="#737373"
          value={name}
        />
      </View>

      <View className="gap-two px-one">
        <Text className="text-sm font-semibold text-foreground">Topic</Text>
        <BottomSheetTextInput
          accessibilityLabel="Channel topic"
          className="min-h-28 rounded-lor-sm border border-border bg-surface px-three py-three text-base leading-5 text-foreground"
          maxLength={1024}
          multiline
          onChangeText={onChangeTopic}
          placeholder="What is this channel about?"
          placeholderTextColor="#737373"
          textAlignVertical="top"
          value={topic}
        />
        <Text className="text-right text-xs text-muted">
          {topic.length}/1024
        </Text>
      </View>

      {error ? (
        <Text className="px-one text-sm font-medium text-danger">{error}</Text>
      ) : null}

      <View className="flex-row gap-three px-one">
        <Button
          className="flex-1"
          isDisabled={isSaving}
          onPress={onBack}
          variant="secondary"
        >
          Cancel
        </Button>
        <Button
          className="flex-1"
          isDisabled={isSaving || !name.trim()}
          onPress={onSave}
        >
          {isSaving ? "Saving…" : "Save changes"}
        </Button>
      </View>
    </>
  )
}

function ActionTile({
  icon,
  label,
  onPress,
  tint,
}: {
  icon: IconSvgElement
  label: string
  onPress: () => void
  tint: string
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      className="min-h-20 flex-1 items-center justify-center gap-two rounded-lor-sm bg-surface-secondary px-three py-three active:bg-surface-tertiary"
      onPress={onPress}
    >
      <HugeiconsIcon color={tint} icon={icon} size={22} />
      <Text className="text-sm font-semibold text-foreground">{label}</Text>
    </Pressable>
  )
}
