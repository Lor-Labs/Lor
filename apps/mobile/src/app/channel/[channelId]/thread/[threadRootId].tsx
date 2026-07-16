import { router, useLocalSearchParams } from "expo-router"
import { SymbolView } from "expo-symbols"
import { useThemeColor } from "heroui-native/hooks"
import { useEffect, useState } from "react"
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
import { useCanPinMessages } from "@/hooks/use-can-pin-messages"
import { useChannelDetail } from "@/hooks/use-channel-detail"
import { useThreadMessages } from "@/hooks/use-thread-messages"
import { useWorkspaceMentionCandidates } from "@/hooks/use-workspace-mention-candidates"
import type { Message } from "@/lib/api-types"
import { authClient } from "@/lib/auth-client"

export default function ThreadScreen() {
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const foreground = useThemeColor("foreground")
  const socket = useSocket()
  const isSocketConnected = useSocketConnected()
  const { workspace } = useWorkspace()
  const { channelId, threadRootId } = useLocalSearchParams<{
    channelId: string
    threadRootId: string
  }>()
  const { data: session } = authClient.useSession()
  const canPinMessages = useCanPinMessages(workspace?.id)
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
  const mentions = useWorkspaceMentionCandidates({
    workspaceSlug: workspace?.slug ?? "",
    currentUserId: session?.user.id,
  })

  useEffect(() => {
    setReplyingTo(null)
  }, [channelId, threadRootId])

  const goBack = () => {
    if (router.canGoBack()) {
      router.back()
      return
    }
    // Deep links can land here without a channelId — fall back to home
    // rather than building the channel route with a missing param.
    if (!channelId) {
      router.replace("/")
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
            onLoadAround={thread.loadAround}
            onLoadOlder={() => void thread.loadOlder()}
            onReply={setReplyingTo}
            onToggleReaction={thread.toggleReaction}
            onTogglePin={
              canPinMessages
                ? (message) => {
                    void thread.togglePin(message.id, message.pinned)
                  }
                : undefined
            }
            paginationError={thread.paginationError}
            root={thread.root}
            replyingToId={replyingTo?.id}
            totalReplyCount={thread.totalReplyCount}
          />
        )}
        {thread.root && !thread.isMissing && !thread.error ? (
          <MessageComposer
            accessibilityLabel="Reply in thread"
            channelId={channelId}
            channelName={channelName}
            isConnected={isSocketConnected}
            isMentionCandidatesLoading={mentions.isLoading}
            isSending={thread.isSending}
            mentionCandidates={mentions.candidates}
            mentionCandidatesError={mentions.error}
            onCancelReply={() => setReplyingTo(null)}
            onSend={async (content, attachments) => {
              await thread.sendMessage(
                content,
                replyingTo ?? undefined,
                attachments
              )
              setReplyingTo(null)
            }}
            placeholder="Reply in thread"
            replyingTo={replyingTo}
          />
        ) : null}
      </KeyboardAvoidingView>
    </Screen>
  )
}
