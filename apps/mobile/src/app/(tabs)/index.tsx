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
import { ChannelList } from "@/components/channel-list"
import { Avatar } from "@/components/ui/avatar"
import { Screen } from "@/components/ui/screen"
import { Skeleton } from "@/components/ui/skeleton"
import { StatePanel } from "@/components/ui/state-panel"
import { WorkspaceSearchResults } from "@/components/workspace-search-results"
import { useWorkspace } from "@/context/workspace-context"
import { useMessageSearch } from "@/hooks/use-message-search"
import { useTheme } from "@/hooks/use-theme"
import { api } from "@/lib/api"
import type {
  Channel,
  ChannelList as ChannelListData,
  ChannelSearchResult,
} from "@/lib/api-types"

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
  const hasFocusedChannelsRef = useRef(false)

  const workspaceSlug = workspace?.slug ?? ""
  const channelsQuery = useQuery({
    queryKey: ["channels", workspaceSlug],
    enabled: Boolean(workspaceSlug),
    queryFn: async () => {
      const response = await api.v1.workspaces[":workspaceSlug"].channels.$get({
        param: { workspaceSlug },
      })
      if (!response.ok) throw new Error("Could not load channels")
      return response.json()
    },
  })
  const { refetch: refetchChannels } = channelsQuery
  const channels = channelsQuery.data ?? null
  const isLoadingChannels = Boolean(workspaceSlug) && channelsQuery.isPending
  const channelError = channelsQuery.error?.message ?? null

  const pullToRefresh = async () => {
    setIsPullRefreshing(true)
    try {
      await refetchChannels()
    } finally {
      setIsPullRefreshing(false)
    }
  }

  useEffect(() => {
    setQuery("")
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
        className="flex-1"
        detail="Create or join a Lor workspace on web, then return here to chat with your team."
        title="No workspace yet"
      />
    )
  }

  const openChannel = (channel: Channel) =>
    router.push({
      pathname: "/channel/[channelId]",
      params: { channelId: channel.id },
    } as never)

  const openSearchMessage = async (message: ChannelSearchResult) => {
    const location = await api.v1.workspaces[":workspaceSlug"].messages[
      ":messageId"
    ]
      .$get({ param: { workspaceSlug: workspace.slug, messageId: message.id } })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null)
    if (!location) {
      Alert.alert(
        "Message unavailable",
        "This message may have been deleted. Try searching again."
      )
      return
    }
    if (location.threadRootId) {
      router.push({
        pathname: "/channel/[channelId]/thread/[threadRootId]",
        params: {
          channelId: location.channelId,
          focusMessageId: message.id,
          threadRootId: location.threadRootId,
        },
      } as never)
      return
    }
    router.push({
      pathname: "/channel/[channelId]",
      params: { channelId: location.channelId, focusMessageId: message.id },
    } as never)
  }

  return (
    <Screen className="bg-background" edges={["top", "bottom"]}>
      <View className="border-b border-separator bg-lor-sidebar dark:bg-lor-sidebar-dark pb-three pt-two">
        <View className="min-h-12 flex-row items-center gap-three px-four">
          <Avatar
            image={workspace.logo}
            name={workspace.name}
            shape="square"
            size="md"
          />
          <View className="min-w-0 flex-1 gap-px">
            <Text
              className="text-[21px] font-bold tracking-[-0.4px] text-foreground"
              numberOfLines={1}
            >
              {workspace.name}
            </Text>
            <Text className="text-xs font-medium text-muted">
              {channelCount === null
                ? "Loading channels"
                : `${channelCount} ${channelCount === 1 ? "channel" : "channels"}`}
            </Text>
          </View>
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

        {workspaces.length > 1 ? (
          <ScrollView
            contentContainerClassName="gap-two px-four pt-three"
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {workspaces.map((item) => {
              const active = item.id === workspace.id
              return (
                <Pressable
                  accessibilityLabel={`${active ? "Current workspace" : "Open"} ${item.name}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  className={`min-h-9 flex-row items-center gap-two rounded-lor-sm border px-two pr-three active:opacity-70 ${
                    active
                      ? "border-accent bg-accent-soft"
                      : "border-border bg-surface"
                  }`}
                  key={item.id}
                  onPress={() => {
                    if (active) return
                    void Haptics.selectionAsync()
                    void selectWorkspace(item.id)
                  }}
                >
                  <Avatar
                    image={item.logo}
                    name={item.name}
                    shape="square"
                    size="xs"
                  />
                  <Text
                    className={`max-w-32 text-xs font-semibold ${active ? "text-accent" : "text-foreground"}`}
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>
                </Pressable>
              )
            })}
          </ScrollView>
        ) : null}
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
          <ChannelList
            data={channels ?? undefined}
            isLoading={isLoadingChannels}
            onPress={openChannel}
          />
        )}
      </ScrollView>
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
