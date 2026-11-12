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
import { ChannelActionsSheet } from "@/components/channel-actions-sheet"
import { ChannelList, ChannelListSkeleton } from "@/components/channel-list"
import { ConnectionPill } from "@/components/connection-pill"
import { CreateChannelSheet } from "@/components/create-channel-sheet"
import { CreateInviteSheet } from "@/components/create-invite-sheet"
import { FinishSetupCard } from "@/components/finish-setup-card"
import { HomeHeader } from "@/components/home-header"
import { HowLorWorksSheet } from "@/components/how-lor-works-sheet"
import { Screen } from "@/components/ui/screen"
import { Skeleton } from "@/components/ui/skeleton"
import { StatePanel } from "@/components/ui/state-panel"
import { WorkspaceSearchResults } from "@/components/workspace-search-results"
import { WorkspaceSheet } from "@/components/workspace-sheet"
import { useWorkspace } from "@/context/workspace-context"
import { useActiveMember } from "@/hooks/use-active-member"
import { useAuthorProfileSheet } from "@/hooks/use-author-profile-sheet"
import { useChannelPermissions } from "@/hooks/use-channel-permissions"
import { useMessageSearch } from "@/hooks/use-message-search"
import { usePrefetchChannels } from "@/hooks/use-prefetch-channels"
import { useProjectUpdates } from "@/hooks/use-project-updates"
import { useTheme } from "@/hooks/use-theme"
import { workspaceActivityKey } from "@/hooks/use-workspace-activity"
import { api } from "@/lib/api"
import type {
  Channel,
  ChannelList as ChannelListData,
  ChannelSearchResult,
} from "@/lib/api-types"
import { authClient } from "@/lib/auth-client"
import { fetchMessageLocation, openMessageAt } from "@/lib/message-location"
import { SWAP_ENTER, SWAP_EXIT } from "@/lib/motion"
import { workspaceChannelsQueryOptions } from "@/lib/workspace-channels"

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
  const [isCreateChannelOpen, setIsCreateChannelOpen] = useState(false)
  const [isInviteOpen, setIsInviteOpen] = useState(false)
  const [isWorkspaceSheetOpen, setIsWorkspaceSheetOpen] = useState(false)
  const [isHowLorWorksOpen, setIsHowLorWorksOpen] = useState(false)
  const [actionChannel, setActionChannel] = useState<Channel | null>(null)
  const hasFocusedChannelsRef = useRef(false)
  const nextSheetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const permissions = useChannelPermissions(workspace?.id)
  const activeMember = useActiveMember(workspace?.id)
  const { data: session } = authClient.useSession()
  const isWorkspaceOwner = Boolean(
    session?.user.id && workspace?.ownerId === session.user.id
  )
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
  const channelsQuery = useQuery(workspaceChannelsQueryOptions(workspaceSlug))
  const { refetch: refetchChannels } = channelsQuery
  const channels = channelsQuery.data ?? null
  usePrefetchChannels(workspaceSlug, channelsQuery.data)
  const isLoadingChannels = Boolean(workspaceSlug) && channelsQuery.isPending
  const channelError = channelsQuery.error?.message ?? null

  // Which categories are projects — drives the folder/dashed-border sidebar
  // treatment in ChannelList.
  const projectsQuery = useQuery({
    queryKey: ["projects", workspaceSlug],
    enabled: Boolean(workspaceSlug),
    queryFn: async () => {
      const response = await api.v1.workspaces[":workspaceSlug"].projects.$get({
        param: { workspaceSlug },
      })
      if (!response.ok) throw new Error("Could not load projects")
      return response.json()
    },
  })
  const projectCategoryIds = useMemo(
    () =>
      new Set(
        projectsQuery.data?.projects.map(
          (project) => project.categoryChannelId
        ) ?? []
      ),
    [projectsQuery.data]
  )
  const archivingCategoryIds = useMemo(
    () =>
      new Set(
        projectsQuery.data?.projects
          .filter((project) => project.status === "archiving")
          .map((project) => project.categoryChannelId) ?? []
      ),
    [projectsQuery.data]
  )
  const archivedCategoryIds = useMemo(
    () =>
      new Set(
        projectsQuery.data?.projects
          .filter((project) => project.status === "archived")
          .map((project) => project.categoryChannelId) ?? []
      ),
    [projectsQuery.data]
  )
  const { refetch: refetchProjects } = projectsQuery
  // Live refetch on project archive start/finish (spinner → Archived section).
  useProjectUpdates(workspaceSlug)

  const queryClient = useQueryClient()
  const workspaceId = workspace?.id
  const pullToRefresh = async () => {
    setIsPullRefreshing(true)
    try {
      await Promise.all([
        refetchChannels(),
        refetchProjects(),
        // The session rows under each channel come over the socket.
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
    setIsCreateChannelOpen(false)
    setIsInviteOpen(false)
    setIsWorkspaceSheetOpen(false)
  }, [workspace?.id])

  useFocusEffect(
    useCallback(() => {
      if (hasFocusedChannelsRef.current) void refetchChannels()
      else hasFocusedChannelsRef.current = true
    }, [refetchChannels])
  )

  const channelCount = useMemo(() => countChannels(channels), [channels])
  const searchActive = query.trim().length > 0
  // Results start at the top, wherever the channel list was scrolled to.
  useEffect(() => {
    if (searchActive) scrollRef.current?.scrollTo({ y: 0, animated: false })
  }, [searchActive, scrollRef])
  const search = useMessageSearch({
    query,
    workspaceSlug: workspace?.slug ?? "",
  })
  const matchingChannels = useMemo(
    () => findMatchingChannels(channels, query),
    [channels, query]
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

  const openChannel = (channel: Channel) =>
    router.push({
      pathname: "/channel/[channelId]",
      params: { channelId: channel.id },
    } as never)

  const openCreatedChannel = (channel: Channel) => {
    void refetchChannels()
    openChannel(channel)
  }

  const openInviteFromWorkspaceSheet = () => {
    setIsWorkspaceSheetOpen(false)
    if (nextSheetTimeoutRef.current) clearTimeout(nextSheetTimeoutRef.current)
    // Let the workspace sheet finish closing before the invite sheet opens.
    nextSheetTimeoutRef.current = setTimeout(() => setIsInviteOpen(true), 300)
  }

  const openHowLorWorks = () => {
    setIsWorkspaceSheetOpen(false)
    if (nextSheetTimeoutRef.current) clearTimeout(nextSheetTimeoutRef.current)
    nextSheetTimeoutRef.current = setTimeout(
      () => setIsHowLorWorksOpen(true),
      300
    )
  }

  const switchWorkspace = (workspaceId: string) => {
    setIsWorkspaceSheetOpen(false)
    void Haptics.selectionAsync()
    void selectWorkspace(workspaceId)
  }

  const addWorkspace = () => {
    setIsWorkspaceSheetOpen(false)
    router.push("/onboarding")
  }

  const openWorkspaceSettings = () => {
    setIsWorkspaceSheetOpen(false)
    router.push("/settings/workspace" as never)
  }

  const openAgentProfiles = () => {
    setIsWorkspaceSheetOpen(false)
    router.push("/settings/agent-profiles" as never)
  }

  const openInstructions = () => {
    setIsWorkspaceSheetOpen(false)
    router.push("/settings/instructions" as never)
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
        onCreateChannel={
          permissions.canCreateChannel
            ? () => setIsCreateChannelOpen(true)
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
          contentContainerClassName="px-two pb-seven pt-two"
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
              entering={SWAP_ENTER}
              exiting={SWAP_EXIT}
              key="search"
            >
              <WorkspaceSearchResults
                channels={matchingChannels}
                onPressChannel={openChannel}
                onPressMessage={(message) => void openSearchMessage(message)}
                onPressMessageAuthor={openAuthorProfile}
                query={query.trim()}
                search={search}
              />
            </Animated.View>
          ) : channelError ? (
            <StatePanel
              action={{
                label: "Try again",
                onPress: () => void refetchChannels(),
              }}
              className="px-two"
              detail={channelError}
              title="Channels are unavailable"
            />
          ) : (
            <Animated.View entering={SWAP_ENTER} exiting={SWAP_EXIT} key="list">
              {canManageWorkspace && workspace.setupPending ? (
                <FinishSetupCard
                  workspaceId={workspace.id}
                  workspaceSlug={workspace.slug}
                />
              ) : null}
              <ChannelList
                archivedCategoryIds={archivedCategoryIds}
                archivingCategoryIds={archivingCategoryIds}
                data={channels ?? undefined}
                isLoading={isLoadingChannels}
                // A workspace's folds and first reveal are its own.
                key={workspace.id}
                onLongPress={setActionChannel}
                onOpenSessions={() => router.push("/sessions")}
                onPress={openChannel}
                projectCategoryIds={projectCategoryIds}
              />
            </Animated.View>
          )}
        </Animated.ScrollView>
        <ConnectionPill />
      </View>
      <ChannelActionsSheet
        channel={actionChannel}
        onOpenChange={(isOpen) => {
          if (!isOpen) setActionChannel(null)
        }}
        workspaceName={workspace.name}
      />
      <CreateChannelSheet
        categories={channels?.categories ?? []}
        isOpen={isCreateChannelOpen}
        onCreated={openCreatedChannel}
        onOpenChange={setIsCreateChannelOpen}
        workspaceName={workspace.name}
        workspaceSlug={workspace.slug}
      />
      <WorkspaceSheet
        canManageWorkspace={canManageWorkspace}
        channelCount={channelCount}
        isOpen={isWorkspaceSheetOpen}
        onAddWorkspace={addWorkspace}
        onInvite={openInviteFromWorkspaceSheet}
        onOpenAgentProfiles={openAgentProfiles}
        onOpenChange={setIsWorkspaceSheetOpen}
        onOpenHowLorWorks={openHowLorWorks}
        onOpenInstructions={openInstructions}
        onOpenSettings={openWorkspaceSettings}
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

function countChannels(data: ChannelListData | null) {
  if (!data) return null
  return (
    data.uncategorized.length +
    data.categories.reduce(
      (total, category) => total + category.channels.length,
      0
    )
  )
}

function findMatchingChannels(
  data: ChannelListData | null,
  query: string
): Channel[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!(data && normalizedQuery)) return []

  return [
    ...data.uncategorized,
    ...data.categories.flatMap((category) => category.channels),
  ].filter(
    (channel) =>
      channel.name?.toLocaleLowerCase().includes(normalizedQuery) ||
      channel.topic?.toLocaleLowerCase().includes(normalizedQuery)
  )
}

// The header's shape while the workspace loads, then the channel rows'
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
      <View className="px-two pt-two">
        <ChannelListSkeleton />
      </View>
    </Screen>
  )
}
