import Search01Icon from "@hugeicons/core-free-icons/Search01Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { router, useFocusEffect, useLocalSearchParams } from "expo-router"
import { SymbolView } from "expo-symbols"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import { useCallback, useEffect, useRef, useState } from "react"
import { Alert, Text, View } from "react-native"
import { KeyboardAvoidingView } from "react-native-keyboard-controller"
import { ChannelOptionsSheet } from "@/components/channel-options-sheet"
import { ChannelSearchOverlay } from "@/components/channel-search-overlay"
import { MessageComposer } from "@/components/message-composer"
import { MessageList } from "@/components/message-list"
import { IconButton } from "@/components/ui/icon-button"
import { Screen } from "@/components/ui/screen"
import { StatePanel } from "@/components/ui/state-panel"
import { useSocket, useSocketConnected } from "@/context/socket-context"
import { useWorkspace } from "@/context/workspace-context"
import { useChannelDetail } from "@/hooks/use-channel-detail"
import { useChannelMessages } from "@/hooks/use-channel-messages"
import { useChannelPermissions } from "@/hooks/use-channel-permissions"
import { useWorkspaceMentionCandidates } from "@/hooks/use-workspace-mention-candidates"
import { api } from "@/lib/api"
import type { ChannelSearchResult, Message } from "@/lib/api-types"
import { authClient } from "@/lib/auth-client"

export default function ChannelScreen() {
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [editingMessage, setEditingMessage] = useState<Message | null>(null)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isOptionsOpen, setIsOptionsOpen] = useState(false)
  const [focusedMessageId, setFocusedMessageId] = useState<string | null>(null)
  const hasFocusedRef = useRef(false)
  const [foreground, muted] = useThemeColor(["foreground", "muted"])
  const socket = useSocket()
  const isSocketConnected = useSocketConnected()
  const { workspace } = useWorkspace()
  const { channelId, focusMessageId } = useLocalSearchParams<{
    channelId: string
    focusMessageId?: string
  }>()
  const { data: session } = authClient.useSession()
  const permissions = useChannelPermissions(workspace?.id)
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
    hasFocusedRef.current = false
    setReplyingTo(null)
    setEditingMessage(null)
    setIsSavingEdit(false)
    setIsSearchOpen(false)
    setIsOptionsOpen(false)
    setFocusedMessageId(null)
  }, [channelId])

  useEffect(() => {
    if (!focusMessageId) return
    setIsOptionsOpen(false)
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
      if (hasFocusedRef.current) void chat.reload({ replace: true })
      else hasFocusedRef.current = true
      if (socket?.connected && channelId) {
        socket.emit("channel:join", { channelId })
      }
    }, [socket, channelId, chat.reload])
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
  const startReply = (message: Message) => {
    setEditingMessage(null)
    setReplyingTo(message)
  }
  const startEditing = (message: Message) => {
    setReplyingTo(null)
    setEditingMessage(message)
  }
  const openSearch = () => {
    setFocusedMessageId(null)
    setIsSearchOpen(true)
  }
  const selectSearchResult = async (result: ChannelSearchResult) => {
    setIsSearchOpen(false)
    try {
      const response = await api.v1.workspaces[":workspaceSlug"].messages[
        ":messageId"
      ].$get({
        param: { workspaceSlug: workspace.slug, messageId: result.id },
      })
      if (!response.ok) throw new Error("Message unavailable")
      const location = await response.json()

      if (location.threadRootId) {
        router.push({
          pathname: "/channel/[channelId]/thread/[threadRootId]",
          params: {
            channelId: location.channelId,
            focusMessageId: result.id,
            threadRootId: location.threadRootId,
          },
        })
        return
      }

      const loaded = await chat.loadAround(result.id)
      if (!loaded) throw new Error("Message unavailable")
      setFocusedMessageId(result.id)
    } catch {
      Alert.alert(
        "Message unavailable",
        "This message may have been deleted. Try searching again."
      )
    }
  }
  const confirmDelete = (message: Message) => {
    const detail = message.threadSummary
      ? "This message and all of its thread replies will be permanently deleted."
      : "This message will be permanently deleted."

    Alert.alert("Delete message?", detail, [
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
    ])
  }

  return (
    <Screen className="bg-background" edges={["top", "bottom"]}>
      <View className={isSearchOpen ? "hidden flex-1" : "flex-1"}>
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
            onPress={openSearch}
            variant="ghost"
          >
            <HugeiconsIcon color={foreground} icon={Search01Icon} size={19} />
          </IconButton>
          <IconButton
            accessibilityLabel="Channel options"
            className="mr-one"
            onPress={() => setIsOptionsOpen(true)}
            variant="ghost"
          >
            <SymbolView
              name={{
                ios: "ellipsis",
                android: "more_horiz",
                web: "more_horiz",
              }}
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
            editingMessageId={editingMessage?.id}
            error={chat.error}
            focusMessageId={focusedMessageId}
            isLoading={chat.isLoading}
            messages={chat.messages}
            onLoadAround={chat.loadAround}
            onOpenThread={openThread}
            onDelete={confirmDelete}
            onEdit={startEditing}
            onReply={startReply}
            onRetry={() => void chat.reload()}
            onToggleReaction={chat.toggleReaction}
            onTogglePin={
              permissions.canPinMessages
                ? (message) => {
                    void chat.togglePin(message.id, message.pinned)
                  }
                : undefined
            }
            replyingToId={replyingTo?.id}
          />
          <MessageComposer
            channelId={channelId}
            channelName={channelName}
            editingMessage={editingMessage}
            isConnected={isSocketConnected}
            isMentionCandidatesLoading={mentions.isLoading}
            isSending={chat.isSending || isSavingEdit}
            mentionCandidates={mentions.candidates}
            mentionCandidatesError={mentions.error}
            onCancelEdit={() => setEditingMessage(null)}
            onCancelReply={() => setReplyingTo(null)}
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
            replyingTo={replyingTo}
          />
        </KeyboardAvoidingView>
      </View>
      {isSearchOpen ? (
        <ChannelSearchOverlay
          channelId={channelId}
          channelName={channelName}
          onClose={() => setIsSearchOpen(false)}
          onSelectMessage={(message) => void selectSearchResult(message)}
          visible
          workspaceSlug={workspace.slug}
        />
      ) : null}
      <ChannelOptionsSheet
        canDeleteChannel={permissions.canDeleteChannel}
        canUpdateChannel={permissions.canUpdateChannel}
        channel={channel}
        isOpen={isOptionsOpen}
        onChannelDeleted={() => router.replace("/")}
        onChannelUpdated={channelState.replaceChannel}
        onOpenPinnedMessages={() => {
          router.push({
            pathname: "/channel/[channelId]/pins",
            params: { channelId },
          })
          setIsOptionsOpen(false)
        }}
        onOpenChange={setIsOptionsOpen}
        workspaceName={workspace.name}
        workspaceSlug={workspace.slug}
      />
    </Screen>
  )
}
