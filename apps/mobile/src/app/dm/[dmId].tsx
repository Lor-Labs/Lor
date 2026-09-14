import { router, useFocusEffect, useLocalSearchParams } from "expo-router"
import { SymbolView } from "expo-symbols"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Alert, Text, View } from "react-native"
import { ChatKeyboardLayout } from "@/components/chat-keyboard-layout"
import { DMAvatar } from "@/components/dm-avatar"
import {
  MessageComposer,
  type MessageComposerMentionHandle,
} from "@/components/message-composer"
import { MessageList } from "@/components/message-list"
import { TypingIndicator } from "@/components/typing-indicator"
import { IconButton } from "@/components/ui/icon-button"
import { Screen } from "@/components/ui/screen"
import { StatePanel } from "@/components/ui/state-panel"
import { UserProfileSheet } from "@/components/user-profile-sheet"
import { useSocket, useSocketConnected } from "@/context/socket-context"
import { useAutoMarkRead } from "@/hooks/use-auto-mark-read"
import { useChannelMessages } from "@/hooks/use-channel-messages"
import { useDM } from "@/hooks/use-dms"
import { useProfileSheet } from "@/hooks/use-profile-sheet"
import { useTypingIndicator } from "@/hooks/use-typing-indicator"
import type { Message } from "@/lib/api-types"
import { authClient } from "@/lib/auth-client"
import { dmDisplayName, dmMemberToMentionCandidate } from "@/lib/dms"

const EMPTY_AVATAR_COLORS: ReadonlyMap<string, string> = new Map()

export default function DMScreen() {
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [editingMessage, setEditingMessage] = useState<Message | null>(null)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [focusedMessageId, setFocusedMessageId] = useState<string | null>(null)
  const hasFocusedRef = useRef(false)
  const composerMentionRef = useRef<MessageComposerMentionHandle>(null)
  const foreground = useThemeColor("foreground")
  const socket = useSocket()
  const isSocketConnected = useSocketConnected()
  const { dmId, focusMessageId } = useLocalSearchParams<{
    dmId: string
    focusMessageId?: string
  }>()
  const { data: session } = authClient.useSession()
  const dmState = useDM(dmId ?? "")

  const chat = useChannelMessages({
    source: { kind: "dm", dmId: dmId ?? "" },
    socket,
    currentUser: session?.user,
  })
  useAutoMarkRead(dmId)
  const { typingUsers, emitTyping } = useTypingIndicator({
    socket,
    channelId: dmId ?? "",
    currentUserId: session?.user.id,
  })
  const mentionCandidates = useMemo(
    () => dmState.dm?.members.map(dmMemberToMentionCandidate) ?? [],
    [dmState.dm]
  )
  const {
    closeProfile,
    mentionFromProfile,
    openAuthorProfile,
    profileUser,
    resetProfileSheet,
  } = useProfileSheet({
    avatarColorByUserId: EMPTY_AVATAR_COLORS,
    members: [],
    mentionRef: composerMentionRef,
  })

  useEffect(() => {
    hasFocusedRef.current = false
    setReplyingTo(null)
    setEditingMessage(null)
    setIsSavingEdit(false)
    setFocusedMessageId(null)
    resetProfileSheet()
  }, [dmId, resetProfileSheet])

  useEffect(() => {
    if (!focusMessageId) return
    void chat.loadAround(focusMessageId).then((loaded) => {
      if (loaded) setFocusedMessageId(focusMessageId)
    })
  }, [chat.loadAround, focusMessageId])

  useEffect(() => {
    if (
      editingMessage &&
      !chat.messages.some((message) => message.id === editingMessage.id)
    ) {
      setEditingMessage(null)
      setIsSavingEdit(false)
    }
  }, [chat.messages, editingMessage])

  useFocusEffect(
    useCallback(() => {
      if (hasFocusedRef.current) {
        void chat.reload({ replace: true, silent: true })
      } else {
        hasFocusedRef.current = true
      }
      if (socket?.connected && dmId) {
        socket.emit("channel:join", { channelId: dmId })
      }
    }, [socket, dmId, chat.reload])
  )

  if (!dmId) {
    return (
      <Screen className="bg-background" edges={["top", "bottom"]}>
        <StatePanel
          className="flex-1"
          detail="Return to your messages and try again."
          title="Conversation unavailable"
        />
      </Screen>
    )
  }
  if (dmState.isLoading) {
    return (
      <Screen className="bg-background" edges={["top", "bottom"]}>
        <View className="flex-1 items-center justify-center">
          <Spinner accessibilityLabel="Loading conversation" />
        </View>
      </Screen>
    )
  }
  if (dmState.error || !dmState.dm) {
    return (
      <Screen className="bg-background" edges={["top", "bottom"]}>
        <StatePanel
          action={{ label: "Back to messages", onPress: () => router.back() }}
          className="flex-1"
          detail={dmState.error ?? "This conversation no longer exists."}
          status="danger"
          title="Conversation unavailable"
        />
      </Screen>
    )
  }
  const dm = dmState.dm
  const name = dmDisplayName(dm)
  const subtitle =
    dm.type === "group_dm"
      ? `${dm.members.length + 1} members`
      : "Direct message"
  const startReply = (message: Message) => {
    setEditingMessage(null)
    setReplyingTo(message)
  }
  const startEditing = (message: Message) => {
    setReplyingTo(null)
    setEditingMessage(message)
  }
  const confirmDelete = (message: Message) => {
    Alert.alert(
      "Delete message?",
      "This message will be permanently deleted.",
      [
        { style: "cancel", text: "Cancel" },
        {
          style: "destructive",
          text: "Delete",
          onPress: () => {
            if (editingMessage?.id === message.id) setEditingMessage(null)
            if (replyingTo?.id === message.id) setReplyingTo(null)
            void chat.deleteMessage(message.id).catch((cause) => {
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

  return (
    <Screen className="bg-background" edges={["top", "bottom"]}>
      <View className="min-h-[60px] flex-row items-center gap-two border-b border-separator px-three">
        <IconButton
          accessibilityLabel="Back to messages"
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
        <DMAvatar dm={dm} size="sm" />
        <View className="min-w-0 flex-1 gap-px">
          <Text
            className="text-[17px] font-bold tracking-[-0.2px] text-foreground"
            numberOfLines={1}
          >
            {name}
          </Text>
          <Text
            className="text-xs font-medium leading-4 text-muted"
            numberOfLines={1}
          >
            {isSocketConnected ? subtitle : "Reconnecting"}
          </Text>
        </View>
      </View>
      <ChatKeyboardLayout
        renderComposer={({
          inputNativeID,
          onCustomInputViewChange,
          onInputLayout,
        }) => (
          <MessageComposer
            accessibilityLabel={`Message ${name}`}
            channelId={dmId}
            channelName={name}
            editingMessage={editingMessage}
            inputNativeID={inputNativeID}
            onInputLayout={onInputLayout}
            isConnected={isSocketConnected}
            isSending={chat.isSending || isSavingEdit}
            mentionCandidates={mentionCandidates}
            mentionRef={composerMentionRef}
            onCancelEdit={() => setEditingMessage(null)}
            onCancelReply={() => setReplyingTo(null)}
            onCustomInputViewChange={onCustomInputViewChange}
            onTyping={emitTyping}
            onEdit={async (messageId, content) => {
              setIsSavingEdit(true)
              try {
                await chat.editMessage(messageId, content)
                setEditingMessage(null)
              } finally {
                setIsSavingEdit(false)
              }
            }}
            onSend={async (content, attachments) => {
              await chat.sendMessage(
                content,
                replyingTo ?? undefined,
                attachments
              )
              setReplyingTo(null)
            }}
            placeholder={`Message ${name}`}
            replyingTo={replyingTo}
          />
        )}
        renderMessageList={(keyboardProps) => (
          <MessageList
            channelName={name}
            currentUserId={session?.user.id}
            editingMessageId={editingMessage?.id}
            emptyState={{
              title: name,
              detail:
                dm.type === "dm"
                  ? `This is the beginning of your conversation with ${name}.`
                  : "This is the beginning of this group conversation.",
            }}
            error={chat.error}
            focusMessageId={focusedMessageId}
            isLoading={chat.isLoading}
            keyboardProps={keyboardProps}
            listKey={`dm-${dmId}`}
            messages={chat.messages}
            onLoadAround={chat.loadAround}
            onDelete={confirmDelete}
            onEdit={startEditing}
            onPressAuthor={openAuthorProfile}
            onReply={startReply}
            onRetry={() => void chat.reload()}
            onToggleReaction={chat.toggleReaction}
            replyingToId={replyingTo?.id}
          />
        )}
        typingIndicator={<TypingIndicator users={typingUsers} />}
      />
      <UserProfileSheet
        currentUserId={session?.user.id}
        onMention={mentionFromProfile}
        onOpenChange={(isOpen) => {
          if (!isOpen) closeProfile()
        }}
        user={profileUser}
      />
    </Screen>
  )
}
