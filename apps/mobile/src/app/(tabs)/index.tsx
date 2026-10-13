import PencilEdit02Icon from "@hugeicons/core-free-icons/PencilEdit02Icon"
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useQuery } from "@tanstack/react-query"
import * as Haptics from "expo-haptics"
import { router, useFocusEffect } from "expo-router"
import { SymbolView } from "expo-symbols"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native"
import { ChannelActionsSheet } from "@/components/channel-actions-sheet"
import { ChannelList } from "@/components/channel-list"
import { CreateChannelSheet } from "@/components/create-channel-sheet"
import { CreateInviteSheet } from "@/components/create-invite-sheet"
import { FinishSetupCard } from "@/components/finish-setup-card"
import { HowLorWorksSheet } from "@/components/how-lor-works-sheet"
import { Avatar } from "@/components/ui/avatar"
import { IconButton } from "@/components/ui/icon-button"
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
import { useProjectUpdates } from "@/hooks/use-project-updates"
import { useTheme } from "@/hooks/use-theme"
import { api } from "@/lib/api"
import type {
  Channel,
  ChannelList as ChannelListData,
  ChannelSearchResult,
} from "@/lib/api-types"
import { authClient } from "@/lib/auth-client"
import { fetchMessageLocation, openMessageAt } from "@/lib/message-location"
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

  const pullToRefresh = async () => {
    setIsPullRefreshing(true)
    try {
      await Promise.all([refetchChannels(), refetchProjects()])
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
      <View className="border-b border-separator bg-lor-sidebar dark:bg-lor-sidebar-dark pb-three pt-two">
        <View className="min-h-12 flex-row items-center gap-three px-four">
          <Pressable
            accessibilityHint="Opens workspace options"
            accessibilityLabel={`${workspace.name} workspace options`}
            accessibilityRole="button"
            className="min-w-0 flex-1 flex-row items-center gap-three active:opacity-70"
            onPress={() => setIsWorkspaceSheetOpen(true)}
          >
            <Avatar
              image={workspace.logo}
              name={workspace.name}
              shape="square"
              size="md"
            />
            <View className="min-w-0 shrink flex-row items-center gap-one">
              <Text
                className="shrink text-[21px] font-bold tracking-[-0.4px] text-foreground"
                numberOfLines={1}
              >
                {workspace.name}
              </Text>
              <SymbolView
                name={{
                  ios: "chevron.down",
                  android: "expand_more",
                  web: "expand_more",
                }}
                size={13}
                tintColor={theme.textTertiary}
              />
            </View>
          </Pressable>
          {permissions.canCreateChannel ? (
            <IconButton
              accessibilityLabel="Create channel"
              onPress={() => setIsCreateChannelOpen(true)}
              variant="ghost"
            >
              <HugeiconsIcon color={theme.text} icon={PlusSignIcon} size={20} />
            </IconButton>
          ) : null}
          <IconButton
            accessibilityLabel="New session"
            onPress={() => router.push("/session/new")}
            variant="ghost"
          >
            <HugeiconsIcon
              color={theme.text}
              icon={PencilEdit02Icon}
              size={20}
            />
          </IconButton>
        </View>

        <View className="mt-two px-four">
          <View className="min-h-10 flex-row items-center gap-two rounded-full bg-surface-secondary px-three">
            <SymbolView
              name={{
                ios: "magnifyingglass",
                android: "search",
                web: "search",
              }}
              size={16}
              tintColor={theme.textTertiary}
            />
            <TextInput
              accessibilityLabel="Search channels and messages"
              autoCapitalize="none"
              autoCorrect={false}
              className="min-w-0 flex-1 py-two text-[15px] text-foreground"
              onChangeText={setQuery}
              placeholder="Search all channels"
              placeholderTextColor={theme.textTertiary}
              returnKeyType="search"
              value={query}
            />
            {query.length > 0 ? (
              <Pressable
                accessibilityLabel="Clear search"
                accessibilityRole="button"
                className="size-7 items-center justify-center rounded-full active:bg-surface-tertiary"
                hitSlop={6}
                onPress={() => setQuery("")}
              >
                <SymbolView
                  name={{
                    ios: "xmark.circle.fill",
                    android: "cancel",
                    web: "cancel",
                  }}
                  size={17}
                  tintColor={theme.textTertiary}
                />
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="px-four pb-seven pt-four"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            onRefresh={() => void pullToRefresh()}
            refreshing={isPullRefreshing}
            tintColor={theme.accent}
          />
        }
        showsVerticalScrollIndicator={false}
        style={{ flex: 1 }}
      >
        {searchActive ? (
          <WorkspaceSearchResults
            channels={matchingChannels}
            onPressChannel={openChannel}
            onPressMessage={(message) => void openSearchMessage(message)}
            onPressMessageAuthor={openAuthorProfile}
            query={query.trim()}
            search={search}
          />
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
          <>
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
              onLongPress={setActionChannel}
              onPress={openChannel}
              projectCategoryIds={projectCategoryIds}
            />
          </>
        )}
      </ScrollView>
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

function LoadingScreen() {
  return (
    <Screen className="bg-background" edges={["top", "bottom"]}>
      <View className="border-b border-separator bg-lor-sidebar dark:bg-lor-sidebar-dark px-four pb-three pt-two">
        <View className="min-h-12 flex-row items-center gap-three">
          <Skeleton className="size-10 rounded-lor-sm" />
          <View className="flex-1 gap-two">
            <Skeleton className="h-4 w-36 rounded-full" />
            <Skeleton className="h-2.5 w-20 rounded-full" />
          </View>
        </View>
        <Skeleton className="mt-two h-10 rounded-full" />
      </View>
      <View className="gap-five px-four pt-four">
        {[0, 1].map((section) => (
          <View className="gap-one" key={section}>
            <View className="min-h-8 flex-row items-center gap-two px-two">
              <Skeleton className="size-3 rounded-sm" />
              <Skeleton className="h-2.5 w-20 rounded-full" />
            </View>
            {[0, 1, 2].map((row) => (
              <View
                className="min-h-[42px] flex-row items-center gap-two px-two"
                key={row}
              >
                <Skeleton className="size-5 rounded-md" />
                <Skeleton className="h-3 w-[48%] rounded-full" />
              </View>
            ))}
          </View>
        ))}
      </View>
    </Screen>
  )
}
