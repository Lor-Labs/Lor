import Archive02Icon from "@hugeicons/core-free-icons/Archive02Icon"
import SourceCodeIcon from "@hugeicons/core-free-icons/SourceCodeIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { LOR_USER_ID } from "@repo/db/constants"
import { isHarnessAllowedInBeta, isHarnessEnabled } from "@repo/utils/features"
import { useQuery } from "@tanstack/react-query"
import { router } from "expo-router"
import { SymbolView } from "expo-symbols"
import { useThemeColor } from "heroui-native/hooks"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Alert, Pressable, ScrollView, Text, View } from "react-native"
import Animated, { FadeIn, FadeOut } from "react-native-reanimated"
import { ChatKeyboardLayout } from "@/components/chat-keyboard-layout"
import {
  ClaudeCodeModePicker,
  useClaudeCodeMode,
} from "@/components/claude-code-mode-picker"
import { ConnectOnWebNotice } from "@/components/connect-on-web-notice"
import { ContextMeter } from "@/components/context-meter"
import { ForwardSheet } from "@/components/forward-sheet"
import {
  MessageComposer,
  type MessageComposerMentionHandle,
} from "@/components/message-composer"
import { ModelPicker } from "@/components/model-picker"
import { RunQueuePill } from "@/components/run-queue-pill"
import { SessionCodeDrawer } from "@/components/session-code-drawer"
import { SessionHeading } from "@/components/session-heading"
import { SessionSheet } from "@/components/session-sheet"
import {
  ThreadMessageList,
  ThreadMessageListSkeleton,
} from "@/components/thread-message-list"
import { ThreadParticipantStack } from "@/components/thread-participant-stack"
import { ThreadSubscribers } from "@/components/thread-subscribers"
import {
  DocumentTypingIndicator,
  TypingIndicator,
} from "@/components/typing-indicator"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { StatePanel } from "@/components/ui/state-panel"
import { Tabs } from "@/components/ui/tabs"
import { UserProfileSheet } from "@/components/user-profile-sheet"
import { CallSummaryPanel } from "@/components/voice/call-summary-card"
import { CallTranscript } from "@/components/voice/call-transcript"
import { useSocket, useSocketConnected } from "@/context/socket-context"
import { useVoiceCall } from "@/context/voice-call-context"
import { useWorkspace } from "@/context/workspace-context"
import {
  pinSessionChoice,
  RunModelLabelContext,
  runModelLabel,
  useModelChoice,
} from "@/hooks/use-agent-models"
import {
  useAgentSession,
  useForkSession,
  useRewindSession,
  useUpdateAgentSession,
} from "@/hooks/use-agent-session"
import {
  useChannelApprovals,
  usePausedLorMessageId,
} from "@/hooks/use-approvals"
import { useAutoMarkRead } from "@/hooks/use-auto-mark-read"
import { useBetaAvailability } from "@/hooks/use-beta"
import { useChannelDetail } from "@/hooks/use-channel-detail"
import { useChannelPermissions } from "@/hooks/use-channel-permissions"
import { useMarkThreadRead } from "@/hooks/use-mark-thread-read"
import { useOpenDM } from "@/hooks/use-open-dm"
import { usePersonalAccounts } from "@/hooks/use-personal-accounts"
import { useProfileSheet } from "@/hooks/use-profile-sheet"
import { useChannelProposals } from "@/hooks/use-proposals"
import { useRunQueue } from "@/hooks/use-run-queue"
import {
  changeTotals,
  useLiveSessionChanges,
  useSessionChanges,
} from "@/hooks/use-session-changes"
import { useSessionStart } from "@/hooks/use-session-start"
import { useStopLorRun } from "@/hooks/use-stop-lor-run"
import { useThreadMessages } from "@/hooks/use-thread-messages"
import { threadSubscribersQueryOptions } from "@/hooks/use-thread-subscribers"
import { useTypingIndicator } from "@/hooks/use-typing-indicator"
import { useWorkspaceMentionCandidates } from "@/hooks/use-workspace-mention-candidates"
import type { AgentSession, Message } from "@/lib/api-types"
import { authClient } from "@/lib/auth-client"
import { confirmRemoveEmbed } from "@/lib/remove-embed"
import { useSessionComposerInbox } from "@/lib/session-composer-inbox"

// A call's chat: Summary (ended calls only), Chat, Transcript.
export type CallTab = "summary" | "chat" | "transcript"

const titleFadeIn = FadeIn.duration(160)
const titleFadeOut = FadeOut.duration(120)

export type ThreadViewProps = {
  // A moment of the call, in ms, for the transcript to open at.
  at?: string
  channelId: string
  composerDraft?: string
  // Inside the call screen's drawer, which has its own header and tabs: only
  // the chat shows.
  embedded?: boolean
  focusMessageId?: string
  tab?: CallTab
  threadRootId: string
  // A Lor session's transcript.
  session?: AgentSession
  // The session's start isn't confirmed yet.
  sessionPending?: boolean
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
  sessionPending = false,
}: ThreadViewProps) {
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [editingMessage, setEditingMessage] = useState<Message | null>(null)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  // The session's heading is on screen, so the bar leaves its title out.
  const [headingVisible, setHeadingVisible] = useState(true)
  const [isActionsOpen, setIsActionsOpen] = useState(false)
  const [isCodeOpen, setIsCodeOpen] = useState(false)
  // Session: the message being forwarded into the channel chat.
  const [forwarding, setForwarding] = useState<Message | null>(null)
  const updateSession = useUpdateAgentSession()
  const fork = useForkSession()
  const rewind = useRewindSession(lorSession?.id ?? "")
  const composerMentionRef = useRef<MessageComposerMentionHandle>(null)
  useSessionComposerInbox(
    threadRootId,
    (text) => composerMentionRef.current?.replaceDraft(text),
    // While editing, the review card's own toast says the composer is busy.
    Boolean(lorSession && !lorSession.archivedAt && !editingMessage)
  )
  const { requestStop, stoppingMessageId } = useStopLorRun()
  const [foreground, muted] = useThemeColor(["foreground", "muted"])
  const socket = useSocket()
  const isSocketConnected = useSocketConnected()
  const { workspace } = useWorkspace()
  const { call } = useVoiceCall()
  const { data: session } = authClient.useSession()
  const { canPinMessages, canDeleteOthersMessages } = useChannelPermissions(
    workspace?.id
  )
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
    deferLoad: sessionPending,
    sessionStart: startsSessions ? sessionStart : undefined,
  })
  // A call's chat: an unset tab means Summary for an ended call, else Chat;
  // Summary shows only once the call has ended. The call drawer is chat only.
  const voiceSessionId = thread.voiceSessionId
  const hasSummary = thread.voiceSessionEnded
  const callTab: CallTab =
    !voiceSessionId || embedded
      ? "chat"
      : tab === "transcript" || tab === "chat"
        ? tab
        : hasSummary
          ? "summary"
          : "chat"
  useAutoMarkRead(channelId)
  const newestReply = thread.messages[0]
  useMarkThreadRead({
    workspaceSlug: workspace?.slug ?? "",
    channelId,
    threadRootId,
    newestKey: newestReply ? `${newestReply.id}:${newestReply.status}` : null,
    enabled: !sessionPending && callTab === "chat",
  })
  // Approval cards in this thread read the channel-approvals cache; the
  // socket handlers live here so a thread opened directly stays live too.
  useChannelApprovals(channelId ?? "", lorSession ? threadRootId : null)
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
  // releases them — the transcript skips them (Codex model). An old call's
  // summary card leaves its chat: the Summary tab shows it.
  const visibleMessages = useMemo(
    () =>
      thread.messages.filter(
        (message) =>
          !queuedIds.includes(message.id) &&
          !(voiceSessionId && message.type === "call_summary")
      ),
    [thread.messages, queuedIds, voiceSessionId]
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
    broadcasts: !lorSession,
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

  // A turn paused on approvals is stoppable too: Stop rejects them all.
  // Scoped to this thread: a channel-wide lookup would let a human thread
  // stop another session's paused turn.
  const pausedLorMessageId = usePausedLorMessageId(
    channelId ?? "",
    threadRootId
  )
  const stoppableLorMessageId = pendingLorMessageId ?? pausedLorMessageId
  const stopPendingLor = useCallback(async () => {
    if (!stoppableLorMessageId) return
    await requestStop(stoppableLorMessageId)
  }, [stoppableLorMessageId, requestStop])

  const channelName = channelState.channel?.name ?? "channel"
  // Who a message "To subscribers" reaches, shown as faces in the composer.
  const subscriberQuery = threadSubscribersQueryOptions({
    workspaceSlug: workspace?.slug ?? "",
    channelId,
    threadRootId,
  })
  const { data: subscribers } = useQuery({
    ...subscriberQuery,
    enabled: subscriberQuery.enabled && Boolean(lorSession),
  })
  const otherSubscribers = useMemo(
    () => subscribers?.filter((person) => person.id !== session?.user.id),
    [subscribers, session?.user.id]
  )
  const memberById = useCallback(
    (userId: string | null) =>
      mentions.members.find((member) => member.userId === userId),
    [mentions.members]
  )
  const nameOf = useCallback(
    (userId: string | null) =>
      userId === session?.user.id
        ? "you"
        : (memberById(userId)?.name ?? "someone"),
    [memberById, session?.user.id]
  )
  const typingPeople = useMemo(
    () =>
      typingUsers.map((user) => {
        const member = memberById(user.userId)
        return {
          ...user,
          image: member?.image ?? null,
          avatarColor: member?.avatarColor ?? null,
        }
      }),
    [typingUsers, memberById]
  )
  // The session's source ("Continue in Code" or a fork), from the session
  // screen's cached detail.
  const { data: sessionDetail } = useAgentSession(lorSession?.id ?? "")
  const sourceSession = sessionDetail?.source ?? null
  // A code session's Changes drawer, kept live while the session is open;
  // the header shows the lines added and removed.
  const codeSession = lorSession?.mode === "code" && !sessionPending
  useLiveSessionChanges(lorSession?.id ?? "", threadRootId, codeSession)
  const { data: changes } = useSessionChanges(lorSession?.id ?? "", codeSession)
  const lineTotals = changeTotals(
    changes?.state === "ready" ? changes.files : []
  )
  // Claude Code and Codex answer only messages from people with their own
  // Claude subscription or ChatGPT plan; the server sends the rest to the
  // session's people. Hosted beta answers only its harnesses, so anything
  // else stays people-only while it is on.
  const { data: betaAvailability } = useBetaAvailability()
  const harnessEnabled =
    !lorSession ||
    (isHarnessEnabled(lorSession.harness) &&
      (betaAvailability?.enabled !== true ||
        isHarnessAllowedInBeta(lorSession.harness)))
  const subscriptionHarness =
    harnessEnabled &&
    (lorSession?.harness === "claude_code" || lorSession?.harness === "codex")
      ? lorSession.harness
      : null
  const { data: accounts } = usePersonalAccounts(subscriptionHarness !== null)
  const subscription =
    subscriptionHarness === "codex" ? accounts?.chatgpt : accounts?.claude
  const withoutSubscription =
    subscriptionHarness !== null &&
    !lorSession?.archivedAt &&
    subscription !== undefined &&
    subscription.account == null
  // The session's agent answers this person's messages, which carry the
  // model, effort and fast mode picked in the composer.
  const agentAnswers =
    Boolean(lorSession) && harnessEnabled && !withoutSubscription
  // The session's newest run seeds its picker on a device that never picked
  // here (LOR-160).
  const lastRun = thread.messages.find(
    (message) => message.authorId === LOR_USER_ID && message.lorRun?.model
  )?.lorRun
  const lastTurnModel = lastRun?.model
  const lastTurnEffort = lastRun?.effort ?? null
  const lastTurnFast = lastRun?.fast ?? false
  const modelScope = useMemo(
    () =>
      threadRootId
        ? {
            sessionScope: threadRootId,
            lastTurn: lastTurnModel
              ? {
                  model: lastTurnModel,
                  effort: lastTurnEffort,
                  fast: lastTurnFast,
                }
              : null,
          }
        : undefined,
    [threadRootId, lastTurnModel, lastTurnEffort, lastTurnFast]
  )
  // The catalog also names each reply's model, so it loads for any session.
  const modelChoice = useModelChoice(lorSession?.harness ?? "pi", {
    workspaceSlug: workspace?.slug,
    enabled: Boolean(lorSession),
    scope: modelScope,
  })
  // A Claude Code turn also carries the mode picked beside the model.
  const claudeCode = lorSession?.harness === "claude_code"
  const claudeCodeMode = useClaudeCodeMode()
  const modelCatalog = modelChoice.catalog
  const modelLabel = useCallback(
    (model: string) => runModelLabel(modelCatalog, model),
    [modelCatalog]
  )
  // Memoized: the list re-renders its rows only when its items change, and
  // the heading is one, so it changes them exactly when its content does.
  const sessionHeading = useMemo(() => {
    if (!lorSession) return undefined
    const starter = memberById(lorSession.creatorId)
    return (
      <SessionHeading
        channelName={channelName}
        createdAt={lorSession.createdAt}
        generatedTitle={lorSession.titleEditedAt === null}
        harness={lorSession.harness === "pi" ? null : lorSession.harness}
        repo={
          lorSession.repoFullName && lorSession.baseBranch
            ? {
                fullName: lorSession.repoFullName,
                branch: lorSession.baseBranch,
                newBranch: lorSession.newBranch,
              }
            : null
        }
        source={
          sourceSession
            ? {
                ...sourceSession,
                forkedAt: lorSession.forkedFromMessageId,
              }
            : null
        }
        startedBy={
          lorSession.origin === "loop"
            ? "Loop"
            : lorSession.origin === "trigger"
              ? "Started by an automation"
              : `Started by ${nameOf(lorSession.creatorId)}`
        }
        starter={
          starter
            ? {
                name: starter.name,
                image: starter.image,
                avatarColor: starter.avatarColor,
              }
            : null
        }
        title={lorSession.title}
      />
    )
  }, [lorSession, sourceSession, channelName, memberById, nameOf])

  useEffect(() => {
    setReplyingTo(null)
    setEditingMessage(null)
    setForwarding(null)
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

  // A session has no visible root to wait for.
  const isReady = Boolean(thread.root || lorSession)
  // Archived sessions are read-only.
  const archivedBar = lorSession?.archivedAt ? (
    <View className="bg-background px-three pb-three pt-two">
      <View className="min-h-11 flex-row items-center gap-two rounded-lor-sm border border-border px-three">
        <HugeiconsIcon
          color={muted}
          icon={Archive02Icon}
          size={16}
          strokeWidth={2}
        />
        <Text className="min-w-0 flex-1 text-sm text-muted" numberOfLines={1}>
          Archived by {nameOf(lorSession.archivedById)}
        </Text>
        <Button
          onPress={() =>
            updateSession.mutate({
              workspaceId: lorSession.workspaceId,
              channelId: lorSession.channelId,
              sessionId: lorSession.id,
              archived: false,
            })
          }
          size="sm"
          variant="ghost"
        >
          Unarchive
        </Button>
      </View>
    </View>
  ) : null
  // A call's chat also holds its summary and transcript.
  const showTranscript = callTab === "transcript"
  const showSummary = callTab === "summary"
  const showCallRecord = showTranscript || showSummary
  const callTabs =
    voiceSessionId && !embedded ? (
      <View className="border-b border-separator px-four py-two">
        <Tabs
          onValueChange={(value) =>
            router.setParams({
              tab:
                value === "transcript" || value === "summary" ? value : "chat",
              at: undefined,
            })
          }
          value={callTab}
        >
          <Tabs.List>
            <Tabs.Indicator />
            {hasSummary ? (
              <Tabs.Trigger value="summary">
                <Tabs.Label>Summary</Tabs.Label>
              </Tabs.Trigger>
            ) : null}
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
      {lorSession ? (
        // The heading carries the title until it scrolls away.
        <View className="min-w-0 flex-1">
          {headingVisible ? null : (
            <Animated.Text
              className="text-[17px] font-bold tracking-[-0.2px] text-foreground"
              entering={titleFadeIn}
              exiting={titleFadeOut}
              numberOfLines={1}
            >
              {lorSession.title}
            </Animated.Text>
          )}
        </View>
      ) : (
        <View className="min-w-0 flex-1 gap-px">
          {/* A call chat takes Lor's name for the call once it's summarized. */}
          <Text
            className="text-[17px] font-bold tracking-[-0.2px] text-foreground"
            numberOfLines={1}
          >
            {voiceSessionId ? (thread.voiceSessionTitle ?? "Call") : "Thread"}
          </Text>
          <Text
            className="text-xs font-medium leading-4 text-muted"
            numberOfLines={1}
          >
            #{channelName}
          </Text>
        </View>
      )}
      {/* Sessions and threads list who follows them; a call's chat lists
          who took part. */}
      {voiceSessionId ? (
        <ThreadParticipantStack
          members={mentions.members}
          onPressMember={openMemberProfile}
          participants={thread.participants}
        />
      ) : (
        // Grouped without the row's gap, so the faces sit by the "…".
        <View className="flex-row items-center">
          {codeSession ? (
            <Pressable
              accessibilityLabel={`Changes${
                lineTotals.additions || lineTotals.deletions
                  ? `, ${lineTotals.additions} lines added, ${lineTotals.deletions} removed`
                  : ""
              }`}
              accessibilityRole="button"
              className="min-h-10 flex-row items-center gap-one rounded-lor-sm px-two active:bg-surface-secondary"
              onPress={() => setIsCodeOpen(true)}
            >
              <HugeiconsIcon
                color={foreground}
                icon={SourceCodeIcon}
                size={18}
                strokeWidth={2}
              />
              {lineTotals.additions || lineTotals.deletions ? (
                <Text className="font-mono text-xs">
                  {lineTotals.additions ? (
                    <Text className="text-success">
                      +{lineTotals.additions}
                    </Text>
                  ) : null}
                  {lineTotals.additions && lineTotals.deletions ? " " : null}
                  {lineTotals.deletions ? (
                    <Text className="text-danger">−{lineTotals.deletions}</Text>
                  ) : null}
                </Text>
              ) : null}
            </Pressable>
          ) : null}
          <ThreadSubscribers
            channelId={channelId}
            channelName={channelName}
            session={lorSession}
            threadRootId={threadRootId}
            workspaceSlug={workspace.slug}
          />
          {lorSession ? (
            <IconButton
              accessibilityLabel="Session actions"
              onPress={() => setIsActionsOpen(true)}
              variant="ghost"
            >
              <SymbolView
                name={{
                  ios: "ellipsis",
                  android: "more_horiz",
                  web: "more_horiz",
                }}
                size={20}
                tintColor={foreground}
              />
            </IconButton>
          ) : null}
        </View>
      )}
    </View>
  )

  return (
    <>
      {header}
      {callTabs}
      <ChatKeyboardLayout
        renderComposer={({ inputNativeID, onCustomInputViewChange }) =>
          archivedBar ??
          (isReady && !thread.isMissing && !thread.error && !showCallRecord ? (
            <MessageComposer
              accessibilityLabel={lorSession ? "Reply" : "Reply in thread"}
              currentUserId={session?.user.id}
              destination={
                lorSession ? "session" : startsSessions ? "thread" : undefined
              }
              initialDraft={composerDraft}
              peopleOnly={!harnessEnabled || withoutSubscription}
              harnessCommands={
                agentAnswers ? lorSession?.harnessCommands : null
              }
              subscribers={otherSubscribers}
              channelId={channelId}
              channelName={channelName}
              editingMessage={editingMessage}
              inputNativeID={inputNativeID}
              isStopping={stoppingMessageId === stoppableLorMessageId}
              isConnected={isSocketConnected}
              isMentionCandidatesLoading={mentions.isLoading}
              // The thread doesn't exist until the start is confirmed.
              isSending={thread.isSending || isSavingEdit || sessionPending}
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
              onSend={async (content, attachments, { toPeople }) => {
                // Lor is mid-answer in this thread, so the reply will
                // queue — show it in the pill immediately instead of waiting
                // for the routed round trip. A failed send drops the nonce
                // again, so a late created echo can't hide the real message.
                // A message for the subscribers only never queues for Lor.
                let nonce: string | undefined
                try {
                  await thread.sendMessage(
                    content,
                    replyingTo ?? undefined,
                    attachments,
                    {
                      onOptimistic:
                        pendingLorMessageId && !toPeople
                          ? (id) => {
                              nonce = id
                              addOptimistic(id)
                            }
                          : undefined,
                      toPeople,
                      turn: agentAnswers
                        ? {
                            ...modelChoice.turn,
                            ...(claudeCode ? { claudeCodeMode } : {}),
                          }
                        : undefined,
                    }
                  )
                  if (agentAnswers && !toPeople) pinSessionChoice(modelChoice)
                } catch (error) {
                  if (nonce) removeOptimistic(nonce)
                  throw error
                }
                setReplyingTo(null)
              }}
              onStop={stoppableLorMessageId ? stopPendingLor : undefined}
              placeholder={lorSession ? "Reply…" : "Reply in thread"}
              replyingTo={replyingTo}
              topAccessory={
                // A session lists its queued turns in the transcript.
                lorSession ? (
                  !harnessEnabled ? (
                    <View className="mb-two rounded-lor-md border border-border bg-surface-secondary px-three py-three">
                      <Text className="text-[13px] leading-[18px] text-muted">
                        This agent is temporarily unavailable. Messages here go
                        to the people in this session. Start a new session with
                        Lor to keep working.
                      </Text>
                    </View>
                  ) : withoutSubscription ? (
                    <ConnectOnWebNotice
                      className="mb-two"
                      workspaceSlug={workspace.slug}
                    >
                      {subscriptionHarness === "codex"
                        ? "Codex answers people on their own ChatGPT plan."
                        : "Claude Code answers people on their own Claude subscription."}{" "}
                      Until you connect yours, your messages here go to the
                      people in the session.
                    </ConnectOnWebNotice>
                  ) : (
                    // What the next turn runs with, in one bar: the picks
                    // scroll sideways when they don't fit, and the context
                    // meter stays in view at the end.
                    <View className="mb-two flex-row items-center gap-two">
                      <ScrollView
                        className="min-w-0 flex-1"
                        contentContainerClassName="items-center gap-two"
                        horizontal
                        keyboardShouldPersistTaps="handled"
                        showsHorizontalScrollIndicator={false}
                      >
                        <ModelPicker choice={modelChoice} />
                        {claudeCode ? <ClaudeCodeModePicker /> : null}
                      </ScrollView>
                      <ContextMeter
                        isRunning={Boolean(stoppableLorMessageId)}
                        scopeKey={threadRootId}
                      />
                    </View>
                  )
                ) : (
                  <RunQueuePill
                    currentUserId={session?.user.id}
                    messages={queuedMessages}
                  />
                )
              }
            />
          ) : null)
        }
        renderMessageList={(keyboardProps) =>
          showSummary && voiceSessionId ? (
            <CallSummaryPanel sessionId={voiceSessionId} />
          ) : showTranscript && voiceSessionId ? (
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
            <RunModelLabelContext.Provider
              value={lorSession ? modelLabel : null}
            >
              <ThreadMessageList
                avatarColorByUserId={avatarColorByUserId}
                heading={sessionHeading}
                onHeadingVisibleChange={setHeadingVisible}
                resolveUserName={(userId) => memberById(userId)?.name}
                layout={lorSession ? "document" : "chat"}
                footer={
                  lorSession ? (
                    <RunQueuePill
                      currentUserId={session?.user.id}
                      messages={queuedMessages}
                      variant="document"
                    />
                  ) : undefined
                }
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
                onEdit={archivedBar ? undefined : startEditing}
                onPressAuthor={openAuthorProfile}
                onReply={archivedBar ? undefined : startReply}
                onForward={lorSession ? setForwarding : undefined}
                onFork={
                  lorSession
                    ? (message) =>
                        fork.mutate({
                          sessionId: lorSession.id,
                          messageId: message.id,
                        })
                    : undefined
                }
                forkingMessageId={
                  fork.isPending ? fork.variables.messageId : null
                }
                onRewind={
                  lorSession && !lorSession.archivedAt
                    ? (message) => rewind.mutate(message.id)
                    : undefined
                }
                rewindRestoresFiles={lorSession?.mode === "code"}
                pausedLorMessageId={pausedLorMessageId}
                onToggleReaction={thread.toggleReaction}
                onTogglePin={
                  canPinMessages
                    ? (message) => {
                        void thread.togglePin(message.id, message.pinned)
                      }
                    : undefined
                }
                onRemoveEmbed={
                  archivedBar
                    ? undefined
                    : (message, url) =>
                        confirmRemoveEmbed({
                          workspaceSlug: workspace.slug,
                          channelId: message.channelId,
                          messageId: message.id,
                          url,
                        })
                }
                canRemoveOthersEmbeds={canDeleteOthersMessages}
                paginationError={thread.paginationError}
                root={thread.root}
                replyingToId={replyingTo?.id}
                totalReplyCount={thread.totalReplyCount}
              />
            </RunModelLabelContext.Provider>
          )
        }
        typingIndicator={
          !isReady ||
          thread.isMissing ||
          thread.error ||
          showCallRecord ? null : lorSession ? (
            <DocumentTypingIndicator people={typingPeople} />
          ) : (
            <TypingIndicator users={typingUsers} />
          )
        }
      />
      {lorSession ? (
        <SessionSheet
          isOpen={isActionsOpen}
          lorRunning={Boolean(pendingLorMessage)}
          messages={thread.messages}
          onOpenChange={setIsActionsOpen}
          session={lorSession}
        />
      ) : null}
      {codeSession && lorSession ? (
        <SessionCodeDrawer
          isOpen={isCodeOpen}
          onOpenChange={setIsCodeOpen}
          sessionId={lorSession.id}
          workspaceSlug={workspace.slug}
        />
      ) : null}
      {lorSession ? (
        <ForwardSheet
          channel={{ id: channelId, name: channelName }}
          message={forwarding}
          onClose={() => setForwarding(null)}
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
    </>
  )
}
