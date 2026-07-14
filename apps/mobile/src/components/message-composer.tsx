import { SymbolView } from "expo-symbols"
import { Alert } from "heroui-native/alert"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import { TextArea } from "heroui-native/text-area"
import { useState } from "react"
import { View } from "react-native"
import { IconButton } from "@/components/ui/icon-button"

export function MessageComposer({
  channelName,
  isSending,
  isConnected,
  onSend,
}: {
  channelName: string
  isSending: boolean
  isConnected: boolean
  onSend: (content: string) => Promise<void>
}) {
  const [accentForeground, muted] = useThemeColor([
    "accent-foreground",
    "muted",
  ])
  const [content, setContent] = useState("")
  const canSend = content.trim().length > 0 && !isSending && isConnected

  const send = async () => {
    if (!canSend) return
    const next = content
    setContent("")
    try {
      await onSend(next)
    } catch {
      setContent(next)
    }
  }

  return (
    <View className="border-t border-separator bg-background px-three pb-three pt-two">
      {!isConnected ? (
        <Alert
          className="mb-two rounded-lor-sm bg-warning-soft p-two shadow-none"
          status="warning"
        >
          <Alert.Indicator className="pt-px" iconProps={{ size: 16 }} />
          <Alert.Content>
            <Alert.Title className="text-sm">Reconnecting…</Alert.Title>
          </Alert.Content>
        </Alert>
      ) : null}
      <View className="relative">
        <TextArea
          accessibilityLabel={`Message ${channelName}`}
          className="h-auto min-h-12 max-h-[120px] py-three pl-four pr-[60px] text-base leading-[21px]"
          isDisabled={!isConnected || isSending}
          onChangeText={setContent}
          onSubmitEditing={() => void send()}
          placeholder={`Message #${channelName}`}
          returnKeyType="send"
          submitBehavior="submit"
          value={content}
        />
        <IconButton
          accessibilityLabel="Send message"
          className="absolute bottom-one right-one"
          isDisabled={!canSend}
          onPress={() => void send()}
        >
          {isSending ? (
            <Spinner color={accentForeground} size="sm" />
          ) : (
            <SymbolView
              name={{
                ios: "arrow.up",
                android: "arrow_upward",
                web: "arrow_upward",
              }}
              size={18}
              tintColor={canSend ? accentForeground : muted}
            />
          )}
        </IconButton>
      </View>
    </View>
  )
}
