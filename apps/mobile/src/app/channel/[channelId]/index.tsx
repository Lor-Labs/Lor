import Archive02Icon from "@hugeicons/core-free-icons/Archive02Icon"
import DiscordIcon from "@hugeicons/core-free-icons/DiscordIcon"
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon"
import UserAdd01Icon from "@hugeicons/core-free-icons/UserAdd01Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { LOR_USER_ID } from "@repo/db/constants"
import type { RealtimeMessage } from "@repo/realtime-types"
import { router, useFocusEffect, useLocalSearchParams } from "expo-router"
import { SymbolView } from "expo-symbols"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Alert, Text, View } from "react-native"
import { ChannelSearchOverlay } from "@/components/channel-search-overlay"
import { ChatAvatar } from "@/components/chat-avatar"
import { ChatKeyboardLayout } from "@/components/chat-keyboard-layout"
import {
  MessageComposer,
  type MessageComposerMentionHandle,
} from "@/components/message-composer"
import { MessageList } from "@/components/message-list"
import { TypingIndicator } from "@/components/typing-indicator"
import { triggerHaptic } from "@/components/ui/haptics"
import { IconButton } from "@/components/ui/icon-button"
import { PressableScale } from "@/components/ui/pressable-scale"
import { Screen } from "@/components/ui/screen"
import { StatePanel } from "@/components/ui/state-panel"
import { UserProfileSheet } from "@/components/user-profile-sheet"
import { VoiceCallScreen } from "@/components/voice/voice-call-screen"
import { useSocket, useSocketConnected } from "@/context/socket-context"
import { useWorkspace } from "@/context/workspace-context"
import { useAutoMarkRead } from "@/hooks/use-auto-mark-read"
import {
  useChannelAgent,
  useChannelAgentState,
  useChannelAgents,
  useChannelHasNoAgent,
} from "@/hooks/use-channel-agent"
import { useChannelDetail } from "@/hooks/use-channel-detail"
import { useChannelDiscord } from "@/hooks/use-channel-discord"
import { useChannelMessages } from "@/hooks/use-channel-messages"
import { useChannelPermissions } from "@/hooks/use-channel-permissions"
import {
  useChatArchive,
  useChatPeople,
  useChatPeopleChanges,
} from "@/hooks/use-chats"
import { useOpenDM } from "@/hooks/use-open-dm"
import { useProfileSheet } from "@/hooks/use-profile-sheet"
import { useProjectUpdates } from "@/hooks/use-project-updates"
import { useChannelProposals } from "@/hooks/use-proposals"
import { useTypingIndicator } from "@/hooks/use-typing-indicator"
import { useWorkspaceMentionCandidates } from "@/hooks/use-workspace-mention-candidates"
import type { ChannelSearchResult, Message } from "@/lib/api-types"
import { authClient } from "@/lib/auth-client"
import { fetchMessageLocation, openMessageAt } from "@/lib/message-location"
import { openExternalUrl } from "@/lib/open-url"
import { confirmRemoveEmbed } from "@/lib/remove-embed"

export default function ChannelRoute() {
  const { workspace } = useWorkspace()
  const { channelId } = useLocalSearchParams<{ channelId: string }>()
  const { channel } = useChannelDetail({
    workspaceSlug: workspace?.slug ?? "",
    channelId: channelId ?? "",
  })

  if (channel?.type === "voice" && channelId) {
    return (
      <VoiceCallScreen
        key={channelId}
        channelId={channelId}
        channelName={channel.name ?? "Voice"}
      />
    )
  }
  return <ChannelScreen />
}

function writeAskDraft(
  composer: MessageComposerMentionHandle | null,
  agent: { id: string; name: string } | null,
  prompt?: string
) {
  if (prompt) composer?.replaceDraft(`${prompt} `)
  composer?.insertMention({
    id: agent?.id ?? LOR_USER_ID,
    label: agent?.name ?? "Lor",
  })
}

function ChannelScreen() {
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [editingMessage, setEditingMessage] = useState<Message | null>(null)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [focusedMessageId, setFocusedMessageId] = useState<string | null>(null)
  const hasFocusedRef = useRef(false)
  const composerMentionRef = useRef<MessageComposerMentionHandle>(null)
  // Leaving an edit restores the draft from before it, so a question asked
  // mid-edit waits until the composer has done that.
  const pendingAskRef = useRef<{ prompt?: string } | null>(null)
  const agent = useChannelAgent()
  const agents = useChannelAgents()
  const agentState = useChannelAgentState()
  const noAgent = useChannelHasNoAgent()
  useEffect(() => {
    const pending = pendingAskRef.current
    if (editingMessage || !pending) return
    pendingAskRef.current = null
    writeAskDraft(composerMentionRef.current, agent, pending.prompt)
  }, [editingMessage, agent])
  const [foreground, muted] = useThemeColor(["foreground", "muted"])
  const socket = useSocket()
  const isSocketConnected = useSocketConnected()
  const { workspace } = useWorkspace()
  const { channelId, focusMessageId, draft } = useLocalSearchParams<{
    channelId: string
    focusMessageId?: string
    // A new chat's first message that failed to send (chat/new.tsx).
    draft?: string
  }>()
  const { data: session } = authClient.useSession()
  const permissions = useChannelPermissions(workspace?.id)
  // The channel agent's proposal cards in the chat stay live.
  useChannelProposals(channelId)
  const channelState = useChannelDetail({
    workspaceSlug: workspace?.slug ?? "",
    channelId: channelId ?? "",
  })
  // Live archive lock: project:updated invalidates the channel detail, so an
  // open composer flips to the archived notice without a reload.
  useProjectUpdates(workspace?.slug)

  // `@Lor` here wakes the channel agent, which answers in the chat.
  const chat = useChannelMessages({
    source: {
      kind: "channel",
      workspaceSlug: workspace?.slug ?? "",
      channelId: channelId ?? "",
    },
    socket,
    currentUser: session?.user,
  })
  // Chat is people only: Lor's runs, plans, approvals, proposals and queues
  // live in sessions.
  useAutoMarkRead(channelId)
  const { typingUsers, emitTyping } = useTypingIndicator({
    socket,
    channelId: channelId ?? "",
    currentUserId: session?.user.id,
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
    profileUser,
    resetProfileSheet,
  } = useProfileSheet({
    avatarColorByUserId,
    members: mentions.members,
    mentionRef: composerMentionRef,
  })
  const { openDM } = useOpenDM()
  const workspaceSlug = workspace?.slug ?? ""
  const isText = channelState.channel?.type === "text"
  // A Discord channel agents are in is read here and written in Discord.
  const isPlace = channelState.channel?.kind === "place"
  // No composer (archived chat or place): reply, edit and Ask Lor are hidden.
  const readOnly = Boolean(channelState.channel?.archivedAt) || isPlace
  useEffect(() => {
    if (!readOnly) return
    setReplyingTo(null)
    setEditingMessage(null)
  }, [readOnly])
  const people = useChatPeople(
    workspaceSlug,
    isText && !isPlace ? (channelId ?? "") : ""
  )
  const discord = useChannelDiscord(workspaceSlug, channelId ?? "", isPlace)
  // Archived or unarchived by someone else: the composer and its bar follow.
  const { reload: reloadChannel } = channelState
  useEffect(() => {
    if (!socket || !channelId) return
    const onMessage = (message: RealtimeMessage) => {
      if (message.channelId !== channelId) return
      if (
        message.eventType === "channel_archived" ||
        message.eventType === "channel_unarchived"
      ) {
        void reloadChannel()
      }
    }
    socket.on("message:created", onMessage)
    return () => {
      socket.off("message:created", onMessage)
    }
  }, [socket, channelId, reloadChannel])

  useEffect(() => {
    hasFocusedRef.current = false
    setReplyingTo(null)
    setEditingMessage(null)
    setIsSavingEdit(false)
    setIsSearchOpen(false)
    setFocusedMessageId(null)
    resetProfileSheet()
  }, [channelId, resetProfileSheet])

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
  const channelName = channel.name ?? "Chat"
  const me = session?.user.id
  const others = (people.data ?? []).filter((person) => person.id !== me)
  const joined = people.data
    ? people.data.some((person) => person.id === me)
    : true
  const openDetails = () => {
    triggerHaptic("light")
    router.push({
      pathname: "/channel/[channelId]/details",
      params: { channelId },
    } as never)
  }
  const subtitle = !isSocketConnected
    ? "Reconnecting"
    : chatSubtitle({
        agents,
        state: agentState,
        peopleCount: people.data?.length ?? null,
        place: isPlace,
      })
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
  // A question about a message goes to the channel's agent in the chat: a
  // reply to it with @Lor in the composer (reference/always-on-agents.md,
  // step 3.4).
  const askLorAbout = (message: Message, prompt?: string) => {
    const editing = Boolean(editingMessage)
    startReply(message)
    if (editing) {
      pendingAskRef.current = { prompt }
      return
    }
    writeAskDraft(composerMentionRef.current, agent, prompt)
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
      const location = await fetchMessageLocation(workspace.slug, result.id)
      if (!location) throw new Error("Message unavailable")
      // In a thread or session: open it there; in chat: scroll to it here.
      if (location.threadRootId || location.sessionId) {
        openMessageAt(location, result.id)
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
            accessibilityLabel="Back to chats"
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
          <PressableScale
            accessibilityHint="Opens the chat's details, its people and agents"
            accessibilityLabel={`${channelName}, ${subtitle}`}
            accessibilityRole="button"
            className="min-w-0 flex-1 flex-row items-center gap-two"
            feedback="dim"
            onPress={openDetails}
          >
            <ChatAvatar
              agents={agents.map((item) => ({
                id: item.id,
                creature: item.creature,
              }))}
              people={
                others.length + agents.length > 0 ? others : (people.data ?? [])
              }
              size={36}
              total={agents.length + others.length}
            />
            <View className="min-w-0 flex-1 gap-px">
              <Text
                className="text-[17px] font-bold tracking-[-0.2px] text-foreground"
                numberOfLines={1}
              >
                {channelName}
              </Text>
              <View className="flex-row items-center gap-one">
                {isSocketConnected ? null : (
                  <View className="size-[7px] rounded-full bg-warning" />
                )}
                <Text
                  className={`min-w-0 flex-1 text-xs font-medium leading-4 ${
                    agentState === "working" || agentState === "needs_you"
                      ? "text-accent"
                      : "text-muted"
                  }`}
                  numberOfLines={1}
                >
                  {subtitle}
                </Text>
              </View>
            </View>
          </PressableScale>
          <IconButton
            accessibilityLabel="Search this chat"
            onPress={openSearch}
            variant="ghost"
          >
            <HugeiconsIcon color={foreground} icon={Search01Icon} size={19} />
          </IconButton>
          <IconButton
            accessibilityLabel="Chat details"
            className="mr-one"
            onPress={openDetails}
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
          renderComposer={({ inputNativeID, onCustomInputViewChange }) =>
            channel.archivedAt ? (
              <ArchivedChatBar
                archivedAt={channel.archivedAt}
                canUnarchive={permissions.canUpdateChannel}
                channelId={channelId}
                workspaceSlug={workspace.slug}
              />
            ) : isPlace ? (
              <DiscordPlaceBar
                link={discord.data?.link ?? null}
                loading={discord.isPending}
              />
            ) : (
              <>
                {isText && !joined ? (
                  <JoinChatBar
                    channelId={channelId}
                    me={me}
                    workspaceSlug={workspace.slug}
                  />
                ) : null}
                <MessageComposer
                  channelId={channelId}
                  channelName={channelName}
                  destination="channel"
                  editingMessage={editingMessage}
                  initialDraft={draft ?? ""}
                  lorIntro
                  inputNativeID={inputNativeID}
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
                />
              </>
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
              messages={chat.messages}
              onLoadAround={chat.loadAround}
              onOpenThread={openThread}
              onAskLor={noAgent || readOnly ? undefined : askLorAbout}
              onDelete={confirmDelete}
              onEdit={readOnly ? undefined : startEditing}
              onPressAuthor={openAuthorProfile}
              onReply={readOnly ? undefined : startReply}
              onRetry={() => void chat.reload()}
              onToggleReaction={chat.toggleReaction}
              onTogglePin={
                permissions.canPinMessages
                  ? (message) => {
                      void chat.togglePin(message.id, message.pinned)
                    }
                  : undefined
              }
              onRemoveEmbed={
                workspace
                  ? (message, url) =>
                      confirmRemoveEmbed({
                        workspaceSlug: workspace.slug,
                        channelId: message.channelId,
                        messageId: message.id,
                        url,
                      })
                  : undefined
              }
              canRemoveOthersEmbeds={permissions.canDeleteOthersMessages}
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

// What the header says under the name: what its agents are doing when
// that matters, else who is in it.
function chatSubtitle({
  agents,
  state,
  peopleCount,
  place,
}: {
  agents: { name: string }[]
  state: string
  peopleCount: number | null
  place: boolean
}) {
  const names = agents.map((agent) => agent.name)
  const lead = names.length === 1 ? names[0] : "An agent"
  if (state === "needs_you") return `${lead} is waiting on you`
  if (state === "working") return `${lead} is working`
  if (place)
    return names.length > 0 ? `In Discord · ${names.join(", ")}` : "In Discord"
  return [
    names.length > 0 ? names.join(", ") : null,
    peopleCount === null
      ? null
      : `${peopleCount} ${peopleCount === 1 ? "person" : "people"}`,
  ]
    .filter(Boolean)
    .join(" · ")
}

// The bar in place of a composer, with an optional button at its end.
function ComposerBar({
  icon,
  iconColor,
  children,
  action,
}: {
  icon: typeof Archive02Icon
  iconColor?: string
  children: string
  action?: { label: string; onPress: () => void; busy?: boolean }
}) {
  const muted = useThemeColor("muted")
  return (
    <View className="px-three pb-three pt-one">
      <View className="min-h-12 flex-row items-center gap-three rounded-lor-lg bg-surface-secondary py-two pl-four pr-two">
        <HugeiconsIcon
          color={iconColor ?? muted}
          icon={icon}
          size={18}
          strokeWidth={2}
        />
        <Text className="min-w-0 flex-1 text-[14px] leading-[19px] text-muted">
          {children}
        </Text>
        {action ? (
          <PressableScale
            accessibilityRole="button"
            className="h-9 items-center justify-center rounded-full bg-surface-tertiary px-four"
            disabled={action.busy}
            onPress={action.onPress}
            scale={0.95}
          >
            {action.busy ? (
              <Spinner size="sm" />
            ) : (
              <Text className="text-[14px] font-semibold text-foreground">
                {action.label}
              </Text>
            )}
          </PressableScale>
        ) : null}
      </View>
    </View>
  )
}

// An archived chat has no composer: the bar says when it closed, and
// someone who manages chats can open it again (decision 52).
function ArchivedChatBar({
  archivedAt,
  canUnarchive,
  channelId,
  workspaceSlug,
}: {
  archivedAt: string
  canUnarchive: boolean
  channelId: string
  workspaceSlug: string
}) {
  const { unarchive } = useChatArchive(workspaceSlug)
  const date = new Date(archivedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
  return (
    <ComposerBar
      action={
        canUnarchive
          ? {
              label: "Unarchive",
              busy: unarchive.isPending,
              onPress: () => unarchive.mutate({ channelId }),
            }
          : undefined
      }
      icon={Archive02Icon}
    >
      {`Archived ${date}. Nobody can post here.`}
    </ComposerBar>
  )
}

// A Discord channel agents are in is written in Discord (decision 51).
function DiscordPlaceBar({
  link,
  loading,
}: {
  link: {
    url: string
    channelName: string | null
    guildName: string | null
  } | null
  loading: boolean
}) {
  if (loading) return <View className="h-[72px]" />
  return (
    <ComposerBar
      action={
        link
          ? { label: "Open", onPress: () => openExternalUrl(link.url) }
          : undefined
      }
      icon={DiscordIcon}
      iconColor="#5865F2"
    >
      {link
        ? `This chat lives in Discord, in #${link.channelName ?? "channel"}${link.guildName ? ` on ${link.guildName}` : ""}. Write there.`
        : "This chat lives in Discord. Write there."}
    </ComposerBar>
  )
}

// Above the composer of a chat the person is only looking at: it is not in
// their list until they join, or write in it.
function JoinChatBar({
  channelId,
  me,
  workspaceSlug,
}: {
  channelId: string
  me: string | undefined
  workspaceSlug: string
}) {
  const { add } = useChatPeopleChanges(workspaceSlug, channelId)
  if (!me) return null
  return (
    <ComposerBar
      action={{
        label: "Join",
        busy: add.isPending,
        onPress: () => {
          triggerHaptic("light")
          add.mutate([me])
        },
      }}
      icon={UserAdd01Icon}
    >
      You're not in this chat, so it isn't in your list.
    </ComposerBar>
  )
}
