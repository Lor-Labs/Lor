import Search01Icon from "@hugeicons/core-free-icons/Search01Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { router, useFocusEffect, useLocalSearchParams } from "expo-router"
import { SymbolView } from "expo-symbols"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import { useCallback, useEffect, useState } from "react"
import { Text, View } from "react-native"
import { KeyboardAvoidingView } from "react-native-keyboard-controller"
import { MessageComposer } from "@/components/message-composer"
import { MessageList } from "@/components/message-list"
import { IconButton } from "@/components/ui/icon-button"
import { Screen } from "@/components/ui/screen"
import { StatePanel } from "@/components/ui/state-panel"
import { useSocket, useSocketConnected } from "@/context/socket-context"
import { useWorkspace } from "@/context/workspace-context"
import { useCanPinMessages } from "@/hooks/use-can-pin-messages"
import { useChannelDetail } from "@/hooks/use-channel-detail"
import { useChannelMessages } from "@/hooks/use-channel-messages"
import { useWorkspaceMentionCandidates } from "@/hooks/use-workspace-mention-candidates"
import type { Message } from "@/lib/api-types"
import { authClient } from "@/lib/auth-client"

export default function ChannelScreen() {
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [foreground, muted] = useThemeColor(["foreground", "muted"])
  const socket = useSocket()
  const isSocketConnected = useSocketConnected()
  const { workspace } = useWorkspace()
  const { channelId } = useLocalSearchParams<{ channelId: string }>()
  const { data: session } = authClient.useSession()
  const canPinMessages = useCanPinMessages(workspace?.id)
  const channelState = useChannelDetail({
    workspaceSlug: workspace?.slug ?? "",
    channelId: channelId ?? "",
  })

  const chat = useChannelMessages({
    workspaceSlug: workspace?.slug ?? "",
    channelId: channelId ?? "",
    socket,
    currentUser: session?.user,
  })
  const mentions = useWorkspaceMentionCandidates({
    workspaceSlug: workspace?.slug ?? "",
    currentUserId: session?.user.id,
  })

  useEffect(() => {
    setReplyingTo(null)
  }, [channelId])

  useFocusEffect(
    useCallback(() => {
      if (socket?.connected && channelId) {
        socket.emit("channel:join", { channelId })
      }
    }, [socket, channelId])
  )

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
  if (channelState.isLoading) {
    return (
      <Screen className="bg-background" edges={["top", "bottom"]}>
        <View className="flex-1 items-center justify-center">
          <Spinner accessibilityLabel="Loading channel" />
        </View>
      </Screen>
    )
  }
  if (channelState.error || !channelState.channel) {
    return (
      <Screen className="bg-background" edges={["top", "bottom"]}>
        <StatePanel
          action={{ label: "Back to channels", onPress: () => router.back() }}
          className="flex-1"
          detail={channelState.error ?? "This channel no longer exists."}
          status="danger"
          title="Channel unavailable"
        />
      </Screen>
    )
  }
  const channel = channelState.channel
  const channelName = channel.name ?? "channel"
  const openThread = (message: Message) => {
    router.push({
      pathname: "/channel/[channelId]/thread/[threadRootId]",
      params: { channelId, threadRootId: message.id },
    })
  }

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
          <View className="flex-row items-center gap-one">
            <View
              className={`size-[7px] rounded-full ${
                isSocketConnected ? "bg-success" : "bg-warning"
              }`}
            />
            <Text
              className="min-w-0 flex-1 text-xs font-medium leading-4 text-muted"
              numberOfLines={1}
            >
              {isSocketConnected ? "Online" : "Reconnecting"}
              {channel.topic ? ` · ${channel.topic}` : ""}
            </Text>
          </View>
        </View>
        <IconButton
          accessibilityLabel="Search channel"
          onPress={() => router.push("/explore")}
          variant="ghost"
        >
          <HugeiconsIcon color={foreground} icon={Search01Icon} size={19} />
        </IconButton>
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
          error={chat.error}
          isLoading={chat.isLoading}
          messages={chat.messages}
          onLoadAround={chat.loadAround}
          onOpenThread={openThread}
          onReply={setReplyingTo}
          onRetry={() => void chat.reload()}
          onToggleReaction={chat.toggleReaction}
          onTogglePin={
            canPinMessages
              ? (message) => {
                  void chat.togglePin(message.id, message.pinned)
                }
              : undefined
          }
          replyingToId={replyingTo?.id}
        />
        <MessageComposer
          channelName={channelName}
          isConnected={isSocketConnected}
          isMentionCandidatesLoading={mentions.isLoading}
          isSending={chat.isSending}
          mentionCandidates={mentions.candidates}
          mentionCandidatesError={mentions.error}
          onCancelReply={() => setReplyingTo(null)}
          onSend={async (content) => {
            await chat.sendMessage(content, replyingTo ?? undefined)
            setReplyingTo(null)
          }}
          replyingTo={replyingTo}
        />
      </KeyboardAvoidingView>
    </Screen>
  )
}
