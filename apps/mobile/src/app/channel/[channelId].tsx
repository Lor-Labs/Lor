import { router, useLocalSearchParams } from "expo-router"
import { SymbolView } from "expo-symbols"
import { useCallback, useEffect, useState } from "react"
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { MessageComposer } from "@/components/message-composer"
import { MessageList } from "@/components/message-list"
import {
  InlineSpinner,
  StatePanel,
  textStyles,
} from "@/components/ui/primitives"
import { Radius, Spacing } from "@/constants/theme"
import { useSocket, useSocketConnected } from "@/context/socket-context"
import { useWorkspace } from "@/context/workspace-context"
import { useChannelMessages } from "@/hooks/use-channel-messages"
import { useTheme } from "@/hooks/use-theme"
import { api } from "@/lib/api"
import type { ChannelDetail } from "@/lib/api-types"
import { authClient } from "@/lib/auth-client"

export default function ChannelScreen() {
  const theme = useTheme()
  const socket = useSocket()
  const isSocketConnected = useSocketConnected()
  const { workspace } = useWorkspace()
  const { channelId } = useLocalSearchParams<{ channelId: string }>()
  const { data: session } = authClient.useSession()
  const [channel, setChannel] = useState<ChannelDetail | null>(null)
  const [isLoadingChannel, setIsLoadingChannel] = useState(true)
  const [channelError, setChannelError] = useState<string | null>(null)

  const loadChannel = useCallback(async () => {
    if (!workspace || !channelId) return
    setIsLoadingChannel(true)
    setChannelError(null)
    try {
      const response = await api.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].$get({
        param: { workspaceSlug: workspace.slug, channelId },
      })
      if (!response.ok) throw new Error("Could not load this channel")
      setChannel(await response.json())
    } catch (cause) {
      setChannelError(
        cause instanceof Error ? cause.message : "Could not load this channel"
      )
    } finally {
      setIsLoadingChannel(false)
    }
  }, [workspace, channelId])

  useEffect(() => {
    void loadChannel()
  }, [loadChannel])

  const chat = useChannelMessages({
    workspaceSlug: workspace?.slug ?? "",
    channelId: channelId ?? "",
    socket,
    currentUser: session?.user,
  })

  if (!workspace || !channelId)
    return (
      <StatePanel
        title="Channel unavailable"
        detail="Return to your workspace and try again."
        style={styles.centered}
      />
    )
  if (isLoadingChannel)
    return (
      <View style={[styles.loading, { backgroundColor: theme.background }]}>
        <InlineSpinner />
      </View>
    )
  if (channelError || !channel)
    return (
      <StatePanel
        title="Channel unavailable"
        detail={channelError ?? "This channel no longer exists."}
        action={{ label: "Back to channels", onPress: () => router.back() }}
        style={styles.centered}
      />
    )
  const channelName = channel.name ?? "channel"

  return (
    <SafeAreaView
      edges={["top", "bottom"]}
      style={[styles.screen, { backgroundColor: theme.background }]}
    >
      <View
        style={[
          styles.header,
          {
            backgroundColor: theme.background,
            borderBottomColor: theme.divider,
          },
        ]}
      >
        <Pressable
          accessibilityLabel="Back to channels"
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.back,
            pressed && { backgroundColor: theme.pressed },
          ]}
        >
          <SymbolView
            name={{
              ios: "chevron.left",
              android: "arrow_back",
              web: "arrow_back",
            }}
            size={21}
            tintColor={theme.text}
          />
        </Pressable>
        <View style={styles.headerCopy}>
          <View style={styles.channelTitleRow}>
            <Text style={[styles.hash, { color: theme.textSecondary }]}>#</Text>
            <Text
              numberOfLines={1}
              style={[styles.channelName, { color: theme.text }]}
            >
              {channelName}
            </Text>
          </View>
          {channel.topic ? (
            <Text
              numberOfLines={1}
              style={[styles.channelTopic, { color: theme.textSecondary }]}
            >
              {channel.topic}
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityLabel="Channel options"
          onPress={() => router.push("/explore")}
          style={({ pressed }) => [
            styles.options,
            { backgroundColor: theme.surface },
            pressed && { backgroundColor: theme.pressed },
          ]}
        >
          <SymbolView
            name={{ ios: "ellipsis", android: "more_horiz", web: "more_horiz" }}
            size={20}
            tintColor={
              isSocketConnected ? theme.textSecondary : theme.textTertiary
            }
          />
        </Pressable>
      </View>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
        style={styles.chat}
      >
        <MessageList
          channelName={channelName}
          currentUserId={session?.user.id}
          error={chat.error}
          isLoading={chat.isLoading}
          messages={chat.messages}
          onRetry={() => void chat.reload()}
        />
        <MessageComposer
          channelName={channelName}
          isConnected={isSocketConnected}
          isSending={chat.isSending}
          onSend={chat.sendMessage}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 60,
    paddingHorizontal: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.two,
  },
  back: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.medium,
  },
  headerCopy: { flex: 1, minWidth: 0, gap: 1 },
  channelTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.one,
  },
  hash: { fontSize: 22, fontWeight: "400", lineHeight: 23 },
  channelName: { fontSize: 17, fontWeight: "700", letterSpacing: -0.2 },
  channelTopic: { ...textStyles.caption },
  options: {
    alignItems: "center",
    borderRadius: Radius.medium,
    height: 36,
    justifyContent: "center",
    marginRight: Spacing.one,
    width: 36,
  },
  chat: { flex: 1 },
})
