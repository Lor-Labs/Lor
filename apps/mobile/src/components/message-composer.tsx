import { SymbolView } from "expo-symbols"
import { useState } from "react"
import { Pressable, Text, TextInput, View } from "react-native"
import { useTheme } from "@/hooks/use-theme"

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
  const theme = useTheme()
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
    <View className="bg-lor-bg px-three pb-three pt-two dark:bg-lor-bg-dark">
      {!isConnected ? (
        <Text className="mb-two text-center text-xs font-semibold text-lor-danger dark:text-lor-danger-dark">
          Reconnecting…
        </Text>
      ) : null}
      <View className="min-h-[50px] flex-row items-end gap-two rounded-lor-lg border border-lor-border bg-lor-surface-raised py-two pl-four pr-two dark:border-lor-border-dark dark:bg-lor-surface-raised-dark">
        <TextInput
          accessibilityLabel={`Message ${channelName}`}
          className="max-h-[110px] flex-1 py-[5px] text-base leading-[21px] text-lor-text dark:text-lor-text-dark"
          editable={isConnected && !isSending}
          multiline
          onChangeText={setContent}
          onSubmitEditing={() => void send()}
          placeholder={`Message #${channelName}`}
          placeholderTextColor={theme.textTertiary}
          submitBehavior="submit"
          value={content}
        />
        <Pressable
          accessibilityLabel="Send message"
          className={`h-[34px] w-[34px] items-center justify-center rounded-lor-md ${
            canSend
              ? "bg-lor-accent active:scale-[0.94] active:opacity-80 dark:bg-lor-accent-dark"
              : "bg-lor-pressed dark:bg-lor-pressed-dark"
          }`}
          disabled={!canSend}
          onPress={() => void send()}
        >
          <SymbolView
            name={{
              ios: "arrow.up",
              android: "arrow_upward",
              web: "arrow_upward",
            }}
            size={18}
            tintColor={canSend ? theme.accentForeground : theme.textTertiary}
          />
        </Pressable>
      </View>
    </View>
  )
}
