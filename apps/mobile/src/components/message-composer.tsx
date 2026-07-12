import { SymbolView } from "expo-symbols"
import { useState } from "react"
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native"
import { Radius, Spacing } from "@/constants/theme"
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
    await onSend(next)
  }

  return (
    <View style={[styles.wrap, { backgroundColor: theme.background }]}>
      {!isConnected ? (
        <Text style={[styles.offline, { color: theme.danger }]}>
          Reconnecting…
        </Text>
      ) : null}
      <View
        style={[
          styles.composer,
          { backgroundColor: theme.surfaceRaised, borderColor: theme.border },
        ]}
      >
        <TextInput
          accessibilityLabel={`Message ${channelName}`}
          editable={isConnected && !isSending}
          multiline
          onChangeText={setContent}
          onSubmitEditing={() => void send()}
          placeholder={`Message #${channelName}`}
          placeholderTextColor={theme.textTertiary}
          style={[styles.input, { color: theme.text }]}
          value={content}
        />
        <Pressable
          accessibilityLabel="Send message"
          disabled={!canSend}
          onPress={() => void send()}
          style={({ pressed }) => [
            styles.send,
            { backgroundColor: canSend ? theme.accent : theme.pressed },
            pressed && canSend && styles.sendPressed,
          ]}
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

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  offline: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: Spacing.two,
    textAlign: "center",
  },
  composer: {
    alignItems: "flex-end",
    borderRadius: Radius.large,
    borderWidth: 1,
    flexDirection: "row",
    gap: Spacing.two,
    minHeight: 50,
    paddingLeft: Spacing.four,
    paddingRight: Spacing.two,
    paddingVertical: Spacing.two,
  },
  input: {
    flex: 1,
    fontSize: 16,
    lineHeight: 21,
    maxHeight: 110,
    paddingBottom: 5,
    paddingTop: 5,
  },
  send: {
    alignItems: "center",
    borderRadius: Radius.medium,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  sendPressed: { opacity: 0.82, transform: [{ scale: 0.94 }] },
})
