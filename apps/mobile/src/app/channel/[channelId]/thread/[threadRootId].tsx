import { router, useLocalSearchParams } from "expo-router"
import { SymbolView } from "expo-symbols"
import { useThemeColor } from "heroui-native/hooks"
import { Text, View } from "react-native"
import { KeyboardAvoidingView } from "react-native-keyboard-controller"
import { MessageComposer } from "@/components/message-composer"
import {
  ThreadMessageList,
  ThreadMessageListSkeleton,
} from "@/components/thread-message-list"
import { IconButton } from "@/components/ui/icon-button"
import { Screen } from "@/components/ui/screen"
import { StatePanel } from "@/components/ui/state-panel"
import { useSocket, useSocketConnected } from "@/context/socket-context"
import { useWorkspace } from "@/context/workspace-context"
import { useChannelDetail } from "@/hooks/use-channel-detail"
import { useThreadMessages } from "@/hooks/use-thread-messages"
import { authClient } from "@/lib/auth-client"

export default function ThreadScreen() {
  const foreground = useThemeColor("foreground")
  const socket = useSocket()
  const isSocketConnected = useSocketConnected()
  const { workspace } = useWorkspace()
  const { channelId, threadRootId } = useLocalSearchParams<{
    channelId: string
    threadRootId: string
  }>()
  const { data: session } = authClient.useSession()
  const channelState = useChannelDetail({
    workspaceSlug: workspace?.slug ?? "",
    channelId: channelId ?? "",
  })
  const thread = useThreadMessages({
    workspaceSlug: workspace?.slug ?? "",
    channelId: channelId ?? "",
    threadRootId: threadRootId ?? "",
    socket,
    currentUser: session?.user,
  })

  const goBack = () => {
    if (router.canGoBack()) {
      router.back()
      return
    }
    router.replace({
      pathname: "/channel/[channelId]",
      params: { channelId },
    })
  }

  if (!workspace || !channelId || !threadRootId) {
    return (
      <Screen className="bg-background" edges={["top", "bottom"]}>
        <StatePanel
          action={{ label: "Back to channel", onPress: goBack }}
          className="flex-1"
          detail="Return to the channel and try opening the thread again."
          title="Thread unavailable"
        />
      </Screen>
    )
  }

  const channelName = channelState.channel?.name ?? "channel"

  return (
    <Screen className="bg-background" edges={["top", "bottom"]}>
      <View className="min-h-[60px] flex-row items-center gap-two border-b border-separator px-three">
        <IconButton
          accessibilityLabel="Back to channel"
          onPress={goBack}
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
          <Text className="text-[17px] font-bold tracking-[-0.2px] text-foreground">
            Thread
          </Text>
          <Text
            className="text-xs font-medium leading-4 text-muted"
            numberOfLines={1}
          >
            #{channelName}
          </Text>
        </View>
      </View>
      <KeyboardAvoidingView
        behavior="translate-with-padding"
        className="flex-1"
      >
        {thread.isLoading ? (
          <ThreadMessageListSkeleton />
        ) : thread.isMissing ? (
          <StatePanel
            action={{ label: "Back to channel", onPress: goBack }}
            className="flex-1"
            detail="The original message may have been deleted, or this thread is no longer available."
            title="Thread not found"
          />
        ) : thread.error || !thread.root ? (
          <StatePanel
            action={{ label: "Try again", onPress: () => void thread.reload() }}
            className="flex-1"
            detail={thread.error ?? "The original message is unavailable."}
            status="danger"
            title="Thread is unavailable"
          />
        ) : (
          <ThreadMessageList
            hasOlder={thread.hasOlder}
            isLoadingOlder={thread.isLoadingOlder}
            messages={thread.messages}
            onLoadOlder={() => void thread.loadOlder()}
            paginationError={thread.paginationError}
            root={thread.root}
            totalReplyCount={thread.totalReplyCount}
          />
        )}
        {thread.root && !thread.isMissing && !thread.error ? (
          <MessageComposer
            accessibilityLabel="Reply in thread"
            channelName={channelName}
            isConnected={isSocketConnected}
            isSending={thread.isSending}
            onSend={thread.sendMessage}
            placeholder="Reply in thread"
          />
        ) : null}
      </KeyboardAvoidingView>
    </Screen>
  )
}
