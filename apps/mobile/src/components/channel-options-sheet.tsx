import {
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet"
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon"
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon"
import Edit02Icon from "@hugeicons/core-free-icons/Edit02Icon"
import HashIcon from "@hugeicons/core-free-icons/HashIcon"
import Pin02Icon from "@hugeicons/core-free-icons/Pin02Icon"
import PinOffIcon from "@hugeicons/core-free-icons/PinOffIcon"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native"
import { timeAgo } from "@repo/utils/date"
import * as Clipboard from "expo-clipboard"
import { SymbolView } from "expo-symbols"
import { BottomSheet } from "heroui-native/bottom-sheet"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import { useEffect, useState } from "react"
import { Alert, Pressable, Text, View } from "react-native"
import { KeyboardController } from "react-native-keyboard-controller"
import { MessageContent } from "@/components/message-content"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { SectionLabel } from "@/components/ui/section-label"
import { Skeleton } from "@/components/ui/skeleton"
import { usePinnedMessages } from "@/hooks/use-pinned-messages"
import { api } from "@/lib/api"
import type { ChannelDetail, Message } from "@/lib/api-types"

type SheetView = "options" | "edit"

export function ChannelOptionsSheet({
  canDeleteChannel,
  canPinMessages,
  canUpdateChannel,
  channel,
  isOpen,
  onChannelDeleted,
  onChannelUpdated,
  onOpenChange,
  onSelectPinnedMessage,
  onTogglePin,
  workspaceName,
  workspaceSlug,
}: {
  canDeleteChannel: boolean
  canPinMessages: boolean
  canUpdateChannel: boolean
  channel: ChannelDetail
  isOpen: boolean
  onChannelDeleted: () => void
  onChannelUpdated: (channel: ChannelDetail) => void
  onOpenChange: (isOpen: boolean) => void
  onSelectPinnedMessage: (message: Message) => void
  onTogglePin: (message: Message) => Promise<boolean>
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
  const pins = usePinnedMessages({
    channelId: channel.id,
    enabled: isOpen,
    workspaceSlug,
  })

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
                  <View className="flex-row items-center justify-between gap-three">
                    <SectionLabel>Pinned messages</SectionLabel>
                    {!pins.isLoading ? (
                      <Text className="text-xs font-semibold text-muted">
                        {pins.messages.length}
                      </Text>
                    ) : null}
                  </View>
                  <PinnedMessages
                    canUnpin={canPinMessages}
                    error={pins.error}
                    isLoading={pins.isLoading}
                    messages={pins.messages}
                    onRetry={() => void pins.reload()}
                    onSelect={(message) => {
                      onOpenChange(false)
                      onSelectPinnedMessage(message)
                    }}
                    onUnpin={async (message) => {
                      const didUpdate = await onTogglePin(message)
                      if (didUpdate) pins.remove(message.id)
                      else {
                        Alert.alert(
                          "Pin not updated",
                          "Please try again in a moment."
                        )
                      }
                    }}
                  />
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

function PinnedMessages({
  canUnpin,
  error,
  isLoading,
  messages,
  onRetry,
  onSelect,
  onUnpin,
}: {
  canUnpin: boolean
  error: string | null
  isLoading: boolean
  messages: Message[]
  onRetry: () => void
  onSelect: (message: Message) => void
  onUnpin: (message: Message) => void
}) {
  const [foreground, muted] = useThemeColor(["foreground", "muted"])

  if (isLoading && messages.length === 0) {
    return (
      <View className="gap-two">
        {[0, 1].map((index) => (
          <View className="flex-row gap-three py-two" key={index}>
            <Skeleton className="size-9" />
            <View className="flex-1 gap-two">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-3 w-4/5" />
            </View>
          </View>
        ))}
      </View>
    )
  }

  if (error && messages.length === 0) {
    return (
      <View className="items-start gap-three rounded-lor-sm border border-border px-four py-four">
        <Text className="text-sm text-muted">{error}</Text>
        <Button onPress={onRetry} size="sm" variant="secondary">
          Try again
        </Button>
      </View>
    )
  }

  if (messages.length === 0) {
    return (
      <View className="items-center gap-two rounded-lor-sm border border-dashed border-border px-four py-six">
        <HugeiconsIcon color={muted} icon={Pin02Icon} size={23} />
        <Text className="text-sm font-semibold text-foreground">
          No pinned messages
        </Text>
        <Text className="text-center text-xs leading-4 text-muted">
          Important messages pinned in this channel will appear here.
        </Text>
      </View>
    )
  }

  return (
    <View className="overflow-hidden rounded-lor-sm border border-border">
      {messages.map((message, index) => {
        const displayName =
          message.overrideName ??
          message.author.displayUsername ??
          message.author.name
        return (
          <View key={message.id}>
            {index > 0 ? <View className="ml-14 h-px bg-separator" /> : null}
            <Pressable
              accessibilityHint="Jumps to this message"
              accessibilityLabel={`Pinned message from ${displayName}`}
              accessibilityRole="button"
              className="flex-row gap-three px-three py-three active:bg-surface-secondary"
              onPress={() => onSelect(message)}
            >
              <Avatar
                image={message.overrideAvatarUrl ?? message.author.image}
                name={displayName}
                size="xs"
              />
              <View className="min-w-0 flex-1 gap-one">
                <View className="flex-row items-center gap-two">
                  <Text
                    className="min-w-0 flex-1 text-sm font-semibold text-foreground"
                    numberOfLines={1}
                  >
                    {displayName}
                  </Text>
                  <Text className="text-[11px] text-muted">
                    {timeAgo(message.createdAt)}
                  </Text>
                </View>
                <View className="max-h-12 overflow-hidden">
                  {message.content ? (
                    <MessageContent
                      content={message.content}
                      mentions={message.mentions}
                    />
                  ) : (
                    <Text className="text-sm italic text-muted">
                      Attachment
                    </Text>
                  )}
                </View>
              </View>
              {canUnpin ? (
                <Pressable
                  accessibilityLabel="Unpin message"
                  accessibilityRole="button"
                  className="size-9 items-center justify-center rounded-lor-sm active:bg-surface-tertiary"
                  hitSlop={8}
                  onPress={(event) => {
                    event.stopPropagation()
                    onUnpin(message)
                  }}
                >
                  <HugeiconsIcon
                    color={foreground}
                    icon={PinOffIcon}
                    size={18}
                  />
                </Pressable>
              ) : null}
            </Pressable>
          </View>
        )
      })}
    </View>
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

async function responseMessage(
  response: { text: () => Promise<string> },
  fallback: string
) {
  const responseText = await response.text()
  if (!responseText) return fallback
  try {
    const parsed = JSON.parse(responseText) as { message?: string }
    return typeof parsed.message === "string" ? parsed.message : fallback
  } catch {
    return fallback
  }
}
