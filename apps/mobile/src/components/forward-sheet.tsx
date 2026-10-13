import {
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet"
import { router } from "expo-router"
import { BottomSheet } from "heroui-native/bottom-sheet"
import { useThemeColor } from "heroui-native/hooks"
import { useToast } from "heroui-native/toast"
import { useState } from "react"
import { Alert, View } from "react-native"
import { KeyboardController } from "react-native-keyboard-controller"
import { ForwardedMessageCard } from "@/components/forwarded-message-card"
import { Button } from "@/components/ui/button"
import { useSocket } from "@/context/socket-context"
import type { Message } from "@/lib/api-types"
import { isOptimisticMessage } from "@/lib/messages"

// A finished message with text, Lor's or a person's; never a placeholder,
// an event line or a card. Mirrors the gateway's loadForwardSnapshot.
export function canForwardMessage(message: Message) {
  return (
    (message.type === "default" || message.type === "reply") &&
    message.status === "complete" &&
    !isOptimisticMessage(message) &&
    Boolean(message.content?.trim())
  )
}

// Forward a session message into its channel's chat as your own post (type
// "forward"), with an optional note. Mirrors web's forward-dialog.tsx.
export function ForwardSheet({
  message,
  channel,
  onClose,
}: {
  message: Message | null
  channel: { id: string; name: string }
  onClose: () => void
}) {
  const placeholder = useThemeColor("field-placeholder")
  const socket = useSocket()
  const { toast } = useToast()
  const [note, setNote] = useState("")
  const [sending, setSending] = useState(false)
  // Kept through the close animation.
  const [shown, setShown] = useState(message)
  if (message && message !== shown) setShown(message)

  const forward = async () => {
    if (!message || sending) return
    if (!socket?.connected) {
      Alert.alert("Connection lost", "Try again in a moment.")
      return
    }
    setSending(true)
    try {
      const result = await socket.timeout(12_000).emitWithAck("message:send", {
        channelId: channel.id,
        content: note.trim() || undefined,
        referencedMessageId: message.id,
        forward: true,
        nonce: `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      })
      if (!result.ok) throw new Error(result.error)
      setNote("")
      onClose()
      toast.show({
        label: `Forwarded to #${channel.name}`,
        actionLabel: "View",
        onActionPress: ({ hide }) => {
          hide("all")
          router.push({
            pathname: "/channel/[channelId]",
            params: {
              channelId: channel.id,
              focusMessageId: result.message.id,
            },
          })
        },
      })
    } catch {
      Alert.alert("Couldn't forward the message", "Please try again.")
    } finally {
      setSending(false)
    }
  }

  return (
    <BottomSheet
      isOpen={message !== null}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose()
      }}
    >
      <BottomSheet.Portal unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay className="bg-neutral-950/50" />
        <BottomSheet.Content
          enableDynamicSizing={false}
          keyboardBehavior="interactive"
          keyboardBlurBehavior="restore"
          // The composer's keyboard would cover the sheet.
          onAnimate={(fromIndex, toIndex) => {
            if (fromIndex !== -1 || toIndex < 0) return
            requestAnimationFrame(() => {
              void KeyboardController.dismiss().catch(() => undefined)
            })
          }}
          snapPoints={["60%", "92%"]}
        >
          <View className="flex-row items-start gap-three px-one pb-four">
            <View className="min-w-0 flex-1 gap-px">
              <BottomSheet.Title>Forward to #{channel.name}</BottomSheet.Title>
              <BottomSheet.Description>
                Posts as you in the channel chat, with the message under your
                note.
              </BottomSheet.Description>
            </View>
            <BottomSheet.Close />
          </View>
          <BottomSheetScrollView
            contentContainerStyle={{ gap: 16, paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <BottomSheetTextInput
              accessibilityLabel="Note"
              className="min-h-20 rounded-lor-sm border border-border bg-surface px-three pb-three pt-three text-base text-foreground"
              maxLength={2000}
              multiline
              onChangeText={setNote}
              placeholder="Add a note (optional)"
              placeholderTextColor={placeholder}
              textAlignVertical="top"
              value={note}
            />
            {shown ? (
              <ForwardedMessageCard
                preview
                forwarded={{
                  messageId: shown.id,
                  author: {
                    id: shown.author.id,
                    name: shown.overrideName ?? shown.author.name,
                    image: shown.author.image,
                  },
                  content: shown.content,
                  mentions: shown.mentions.map(({ id, name, image }) => ({
                    id,
                    name,
                    image,
                  })),
                  createdAt: shown.createdAt,
                  source: {
                    channelId: shown.channelId,
                    channelName: null,
                    sessionId: null,
                    sessionTitle: null,
                  },
                }}
              />
            ) : null}
            <View className="flex-row gap-three">
              <Button className="flex-1" onPress={onClose} variant="ghost">
                Cancel
              </Button>
              <Button
                className="flex-1"
                isDisabled={sending}
                onPress={() => void forward()}
              >
                {sending ? "Forwarding…" : "Forward"}
              </Button>
            </View>
          </BottomSheetScrollView>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  )
}
