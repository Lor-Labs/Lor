import { LOR_USER_ID } from "@repo/db/constants"
import { router } from "expo-router"
import { SymbolView } from "expo-symbols"
import { useThemeColor } from "heroui-native/hooks"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Alert, Text, View } from "react-native"
import { ChatKeyboardLayout } from "@/components/chat-keyboard-layout"
import {
  MessageComposer,
  type MessageComposerMentionHandle,
} from "@/components/message-composer"
import { RunQueuePill } from "@/components/run-queue-pill"
import {
  ThreadMessageList,
  ThreadMessageListSkeleton,
} from "@/components/thread-message-list"
import { ThreadParticipantStack } from "@/components/thread-participant-stack"
import {
  type PlanSourceFile,
  ThreadWorkHeader,
} from "@/components/thread-work-header"
import { TypingIndicator } from "@/components/typing-indicator"
import { IconButton } from "@/components/ui/icon-button"
import { StatePanel } from "@/components/ui/state-panel"
import { Tabs } from "@/components/ui/tabs"
import { UserProfileSheet } from "@/components/user-profile-sheet"
import { CallTranscript } from "@/components/voice/call-transcript"
import { useSocket, useSocketConnected } from "@/context/socket-context"
import { useVoiceCall } from "@/context/voice-call-context"
import { useWorkspace } from "@/context/workspace-context"
import { useChannelApprovals } from "@/hooks/use-approvals"
import { useAutoMarkRead } from "@/hooks/use-auto-mark-read"
import { useCanPinMessages } from "@/hooks/use-can-pin-messages"
import { useChannelDetail } from "@/hooks/use-channel-detail"
import { useOpenDM } from "@/hooks/use-open-dm"
import { usePlanForThread } from "@/hooks/use-plans"
import { useProfileSheet } from "@/hooks/use-profile-sheet"
import { useChannelProposals } from "@/hooks/use-proposals"
import { useRunQueue } from "@/hooks/use-run-queue"
import { useSessionStart } from "@/hooks/use-session-start"
import { useStopLorRun } from "@/hooks/use-stop-lor-run"
import { useThreadMessages } from "@/hooks/use-thread-messages"
import { useTypingIndicator } from "@/hooks/use-typing-indicator"
import { useWorkspaceMentionCandidates } from "@/hooks/use-workspace-mention-candidates"
import type { Message } from "@/lib/api-types"
import { authClient } from "@/lib/auth-client"

export type ThreadViewProps = {
  // A moment of the call, in ms, for the transcript to open at.
  at?: string
  channelId: string
  composerDraft?: string
  // Inside the call screen's drawer, which has its own header and tabs: only
  // the chat shows.
  embedded?: boolean
  focusMessageId?: string
  tab?: "chat" | "transcript"
  threadRootId: string
  // A Lor session's transcript. `pending`: its start isn't confirmed yet.
  session?: { title: string; pending: boolean }
}

// A thread: the thread screen, a Lor session, and the chat in a call's drawer.
export function ThreadView({
  at,
  channelId,
  composerDraft,
  embedded = false,
  focusMessageId,
  tab,
  threadRootId,
  session: lorSession,
}: ThreadViewProps) {
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [editingMessage, setEditingMessage] = useState<Message | null>(null)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const composerMentionRef = useRef<MessageComposerMentionHandle>(null)
  const { requestStop, stoppingMessageId } = useStopLorRun()
  const foreground = useThemeColor("foreground")
  const socket = useSocket()
  const isSocketConnected = useSocketConnected()
  const { workspace } = useWorkspace()
  const { call } = useVoiceCall()
  const { data: session } = authClient.useSession()
  const canPinMessages = useCanPinMessages(workspace?.id)
  const channelState = useChannelDetail({
    workspaceSlug: workspace?.slug ?? "",
    channelId: channelId ?? "",
  })
  const sessionStart = useSessionStart({
    id: channelId,
    name: channelState.channel?.name ?? null,
  })
  // A human thread: @Lor starts a session. Call chats live in voice
  // channels, where it starts nothing.
  const startsSessions = !lorSession && channelState.channel?.type === "text"
  const thread = useThreadMessages({
    workspaceSlug: workspace?.slug ?? "",
    channelId: channelId ?? "",
    threadRootId: threadRootId ?? "",
    socket,
    currentUser: session?.user,
    isSession: Boolean(lorSession),
    deferLoad: lorSession?.pending,
    sessionStart: startsSessions ? sessionStart : undefined,
  })
  useAutoMarkRead(channelId)
  // Approval cards in this thread read the channel-approvals cache; the
  // socket handlers live here so a thread opened directly stays live too.
  useChannelApprovals(channelId ?? "")
  // A proposal card opened as a thread root reads the same cache.
  useChannelProposals(channelId ?? "")
  // Messages queued behind the active Lor run — surfaced above the
  // composer with steer/remove actions while it's working.
  const pendingLorMessage = useMemo(
    () =>
      thread.messages.find((message) => message.status === "pending") ??
      (thread.root?.status === "pending" ? thread.root : undefined),
    [thread.messages, thread.root]
  )
  const pendingLorMessageId = pendingLorMessage?.id
  const { queuedIds, addOptimistic, removeOptimistic } = useRunQueue({
    socket,
    channelId: channelId ?? "",
    threadRootId: threadRootId ?? "",
    pendingLorMessageId,
  })
  const queuedMessages = useMemo(
    () =>
      queuedIds
        .map((id) => thread.messages.find((message) => message.id === id))
        .filter((message): message is Message => Boolean(message)),
    [queuedIds, thread.messages]
  )
  // Queued messages live only in the composer's queue pill until the drain
  // releases them — the transcript skips them (Codex model).
  const visibleMessages = useMemo(
    () => thread.messages.filter((message) => !queuedIds.includes(message.id)),
    [thread.messages, queuedIds]
  )
  const { typingUsers, emitTyping } = useTypingIndicator({
    socket,
    channelId: channelId ?? "",
    currentUserId: session?.user.id,
    threadRootId: threadRootId ?? "",
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

  // A thread is a plan thread iff a plan row anchors to its root — the root
  // message type no longer decides.
  const isPlanThread = !!usePlanForThread(channelId, threadRootId)
  // Newest Lor reply with tool calls — the work header's Activity chip.
  // Shown for any thread where Lor worked, plan or not (mirrors web).
  const activityMessage = useMemo(
    () =>
      thread.messages.find(
        (message) =>
          message.authorId === LOR_USER_ID &&
          (message.lorToolCalls?.length ?? 0) > 0
      ) ?? null,
    [thread.messages]
  )
  const showWorkHeader = isPlanThread || activityMessage !== null
  // Files uploaded into the plan thread (from any loaded message) — the
  // "Sources" side of the plan header's Files section.
  const planSources = useMemo<PlanSourceFile[]>(() => {
    if (!isPlanThread) return []
    const byUrl = new Map<string, PlanSourceFile>()
    for (const message of [thread.root, ...thread.messages]) {
      for (const attachment of message?.attachments ?? []) {
        byUrl.set(attachment.url, {
          url: attachment.url,
          filename: attachment.filename,
          size: attachment.size,
        })
      }
    }
    return [...byUrl.values()]
  }, [isPlanThread, thread.root, thread.messages])

  const stopPendingLor = useCallback(async () => {
    const messageId = pendingLorMessage?.id
    if (!messageId) return
    await requestStop(messageId)
  }, [pendingLorMessage?.id, requestStop])

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
      <StatePanel
        action={{ label: "Back to channel", onPress: goBack }}
        className="flex-1"
        detail="Return to the channel and try opening the thread again."
        title="Thread unavailable"
      />
    )
  }

  const channelName = channelState.channel?.name ?? "channel"
  // A session has no visible root to wait for.
  const isReady = Boolean(thread.root || lorSession)
  // A call's chat also holds its transcript.
  const voiceSessionId = thread.voiceSessionId
  const showTranscript = tab === "transcript" && voiceSessionId !== null
  const callTabs =
    voiceSessionId && !embedded ? (
      <View className="border-b border-separator px-four py-two">
        <Tabs
          onValueChange={(value) =>
            router.setParams({
              tab: value === "transcript" ? "transcript" : "chat",
              at: undefined,
            })
          }
          value={showTranscript ? "transcript" : "chat"}
        >
          <Tabs.List>
            <Tabs.Indicator />
            <Tabs.Trigger value="chat">
              <Tabs.Label>Chat</Tabs.Label>
            </Tabs.Trigger>
            <Tabs.Trigger value="transcript">
              <Tabs.Label>Transcript</Tabs.Label>
            </Tabs.Trigger>
          </Tabs.List>
        </Tabs>
      </View>
    ) : null

  const header = embedded ? null : (
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
        {/* A call chat takes Lor's name for the call once it's summarized. */}
        <Text
          className="text-[17px] font-bold tracking-[-0.2px] text-foreground"
          numberOfLines={1}
        >
          {lorSession
            ? lorSession.title
            : isPlanThread
              ? "Plan"
              : voiceSessionId
                ? (thread.voiceSessionTitle ?? "Call")
                : "Thread"}
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
  )

  return (
    <>
      {header}
      {callTabs}
      {showWorkHeader && !showTranscript ? (
        <ThreadWorkHeader
          activityMessage={activityMessage}
          channelId={channelId}
          sources={planSources}
          threadRootId={threadRootId}
        />
      ) : null}
      <ChatKeyboardLayout
        renderComposer={({
          inputNativeID,
          onCustomInputViewChange,
          onInputLayout,
        }) =>
          isReady && !thread.isMissing && !thread.error && !showTranscript ? (
            <MessageComposer
              accessibilityLabel={lorSession ? "Reply" : "Reply in thread"}
              destination={startsSessions ? "thread" : undefined}
              initialDraft={composerDraft}
              channelId={channelId}
              channelName={channelName}
              editingMessage={editingMessage}
              inputNativeID={inputNativeID}
              onInputLayout={onInputLayout}
              isStopping={stoppingMessageId === pendingLorMessageId}
              isConnected={isSocketConnected}
              isMentionCandidatesLoading={mentions.isLoading}
              // The thread doesn't exist until the start is confirmed.
              isSending={
                thread.isSending || isSavingEdit || Boolean(lorSession?.pending)
              }
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
                  await thread.editMessage(messageId, content)
                  setEditingMessage(null)
                } finally {
                  setIsSavingEdit(false)
                }
              }}
              onSend={async (content, attachments) => {
                // Lor is mid-answer in this thread, so the reply will
                // queue — show it in the pill immediately instead of waiting
                // for the routed round trip. A failed send drops the nonce
                // again, so a late created echo can't hide the real message.
                let nonce: string | undefined
                try {
                  await thread.sendMessage(
                    content,
                    replyingTo ?? undefined,
                    attachments,
                    pendingLorMessageId
                      ? (id) => {
                          nonce = id
                          addOptimistic(id)
                        }
                      : undefined
                  )
                } catch (error) {
                  if (nonce) removeOptimistic(nonce)
                  throw error
                }
                setReplyingTo(null)
              }}
              onStop={pendingLorMessage ? stopPendingLor : undefined}
              placeholder={lorSession ? "Reply…" : "Reply in thread"}
              replyingTo={replyingTo}
              topAccessory={
                <RunQueuePill
                  currentUserId={session?.user.id}
                  messages={queuedMessages}
                />
              }
            />
          ) : null
        }
        renderMessageList={(keyboardProps) =>
          showTranscript ? (
            <CallTranscript
              // A new moment remounts, so it scrolls again.
              atMs={at && /^\d+$/.test(at) ? Number(at) : undefined}
              key={at ?? "start"}
              live={call?.sessionId === voiceSessionId}
              sessionId={voiceSessionId}
            />
          ) : thread.isLoading ? (
            <ThreadMessageListSkeleton />
          ) : thread.isMissing ? (
            <StatePanel
              action={{ label: "Back to channel", onPress: goBack }}
              className="flex-1"
              detail="The original message may have been deleted, or this thread is no longer available."
              title="Thread not found"
            />
          ) : thread.error || !isReady ? (
            <StatePanel
              action={{
                label: "Try again",
                onPress: () => void thread.reload(),
              }}
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
              isRefreshing={thread.isRefreshing}
              isLoadingOlder={thread.isLoadingOlder}
              keyboardProps={keyboardProps}
              listKey={`thread-${threadRootId}`}
              messages={visibleMessages}
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
          )
        }
        typingIndicator={
          isReady && !thread.isMissing && !thread.error && !showTranscript ? (
            <TypingIndicator users={typingUsers} />
          ) : null
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
    </>
  )
}
