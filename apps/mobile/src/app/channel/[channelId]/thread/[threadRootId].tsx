import { router, useLocalSearchParams } from "expo-router"
import { SymbolView } from "expo-symbols"
import { useThemeColor } from "heroui-native/hooks"
import { useEffect, useMemo, useRef, useState } from "react"
import { Alert, Text, View } from "react-native"
import { KeyboardAvoidingView } from "react-native-keyboard-controller"
import {
  MessageComposer,
  type MessageComposerMentionHandle,
} from "@/components/message-composer"
import {
  ThreadMessageList,
  ThreadMessageListSkeleton,
} from "@/components/thread-message-list"
import { ThreadParticipantStack } from "@/components/thread-participant-stack"
import { TypingIndicator } from "@/components/typing-indicator"
import { IconButton } from "@/components/ui/icon-button"
import { Screen } from "@/components/ui/screen"
import { StatePanel } from "@/components/ui/state-panel"
import { UserProfileSheet } from "@/components/user-profile-sheet"
import { useSocket, useSocketConnected } from "@/context/socket-context"
import { useWorkspace } from "@/context/workspace-context"
import { useAutoMarkRead } from "@/hooks/use-auto-mark-read"
import { useCanPinMessages } from "@/hooks/use-can-pin-messages"
import { useChannelDetail } from "@/hooks/use-channel-detail"
import { useOpenDM } from "@/hooks/use-open-dm"
import { useProfileSheet } from "@/hooks/use-profile-sheet"
import { useThreadMessages } from "@/hooks/use-thread-messages"
import { useTypingIndicator } from "@/hooks/use-typing-indicator"
import { useWorkspaceMentionCandidates } from "@/hooks/use-workspace-mention-candidates"
import type { Message } from "@/lib/api-types"
import { authClient } from "@/lib/auth-client"

export default function ThreadScreen() {
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [editingMessage, setEditingMessage] = useState<Message | null>(null)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const composerMentionRef = useRef<MessageComposerMentionHandle>(null)
  const foreground = useThemeColor("foreground")
  const socket = useSocket()
  const isSocketConnected = useSocketConnected()
  const { workspace } = useWorkspace()
  const { channelId, focusMessageId, threadRootId } = useLocalSearchParams<{
    channelId: string
    focusMessageId?: string
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
  useAutoMarkRead(channelId)
  const { typingUsers, emitTyping } = useTypingIndicator({
    socket,
    channelId: channelId ?? "",
    currentUserId: session?.user.id,
    threadRootId: threadRootId ?? "",
  })
  const mentions = useWorkspaceMentionCandidates({
    workspaceSlug: workspace?.slug ?? "",
    currentUserId: session?.user.id,
  })
  const avatarColorByUserId = useMemo(
    () =>
      new Map(
        mentions.members.map((member) => [member.userId, member.avatarColor])
      ),
    [mentions.members]
  )
  const {
    closeProfile,
    mentionFromProfile,
    openAuthorProfile,
    openMemberProfile,
    profileUser,
    resetProfileSheet,
  } = useProfileSheet({
    avatarColorByUserId,
    members: mentions.members,
    mentionRef: composerMentionRef,
  })
  const { openDM } = useOpenDM()

  useEffect(() => {
    setReplyingTo(null)
    setEditingMessage(null)
    setIsSavingEdit(false)
    resetProfileSheet()
  }, [channelId, threadRootId, resetProfileSheet])

  useEffect(() => {
    if (!editingMessage) return
    const editingMessageExists =
      thread.root?.id === editingMessage.id ||
      thread.messages.some((message) => message.id === editingMessage.id)
    if (!editingMessageExists) {
      setEditingMessage(null)
      setIsSavingEdit(false)
    }
  }, [editingMessage, thread.messages, thread.root])

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

  const startReply = (message: Message) => {
    setEditingMessage(null)
    setReplyingTo(message)
  }

  const startEditing = (message: Message) => {
    setReplyingTo(null)
    setEditingMessage(message)
  }

  const confirmDelete = (message: Message) => {
    const isRoot = message.id === threadRootId
    Alert.alert(
      "Delete message?",
      isRoot
        ? "This message and all of its thread replies will be permanently deleted."
        : "This reply will be permanently deleted.",
      [
        { style: "cancel", text: "Cancel" },
        {
          style: "destructive",
          text: "Delete",
          onPress: () => {
            if (editingMessage?.id === message.id) setEditingMessage(null)
            if (replyingTo?.id === message.id) setReplyingTo(null)
            void thread.deleteMessage(message.id).catch((cause) => {
              Alert.alert(
                "Message not deleted",
                cause instanceof Error
                  ? cause.message
                  : "Please try again in a moment."
              )
            })
          },
        },
      ]
    )
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
        <ThreadParticipantStack
          members={mentions.members}
          onPressMember={openMemberProfile}
          participants={thread.participants}
        />
      </View>
      <KeyboardAvoidingView
        automaticOffset
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
            avatarColorByUserId={avatarColorByUserId}
            currentUserId={session?.user.id}
            editingMessageId={editingMessage?.id}
            focusMessageId={focusMessageId}
            hasOlder={thread.hasOlder}
            isLoadingOlder={thread.isLoadingOlder}
            messages={thread.messages}
            onLoadAround={thread.loadAround}
            onLoadOlder={() => void thread.loadOlder()}
            onDelete={confirmDelete}
            onEdit={startEditing}
            onPressAuthor={openAuthorProfile}
            onReply={startReply}
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
          <TypingIndicator users={typingUsers} />
        ) : null}
        {thread.root && !thread.isMissing && !thread.error ? (
          <MessageComposer
            accessibilityLabel="Reply in thread"
            channelId={channelId}
            channelName={channelName}
            editingMessage={editingMessage}
            isConnected={isSocketConnected}
            isMentionCandidatesLoading={mentions.isLoading}
            isSending={thread.isSending || isSavingEdit}
            mentionCandidates={mentions.candidates}
            mentionCandidatesError={mentions.error}
            mentionRef={composerMentionRef}
            onCancelEdit={() => setEditingMessage(null)}
            onCancelReply={() => setReplyingTo(null)}
            onTyping={emitTyping}
            onEdit={async (messageId, content) => {
              setIsSavingEdit(true)
              try {
                await thread.editMessage(messageId, content)
                setEditingMessage(null)
              } finally {
                setIsSavingEdit(false)
              }
            }}
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
      <UserProfileSheet
        currentUserId={session?.user.id}
        onMention={mentionFromProfile}
        onMessage={(target) => {
          closeProfile()
          void openDM(target.id)
        }}
        onOpenChange={(isOpen) => {
          if (!isOpen) closeProfile()
        }}
        user={profileUser}
      />
    </Screen>
  )
}
