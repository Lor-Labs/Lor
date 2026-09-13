import Archive02Icon from "@hugeicons/core-free-icons/Archive02Icon"
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { router, useFocusEffect, useLocalSearchParams } from "expo-router"
import { SymbolView } from "expo-symbols"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Alert, Pressable, Text, View } from "react-native"
import { ChannelOptionsSheet } from "@/components/channel-options-sheet"
import { ChannelSearchOverlay } from "@/components/channel-search-overlay"
import { ChatKeyboardLayout } from "@/components/chat-keyboard-layout"
import { MemberActionsSheet } from "@/components/member-actions-sheet"
import {
  type MemberListItem,
  MemberListSheet,
  workspaceMemberToListItem,
} from "@/components/member-list-sheet"
import {
  MessageComposer,
  type MessageComposerMentionHandle,
} from "@/components/message-composer"
import { MessageList } from "@/components/message-list"
import { RunQueuePill } from "@/components/run-queue-pill"
import { TypingIndicator } from "@/components/typing-indicator"
import { triggerHaptic } from "@/components/ui/haptics"
import { IconButton } from "@/components/ui/icon-button"
import { Screen } from "@/components/ui/screen"
import { StatePanel } from "@/components/ui/state-panel"
import { UserProfileSheet } from "@/components/user-profile-sheet"
import { useSocket, useSocketConnected } from "@/context/socket-context"
import { useWorkspace } from "@/context/workspace-context"
import { useChannelApprovals } from "@/hooks/use-approvals"
import { useAutoMarkRead } from "@/hooks/use-auto-mark-read"
import { useChannelDetail } from "@/hooks/use-channel-detail"
import { useChannelMessages } from "@/hooks/use-channel-messages"
import { useChannelPermissions } from "@/hooks/use-channel-permissions"
import { useMemberModeration } from "@/hooks/use-member-moderation"
import { useOpenDM } from "@/hooks/use-open-dm"
import { useChannelPlans } from "@/hooks/use-plans"
import { useProfileSheet } from "@/hooks/use-profile-sheet"
import { useProjectUpdates } from "@/hooks/use-project-updates"
import { useChannelProposals } from "@/hooks/use-proposals"
import { useRunQueue } from "@/hooks/use-run-queue"
import { useTypingIndicator } from "@/hooks/use-typing-indicator"
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
  const [isMembersOpen, setIsMembersOpen] = useState(false)
  const [moderationMember, setModerationMember] =
    useState<MemberListItem | null>(null)
  const [focusedMessageId, setFocusedMessageId] = useState<string | null>(null)
  const hasFocusedRef = useRef(false)
  const composerMentionRef = useRef<MessageComposerMentionHandle>(null)
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
  // Live archive lock: project:updated invalidates the channel detail, so an
  // open composer flips to the archived notice without a reload.
  useProjectUpdates(workspace?.slug)

  const chat = useChannelMessages({
    source: {
      kind: "channel",
      workspaceSlug: workspace?.slug ?? "",
      channelId: channelId ?? "",
    },
    socket,
    currentUser: session?.user,
  })
  // Screen-level plan subscription (mirrors web's route-level one): plan
  // cards mount their own listeners, but virtualized cards unmount — without
  // this a terminal plan:updated lands with no listener and the list goes
  // stale until a refetch.
  useChannelPlans(channelId ?? "")
  useAutoMarkRead(channelId)
  // Live source for every approval card in this channel (message cards read
  // the same cache); the socket handlers live here, once per screen.
  useChannelApprovals(channelId ?? "")
  // Proposal cards read this cache the same way.
  useChannelProposals(channelId ?? "")
  // Channel-scope queue (a send can land while a run is finalizing) —
  // surfaced in the same composer pill as thread queues.
  const pendingLorMessageId = useMemo(
    () => chat.messages.find((message) => message.status === "pending")?.id,
    [chat.messages]
  )
  const { queuedIds } = useRunQueue({
    socket,
    channelId: channelId ?? "",
    threadRootId: null,
    pendingLorMessageId,
  })
  const queuedMessages = useMemo(
    () =>
      queuedIds
        .map((id) => chat.messages.find((message) => message.id === id))
        .filter((message): message is Message => Boolean(message)),
    [queuedIds, chat.messages]
  )
  // Queued messages live only in the composer's queue pill until the drain
  // releases them — the transcript skips them (Codex model).
  const visibleMessages = useMemo(
    () => chat.messages.filter((message) => !queuedIds.includes(message.id)),
    [chat.messages, queuedIds]
  )
  const { typingUsers, emitTyping } = useTypingIndicator({
    socket,
    channelId: channelId ?? "",
    currentUserId: session?.user.id,
  })
  const mentions = useWorkspaceMentionCandidates({
    workspaceSlug: workspace?.slug ?? "",
    currentUserId: session?.user.id,
    channelAudience: channelState.channel?.audience,
  })
  const avatarColorByUserId = useMemo(
    () =>
      new Map(
        mentions.members.map((member) => [member.userId, member.avatarColor])
      ),
    [mentions.members]
  )
  const memberNameById = useMemo(
    () =>
      new Map(mentions.members.map((member) => [member.userId, member.name])),
    [mentions.members]
  )
  const resolveUserName = useCallback(
    (userId: string) => memberNameById.get(userId),
    [memberNameById]
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
  const moderation = useMemberModeration({
    currentUserId: session?.user.id,
    workspaceId: workspace?.id,
    workspaceSlug: workspace?.slug ?? "",
  })

  useEffect(() => {
    hasFocusedRef.current = false
    setReplyingTo(null)
    setEditingMessage(null)
    setIsSavingEdit(false)
    setIsSearchOpen(false)
    setIsOptionsOpen(false)
    setIsMembersOpen(false)
    setModerationMember(null)
    setFocusedMessageId(null)
    resetProfileSheet()
  }, [channelId, resetProfileSheet])

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
      if (hasFocusedRef.current) {
        void chat.reload({ replace: true, silent: true })
      } else {
        hasFocusedRef.current = true
      }
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
  const memberItems = mentions.members.map(workspaceMemberToListItem)
  const onlineMemberCount = memberItems.filter(
    (member) => member.status === "online"
  ).length
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
  const openProfileFromMemberList = (member: MemberListItem) => {
    setIsMembersOpen(false)
    openMemberProfile(member)
  }
  const openMemberActions = (member: MemberListItem) => {
    if (!moderation.canModerate(member)) return
    triggerHaptic("soft")
    setIsMembersOpen(false)
    setModerationMember(member)
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
            <Pressable
              accessibilityHint="Opens the workspace member list"
              accessibilityLabel={
                isSocketConnected
                  ? `${onlineMemberCount} members online`
                  : "Reconnecting"
              }
              accessibilityRole="button"
              className="flex-row items-center gap-one rounded-lor-sm active:opacity-70"
              hitSlop={6}
              onPress={() => setIsMembersOpen(true)}
            >
              <View
                className={`size-[7px] rounded-full ${
                  isSocketConnected ? "bg-success" : "bg-warning"
                }`}
              />
              <Text
                className="min-w-0 flex-1 text-xs font-medium leading-4 text-muted"
                numberOfLines={1}
              >
                {isSocketConnected
                  ? `${onlineMemberCount} Online`
                  : "Reconnecting"}
                {channel.topic ? ` · ${channel.topic}` : ""}
              </Text>
            </Pressable>
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
        <ChatKeyboardLayout
          renderComposer={({
            inputNativeID,
            onCustomInputViewChange,
            onInputLayout,
          }) =>
            channel.archivedAt ? (
              <ArchivedChannelNotice archivedAt={channel.archivedAt} />
            ) : (
              <MessageComposer
                channelId={channelId}
                channelName={channelName}
                editingMessage={editingMessage}
                inputNativeID={inputNativeID}
                onInputLayout={onInputLayout}
                isConnected={isSocketConnected}
                isMentionCandidatesLoading={mentions.isLoading}
                isSending={chat.isSending || isSavingEdit}
                mentionCandidates={mentions.candidates}
                mentionCandidatesError={mentions.error}
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
                replyingTo={replyingTo}
                topAccessory={
                  <RunQueuePill
                    currentUserId={session?.user.id}
                    messages={queuedMessages}
                  />
                }
              />
            )
          }
          renderMessageList={(keyboardProps) => (
            <MessageList
              avatarColorByUserId={avatarColorByUserId}
              channelName={channelName}
              currentUserId={session?.user.id}
              editingMessageId={editingMessage?.id}
              error={chat.error}
              focusMessageId={focusedMessageId}
              isLoading={chat.isLoading}
              keyboardProps={keyboardProps}
              listKey={`channel-${channelId}`}
              messages={visibleMessages}
              onLoadAround={chat.loadAround}
              onOpenThread={openThread}
              onDelete={confirmDelete}
              onEdit={startEditing}
              onPressAuthor={openAuthorProfile}
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
              resolveUserName={resolveUserName}
            />
          )}
          typingIndicator={<TypingIndicator users={typingUsers} />}
        />
      </View>
      {isSearchOpen ? (
        <ChannelSearchOverlay
          avatarColorByUserId={avatarColorByUserId}
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
      <MemberListSheet
        error={mentions.error}
        isLoading={mentions.isLoading}
        isOpen={isMembersOpen}
        memberHasActions={moderation.canModerate}
        members={memberItems}
        onLongPressMember={openMemberActions}
        onOpenChange={setIsMembersOpen}
        onPressMember={openProfileFromMemberList}
        onRetry={() => void mentions.reload()}
        title="Channel members"
      />
      <MemberActionsSheet
        canKick={
          moderationMember ? moderation.canKick(moderationMember) : false
        }
        isBusy={moderation.isBusy}
        member={moderationMember}
        onChangeRole={(userId, role) => moderation.changeRole({ userId, role })}
        onKick={(userId) => moderation.kick(userId)}
        onOpenChange={(isOpen) => {
          if (!isOpen) setModerationMember(null)
        }}
        roleOptions={
          moderationMember ? moderation.roleOptionsFor(moderationMember) : []
        }
      />
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

// Archived channels are read-only: the composer is replaced by a terminal
// divider marking when the project closed \xe2\x80\x94 mirrors the web treatment.
function ArchivedChannelNotice({ archivedAt }: { archivedAt: string }) {
  const muted = useThemeColor("muted")
  const formatted = new Date(archivedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
  return (
    <View className="px-four pb-four pt-two">
      <View className="flex-row items-center">
        <View className="h-px flex-1 bg-separator" />
        <View className="mx-two flex-row items-center gap-one rounded-full border border-separator px-two py-1">
          <HugeiconsIcon
            color={muted}
            icon={Archive02Icon}
            size={14}
            strokeWidth={2}
          />
          <Text className="text-xs font-medium text-muted">
            Archived {formatted}
          </Text>
        </View>
        <View className="h-px flex-1 bg-separator" />
      </View>
    </View>
  )
}
