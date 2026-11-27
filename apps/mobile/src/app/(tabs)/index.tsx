import { useQuery, useQueryClient } from "@tanstack/react-query"
import * as Haptics from "expo-haptics"
import { router, useFocusEffect } from "expo-router"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Alert, RefreshControl, View } from "react-native"
import Animated, {
  useAnimatedRef,
  useAnimatedScrollHandler,
  useSharedValue,
} from "react-native-reanimated"
import { ChatActionsSheet } from "@/components/chat-actions-sheet"
import {
  ChatFilterSheet,
  ChatList,
  ChatListSkeleton,
  openNeed,
} from "@/components/chat-list"
import { ConnectionPill } from "@/components/connection-pill"
import { CreateInviteSheet } from "@/components/create-invite-sheet"
import { FinishSetupCard } from "@/components/finish-setup-card"
import { HomeHeader } from "@/components/home-header"
import { HowLorWorksSheet } from "@/components/how-lor-works-sheet"
import { Screen } from "@/components/ui/screen"
import { Skeleton } from "@/components/ui/skeleton"
import { StatePanel } from "@/components/ui/state-panel"
import {
  type ChatSearchItem,
  WorkspaceSearchResults,
} from "@/components/workspace-search-results"
import { WorkspaceSheet } from "@/components/workspace-sheet"
import { useWorkspace } from "@/context/workspace-context"
import { useActiveMember } from "@/hooks/use-active-member"
import { useAuthorProfileSheet } from "@/hooks/use-author-profile-sheet"
import { useChannelPermissions } from "@/hooks/use-channel-permissions"
import {
  type Chat,
  chatsKey,
  orderChats,
  useArchivedChats,
  useChatArchive,
  useChatFilter,
  useChatListUpdates,
  useChats,
  usePlaceChats,
  useUpdateChat,
} from "@/hooks/use-chats"
import { useMessageSearch } from "@/hooks/use-message-search"
import { usePrefetchChannels } from "@/hooks/use-prefetch-channels"
import { useTheme } from "@/hooks/use-theme"
import { workspaceActivityKey } from "@/hooks/use-workspace-activity"
import type { ChannelSearchResult } from "@/lib/api-types"
import { authClient } from "@/lib/auth-client"
import { fetchMessageLocation, openMessageAt } from "@/lib/message-location"
import { SWAP_ENTER, SWAP_EXIT } from "@/lib/motion"
import {
  openTextChannels,
  workspaceChannelsQueryOptions,
} from "@/lib/workspace-channels"

export default function WorkspaceScreen() {
  const theme = useTheme()
  const {
    workspace,
    workspaces,
    isLoading: workspaceLoading,
    error: workspaceError,
    selectWorkspace,
  } = useWorkspace()
  const [query, setQuery] = useState("")
  // The list's offset stays on the UI thread: the header's hairline follows
  // it without a render per scroll frame.
  const scrollY = useSharedValue(0)
  const scrollRef = useAnimatedRef<Animated.ScrollView>()
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.set(event.contentOffset.y)
  })
  const [isPullRefreshing, setIsPullRefreshing] = useState(false)
  const [isInviteOpen, setIsInviteOpen] = useState(false)
  const [isWorkspaceSheetOpen, setIsWorkspaceSheetOpen] = useState(false)
  const [isHowLorWorksOpen, setIsHowLorWorksOpen] = useState(false)
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [actionChat, setActionChat] = useState<Chat | null>(null)
  const hasFocusedRef = useRef(false)
  const nextSheetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const permissions = useChannelPermissions(workspace?.id)
  const activeMember = useActiveMember(workspace?.id)
  const { data: session } = authClient.useSession()
  const me = session?.user.id
  const isWorkspaceOwner = Boolean(me && workspace?.ownerId === me)
  const canManageWorkspace =
    isWorkspaceOwner || activeMember.data?.role === "admin"
  const { openAuthorProfile, profileSheet } = useAuthorProfileSheet(
    workspace?.slug ?? ""
  )

  useEffect(
    () => () => {
      if (nextSheetTimeoutRef.current) clearTimeout(nextSheetTimeoutRef.current)
    },
    []
  )

  const workspaceSlug = workspace?.slug ?? ""
  const chatsQuery = useChats(workspaceSlug)
  const [filter, setFilter] = useChatFilter(workspaceSlug)
  const archivedQuery = useArchivedChats(workspaceSlug, filter.archived)
  const placesQuery = usePlaceChats(workspaceSlug, filter.places)
  useChatListUpdates(workspaceSlug, workspace?.id)
  const updateChat = useUpdateChat(workspaceSlug)
  const { unarchive } = useChatArchive(workspaceSlug)
  // Every chat the person can see, joined or not: what search finds, and
  // what is loaded ahead so a chat opens at once.
  const channelsQuery = useQuery(workspaceChannelsQueryOptions(workspaceSlug))
  usePrefetchChannels(workspaceSlug, channelsQuery.data)
  const chatError = chatsQuery.error?.message ?? null

  const chats = useMemo(() => {
    if (!chatsQuery.data) return undefined
    const { pinned, recent } = orderChats([
      ...chatsQuery.data,
      ...(filter.archived ? (archivedQuery.data ?? []) : []),
      ...(filter.places ? (placesQuery.data ?? []) : []),
    ])
    return [...pinned, ...recent]
  }, [chatsQuery.data, archivedQuery.data, placesQuery.data, filter])

  // A chat made, deleted or archived elsewhere changes the channels: the
  // list follows.
  const queryClient = useQueryClient()
  const channelIds = useMemo(
    () =>
      channelsQuery.data
        ? openTextChannels(channelsQuery.data)
            .map((channel) => channel.id)
            .sort()
            .join(",")
        : "",
    [channelsQuery.data]
  )
  useEffect(() => {
    if (!workspaceSlug || !channelIds) return
    void queryClient.invalidateQueries({ queryKey: chatsKey(workspaceSlug) })
  }, [channelIds, workspaceSlug, queryClient])

  const workspaceId = workspace?.id
  const { refetch: refetchChats } = chatsQuery
  const { refetch: refetchChannels } = channelsQuery
  const pullToRefresh = async () => {
    setIsPullRefreshing(true)
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: chatsKey(workspaceSlug) }),
        refetchChannels(),
        // The session rows under each chat come over the socket.
        workspaceId
          ? queryClient.invalidateQueries({
              queryKey: workspaceActivityKey(workspaceId),
            })
          : undefined,
      ])
    } finally {
      setIsPullRefreshing(false)
    }
  }

  useEffect(() => {
    setQuery("")
    setIsInviteOpen(false)
    setIsWorkspaceSheetOpen(false)
    setActionChat(null)
  }, [workspace?.id])

  useFocusEffect(
    useCallback(() => {
      if (hasFocusedRef.current) void refetchChats()
      else hasFocusedRef.current = true
    }, [refetchChats])
  )

  const searchActive = query.trim().length > 0
  useEffect(() => {
    if (searchActive) scrollRef.current?.scrollTo({ y: 0, animated: false })
  }, [searchActive, scrollRef])
  const search = useMessageSearch({ query, workspaceSlug })
  const matchingChats = useMemo(
    () => findMatchingChats(chatsQuery.data, channelsQuery.data, query),
    [chatsQuery.data, channelsQuery.data, query]
  )

  if (workspaceLoading) return <LoadingScreen />
  if (workspaceError) {
    return (
      <StatePanel
        className="flex-1"
        detail={workspaceError}
        title="Your workspace is unavailable"
      />
    )
  }
  if (!workspace) {
    return (
      <StatePanel
        action={{
          label: "Create or join a workspace",
          onPress: () => router.push("/onboarding"),
        }}
        className="flex-1"
        detail="Create a new workspace or join one with an invite link."
        title="No workspace yet"
      />
    )
  }

  const openChat = (chat: { id: string }) =>
    router.push({
      pathname: "/channel/[channelId]",
      params: { channelId: chat.id },
    } as never)

  const openDetails = (chat: { id: string }) =>
    router.push({
      pathname: "/channel/[channelId]/details",
      params: { channelId: chat.id },
    } as never)

  const pin = (chat: Chat) =>
    updateChat.mutate({ channelId: chat.id, pinned: !chat.pinnedAt })
  const hide = (chat: Chat) =>
    updateChat.mutate({ channelId: chat.id, hidden: true })

  const afterWorkspaceSheet = (open: () => void) => {
    setIsWorkspaceSheetOpen(false)
    if (nextSheetTimeoutRef.current) clearTimeout(nextSheetTimeoutRef.current)
    // Let the workspace sheet finish closing before the next sheet opens.
    nextSheetTimeoutRef.current = setTimeout(open, 300)
  }

  const switchWorkspace = (nextWorkspaceId: string) => {
    setIsWorkspaceSheetOpen(false)
    void Haptics.selectionAsync()
    void selectWorkspace(nextWorkspaceId)
  }

  const goFromWorkspaceSheet = (path: string) => {
    setIsWorkspaceSheetOpen(false)
    router.push(path as never)
  }

  const openSearchMessage = async (message: ChannelSearchResult) => {
    const location = await fetchMessageLocation(workspace.slug, message.id)
    if (!location) {
      Alert.alert(
        "Message unavailable",
        "This message may have been deleted. Try searching again."
      )
      return
    }
    openMessageAt(location, message.id)
  }

  return (
    <Screen className="bg-background" edges={["top", "bottom"]}>
      <HomeHeader
        onNewChat={
          permissions.canCreateChannel
            ? () => router.push("/chat/new" as never)
            : undefined
        }
        onNewSession={() => router.push("/session/new")}
        onOpenWorkspace={() => setIsWorkspaceSheetOpen(true)}
        onQueryChange={setQuery}
        query={query}
        scrollY={scrollY}
        workspace={workspace}
      />

      <View className="flex-1">
        <Animated.ScrollView
          className="flex-1"
          contentContainerClassName="pb-seven pt-one"
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          onScroll={onScroll}
          ref={scrollRef}
          refreshControl={
            <RefreshControl
              onRefresh={() => void pullToRefresh()}
              refreshing={isPullRefreshing}
              tintColor={theme.accent}
            />
          }
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          style={{ flex: 1 }}
        >
          {searchActive ? (
            <Animated.View
              className="px-two"
              entering={SWAP_ENTER}
              exiting={SWAP_EXIT}
              key="search"
            >
              <WorkspaceSearchResults
                chats={matchingChats}
                onPressChat={openChat}
                onPressMessage={(message) => void openSearchMessage(message)}
                onPressMessageAuthor={openAuthorProfile}
                query={query.trim()}
                search={search}
                workspaceSlug={workspace.slug}
              />
            </Animated.View>
          ) : chatError && !chatsQuery.data ? (
            <StatePanel
              action={{
                label: "Try again",
                onPress: () => void refetchChats(),
              }}
              className="px-two"
              detail={chatError}
              title="Chats are unavailable"
            />
          ) : (
            <Animated.View entering={SWAP_ENTER} exiting={SWAP_EXIT} key="list">
              {canManageWorkspace && workspace.setupPending ? (
                <View className="px-two">
                  <FinishSetupCard
                    workspaceId={workspace.id}
                    workspaceSlug={workspace.slug}
                  />
                </View>
              ) : null}
              <ChatList
                chats={chats}
                filter={filter}
                isLoading={chatsQuery.isPending}
                // A workspace's list and first reveal are its own.
                key={workspace.id}
                onHide={hide}
                onLongPressChat={setActionChat}
                onOpenChat={openChat}
                onOpenFilter={() => setIsFilterOpen(true)}
                onOpenNeed={openNeed}
                onOpenSessions={() => router.push("/sessions")}
                onPin={pin}
                workspaceId={workspace.id}
                workspaceSlug={workspace.slug}
              />
            </Animated.View>
          )}
        </Animated.ScrollView>
        <ConnectionPill />
      </View>
      <ChatActionsSheet
        canManage={permissions.canUpdateChannel}
        chat={actionChat}
        me={me}
        onHide={hide}
        onOpenChange={(isOpen) => {
          if (!isOpen) setActionChat(null)
        }}
        onOpenDetails={openDetails}
        onPin={pin}
        onUnarchive={(chat) => unarchive.mutate({ channelId: chat.id })}
        workspaceSlug={workspace.slug}
      />
      <ChatFilterSheet
        filter={filter}
        isOpen={isFilterOpen}
        onChange={setFilter}
        onOpenChange={setIsFilterOpen}
      />
      <WorkspaceSheet
        canManageWorkspace={canManageWorkspace}
        channelCount={chatsQuery.data?.length ?? null}
        isOpen={isWorkspaceSheetOpen}
        onAddWorkspace={() => goFromWorkspaceSheet("/onboarding")}
        onInvite={() => afterWorkspaceSheet(() => setIsInviteOpen(true))}
        onOpenAgentProfiles={() =>
          goFromWorkspaceSheet("/settings/agent-profiles")
        }
        onOpenChange={setIsWorkspaceSheetOpen}
        onOpenHowLorWorks={() =>
          afterWorkspaceSheet(() => setIsHowLorWorksOpen(true))
        }
        onOpenInstructions={() =>
          goFromWorkspaceSheet("/settings/instructions")
        }
        onOpenSettings={() => goFromWorkspaceSheet("/settings/workspace")}
        onSelectWorkspace={switchWorkspace}
        workspace={workspace}
        workspaces={workspaces}
      />
      <CreateInviteSheet
        isOpen={isInviteOpen}
        onOpenChange={setIsInviteOpen}
        workspaceId={workspace.id}
        workspaceName={workspace.name}
        workspaceSlug={workspace.slug}
      />
      <HowLorWorksSheet
        onClose={() => setIsHowLorWorksOpen(false)}
        reopened={isHowLorWorksOpen}
      />
      {profileSheet}
    </Screen>
  )
}

// Your chats whose name matches, then the chats you can see but aren't in,
// which you join from the chat.
function findMatchingChats(
  chats: Chat[] | undefined,
  channels: Parameters<typeof openTextChannels>[0] | undefined,
  query: string
): ChatSearchItem[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return []
  const matches = (name: string | null) =>
    Boolean(name?.toLocaleLowerCase().includes(needle))
  const mine = (chats ?? []).filter((chat) => matches(chat.name))
  const listed = new Set((chats ?? []).map((chat) => chat.id))
  const findable = channels
    ? openTextChannels(channels)
        .filter((channel) => !listed.has(channel.id) && matches(channel.name))
        .map((channel) => ({
          id: channel.id,
          name: channel.name,
          agentIds: channel.agentIds,
          people: [],
          joined: false,
        }))
    : []
  return [...mine, ...findable]
}

// The header's shape while the workspace loads, then the chat rows'
// skeleton, so nothing moves when the real screen takes over.
function LoadingScreen() {
  return (
    <Screen className="bg-background" edges={["top", "bottom"]}>
      <View className="px-four pb-three pt-one">
        <View className="min-h-11 flex-row items-center gap-three">
          <Skeleton className="size-9 rounded-[10px]" />
          <Skeleton className="h-4 w-28 rounded-full" />
        </View>
        <Skeleton className="mt-two h-10 rounded-[12px]" />
      </View>
      <ChatListSkeleton />
    </Screen>
  )
}
