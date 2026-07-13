import { router, useLocalSearchParams } from "expo-router"
import { SymbolView } from "expo-symbols"
import { useCallback, useEffect, useState } from "react"
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { MessageComposer } from "@/components/message-composer"
import { MessageList } from "@/components/message-list"
import { InlineSpinner, StatePanel } from "@/components/ui/primitives"
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

  if (!workspace || !channelId) {
    return (
      <StatePanel
        className="flex-1"
        detail="Return to your workspace and try again."
        title="Channel unavailable"
      />
    )
  }
  if (isLoadingChannel) {
    return (
      <View className="flex-1 items-center justify-center bg-lor-bg dark:bg-lor-bg-dark">
        <InlineSpinner />
      </View>
    )
  }
  if (channelError || !channel) {
    return (
      <StatePanel
        action={{ label: "Back to channels", onPress: () => router.back() }}
        className="flex-1"
        detail={channelError ?? "This channel no longer exists."}
        title="Channel unavailable"
      />
    )
  }
  const channelName = channel.name ?? "channel"

  return (
    <SafeAreaView
      className="flex-1 bg-lor-bg dark:bg-lor-bg-dark"
      edges={["top", "bottom"]}
      style={{ flex: 1 }}
    >
      <View className="min-h-[60px] flex-row items-center gap-two border-b border-lor-divider px-three dark:border-lor-divider-dark">
        <Pressable
          accessibilityLabel="Back to channels"
          className="h-[38px] w-[38px] items-center justify-center rounded-lor-md active:bg-lor-pressed dark:active:bg-lor-pressed-dark"
          onPress={() => router.back()}
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
        <View className="min-w-0 flex-1 gap-px">
          <View className="flex-row items-center gap-one">
            <Text className="text-[22px] font-normal leading-[23px] text-lor-text-secondary dark:text-lor-text-secondary-dark">
              #
            </Text>
            <Text
              className="text-[17px] font-bold tracking-[-0.2px] text-lor-text dark:text-lor-text-dark"
              numberOfLines={1}
            >
              {channelName}
            </Text>
          </View>
          {channel.topic ? (
            <Text
              className="text-xs font-medium leading-4 text-lor-text-secondary dark:text-lor-text-secondary-dark"
              numberOfLines={1}
            >
              {channel.topic}
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityLabel="Channel options"
          className="mr-one h-9 w-9 items-center justify-center rounded-lor-md bg-lor-surface active:bg-lor-pressed dark:bg-lor-surface-dark dark:active:bg-lor-pressed-dark"
          onPress={() => router.push("/explore")}
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
        className="flex-1"
        keyboardVerticalOffset={0}
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
