import { router, useFocusEffect } from "expo-router"
import { SymbolView } from "expo-symbols"
import { Spinner } from "heroui-native/spinner"
import { useCallback, useEffect, useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { ChannelList } from "@/components/channel-list"
import { Avatar } from "@/components/ui/avatar"
import { IconButton } from "@/components/ui/icon-button"
import { Screen } from "@/components/ui/screen"
import { StatePanel } from "@/components/ui/state-panel"
import { useWorkspace } from "@/context/workspace-context"
import { useTheme } from "@/hooks/use-theme"
import { api } from "@/lib/api"
import type { ChannelList as ChannelListData } from "@/lib/api-types"

const shortcuts = [
  { label: "Inbox", detail: "All caught up", icon: "tray" },
  { label: "Merlin", detail: "Ask anything", icon: "sparkles" },
] as const

export default function WorkspaceScreen() {
  const theme = useTheme()
  const {
    workspace,
    workspaces,
    isLoading: workspaceLoading,
    error: workspaceError,
    selectWorkspace,
  } = useWorkspace()
  const [channels, setChannels] = useState<ChannelListData | null>(null)
  const [isLoadingChannels, setIsLoadingChannels] = useState(false)
  const [channelError, setChannelError] = useState<string | null>(null)

  const loadChannels = useCallback(async () => {
    if (!workspace) return
    setIsLoadingChannels(true)
    setChannelError(null)
    try {
      const response = await api.v1.workspaces[":workspaceSlug"].channels.$get({
        param: { workspaceSlug: workspace.slug },
      })
      if (!response.ok) throw new Error("Could not load channels")
      setChannels(await response.json())
    } catch (cause) {
      setChannelError(
        cause instanceof Error ? cause.message : "Could not load channels"
      )
    } finally {
      setIsLoadingChannels(false)
    }
  }, [workspace])

  useEffect(() => {
    setChannels(null)
  }, [workspace?.id])

  useFocusEffect(
    useCallback(() => {
      void loadChannels()
    }, [loadChannels])
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

  return (
    <Screen className="bg-lor-bg dark:bg-lor-bg-dark" edges={["top", "bottom"]}>
      <View className="gap-three bg-lor-sidebar pb-four pt-two dark:bg-lor-sidebar-dark">
        <ScrollView
          contentContainerClassName="gap-two px-four"
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {workspaces.map((item) => {
            const active = item.id === workspace.id
            return (
              <Pressable
                accessibilityLabel={`Open ${item.name}`}
                className={`rounded-lor-md p-[3px] active:opacity-70 ${
                  active
                    ? "bg-lor-accent-muted dark:bg-lor-accent-muted-dark"
                    : ""
                }`}
                key={item.id}
                onPress={() => void selectWorkspace(item.id)}
              >
                <Avatar
                  image={item.logo}
                  name={item.name}
                  shape="square"
                  size="xs"
                />
              </Pressable>
            )
          })}
        </ScrollView>
        <View className="flex-row items-center gap-three px-four">
          <View className="flex-1 gap-px">
            <Text
              className="text-[22px] font-bold tracking-[-0.45px] text-lor-text dark:text-lor-text-dark"
              numberOfLines={1}
            >
              {workspace.name}
            </Text>
            <Text className="text-[13px] font-medium text-lor-text-secondary dark:text-lor-text-secondary-dark">
              Spaces for your team
            </Text>
          </View>
          <IconButton
            accessibilityLabel="Search workspace"
            onPress={() => router.push("/explore")}
            variant="tertiary"
          >
            <SymbolView
              name={{
                ios: "magnifyingglass",
                android: "search",
                web: "search",
              }}
              size={19}
              tintColor={theme.textSecondary}
            />
          </IconButton>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-six px-four pt-five"
        showsVerticalScrollIndicator={false}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerClassName="gap-two pr-four"
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {shortcuts.map((shortcut) => (
            <Pressable
              className="min-h-[86px] w-[132px] gap-[2px] rounded-lor-md border border-lor-border bg-lor-surface p-three active:bg-lor-pressed dark:border-lor-border-dark dark:bg-lor-surface-dark dark:active:bg-lor-pressed-dark"
              key={shortcut.label}
              onPress={() => router.push("/explore")}
            >
              <SymbolView
                name={{
                  ios: shortcut.icon,
                  android: shortcut.icon === "tray" ? "inbox" : "chat",
                  web: shortcut.icon === "tray" ? "inbox" : "chat",
                }}
                size={18}
                tintColor={
                  shortcut.label === "Merlin"
                    ? theme.merlin
                    : theme.textSecondary
                }
              />
              <Text className="mt-one text-sm font-bold text-lor-text dark:text-lor-text-dark">
                {shortcut.label}
              </Text>
              <Text className="text-xs leading-4 text-lor-text-secondary dark:text-lor-text-secondary-dark">
                {shortcut.detail}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <View className="mt-two flex-row items-baseline gap-two">
          <Text className="text-lg font-bold tracking-[-0.2px] text-lor-text dark:text-lor-text-dark">
            Channels
          </Text>
          <Text className="text-[13px] font-semibold text-lor-text-secondary dark:text-lor-text-secondary-dark">
            {channels
              ? channels.uncategorized.length +
                channels.categories.reduce(
                  (total, category) => total + category.channels.length,
                  0
                )
              : ""}
          </Text>
        </View>

        {channelError ? (
          <StatePanel
            action={{ label: "Try again", onPress: () => void loadChannels() }}
            detail={channelError}
            title="Channels are unavailable"
          />
        ) : (
          <ChannelList
            data={channels ?? undefined}
            isLoading={isLoadingChannels}
            onPress={(channel) =>
              router.push({
                pathname: "/channel/[channelId]",
                params: { channelId: channel.id },
              } as never)
            }
          />
        )}
      </ScrollView>
    </Screen>
  )
}

function LoadingScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-lor-bg dark:bg-lor-bg-dark">
      <Spinner accessibilityLabel="Loading workspace" />
    </View>
  )
}
