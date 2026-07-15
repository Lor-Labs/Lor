import { router, useLocalSearchParams } from "expo-router"
import { SymbolView } from "expo-symbols"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import { useCallback, useEffect, useRef, useState } from "react"
import { Text, View } from "react-native"
import { KeyboardAvoidingView } from "react-native-keyboard-controller"
import { MessageComposer } from "@/components/message-composer"
import { MessageList } from "@/components/message-list"
import { IconButton } from "@/components/ui/icon-button"
import { Screen } from "@/components/ui/screen"
import { StatePanel } from "@/components/ui/state-panel"
import { useSocket, useSocketConnected } from "@/context/socket-context"
import { useWorkspace } from "@/context/workspace-context"
import { useChannelMessages } from "@/hooks/use-channel-messages"
import { api } from "@/lib/api"
import type { ChannelDetail } from "@/lib/api-types"
import { authClient } from "@/lib/auth-client"

export default function ChannelScreen() {
  const [foreground, muted] = useThemeColor(["foreground", "muted"])
  const socket = useSocket()
  const isSocketConnected = useSocketConnected()
  const { workspace } = useWorkspace()
  const { channelId } = useLocalSearchParams<{ channelId: string }>()
  const { data: session } = authClient.useSession()
  const [channel, setChannel] = useState<ChannelDetail | null>(null)
  const [isLoadingChannel, setIsLoadingChannel] = useState(true)
  const [channelError, setChannelError] = useState<string | null>(null)
  const channelRequestRef = useRef(0)
  const channelIdentityRef = useRef("")
  const channelIdentity = `${workspace?.slug ?? ""}:${channelId ?? ""}`

  channelIdentityRef.current = channelIdentity

  const loadChannel = useCallback(async () => {
    const requestId = ++channelRequestRef.current
    const requestIdentity = `${workspace?.slug ?? ""}:${channelId ?? ""}`

    if (!workspace || !channelId) {
      if (
        requestId === channelRequestRef.current &&
        requestIdentity === channelIdentityRef.current
      ) {
        setIsLoadingChannel(false)
      }
      return
    }

    setIsLoadingChannel(true)
    setChannelError(null)
    try {
      const response = await api.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].$get({
        param: { workspaceSlug: workspace.slug, channelId },
      })
      if (!response.ok) throw new Error("Could not load this channel")
      const payload = await response.json()
      if (
        requestId === channelRequestRef.current &&
        requestIdentity === channelIdentityRef.current
      ) {
        setChannel(payload)
      }
    } catch (cause) {
      if (
        requestId === channelRequestRef.current &&
        requestIdentity === channelIdentityRef.current
      ) {
        setChannelError(
          cause instanceof Error ? cause.message : "Could not load this channel"
        )
      }
    } finally {
      if (
        requestId === channelRequestRef.current &&
        requestIdentity === channelIdentityRef.current
      ) {
        setIsLoadingChannel(false)
      }
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
      <Screen className="bg-background" edges={["top", "bottom"]}>
        <StatePanel
          className="flex-1"
          detail="Return to your workspace and try again."
          title="Channel unavailable"
        />
      </Screen>
    )
  }
  if (isLoadingChannel) {
    return (
      <Screen className="bg-background" edges={["top", "bottom"]}>
        <View className="flex-1 items-center justify-center">
          <Spinner accessibilityLabel="Loading channel" />
        </View>
      </Screen>
    )
  }
  if (channelError || !channel) {
    return (
      <Screen className="bg-background" edges={["top", "bottom"]}>
        <StatePanel
          action={{ label: "Back to channels", onPress: () => router.back() }}
          className="flex-1"
          detail={channelError ?? "This channel no longer exists."}
          status="danger"
          title="Channel unavailable"
        />
      </Screen>
    )
  }
  const channelName = channel.name ?? "channel"

  return (
    <Screen className="bg-background" edges={["top", "bottom"]}>
      <View className="min-h-[60px] flex-row items-center gap-two border-b border-separator px-three">
        <IconButton
          accessibilityLabel="Back to channels"
          onPress={() => router.back()}
          variant="ghost"
        >
          <SymbolView
            name={{
              ios: "chevron.left",
              android: "arrow_back",
              web: "arrow_back",
            }}
            size={21}
            tintColor={foreground}
          />
        </IconButton>
        <View className="min-w-0 flex-1 gap-px">
          <View className="flex-row items-center gap-one">
            <Text className="text-[22px] font-normal leading-[23px] text-muted">
              #
            </Text>
            <Text
              className="text-[17px] font-bold tracking-[-0.2px] text-foreground"
              numberOfLines={1}
            >
              {channelName}
            </Text>
          </View>
          {channel.topic ? (
            <Text
              className="text-xs font-medium leading-4 text-muted"
              numberOfLines={1}
            >
              {channel.topic}
            </Text>
          ) : null}
        </View>
        <IconButton
          accessibilityLabel="Channel options"
          className="mr-one"
          onPress={() => router.push("/explore")}
          variant="ghost"
        >
          <SymbolView
            name={{ ios: "ellipsis", android: "more_horiz", web: "more_horiz" }}
            size={20}
            tintColor={isSocketConnected ? foreground : muted}
          />
        </IconButton>
      </View>
      <KeyboardAvoidingView
        behavior="translate-with-padding"
        className="flex-1"
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
    </Screen>
  )
}
