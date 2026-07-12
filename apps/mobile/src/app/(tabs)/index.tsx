import { router } from "expo-router"
import { SymbolView } from "expo-symbols"
import { useCallback, useEffect, useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { ChannelList } from "@/components/channel-list"
import { Avatar, InlineSpinner, StatePanel } from "@/components/ui/primitives"
import { Radius, Spacing } from "@/constants/theme"
import { useWorkspace } from "@/context/workspace-context"
import { useTheme } from "@/hooks/use-theme"
import { api } from "@/lib/api"
import type { ChannelList as ChannelListData } from "@/lib/api-types"

const shortcuts = [
  { label: "Inbox", detail: "All caught up", icon: "tray" },
  { label: "Merlin", detail: "Ask anything", icon: "sparkles" },
  {
    label: "Threads",
    detail: "Coming soon",
    icon: "bubble.left.and.bubble.right",
  },
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
    void loadChannels()
  }, [loadChannels])

  if (workspaceLoading) return <LoadingScreen />
  if (workspaceError) {
    return (
      <StatePanel
        detail={workspaceError}
        style={styles.centered}
        title="Your workspace is unavailable"
      />
    )
  }
  if (!workspace) {
    return (
      <StatePanel
        detail="Create or join a Lor workspace on web, then return here to chat with your team."
        style={styles.centered}
        title="No workspace yet"
      />
    )
  }

  return (
    <SafeAreaView
      edges={["top", "bottom"]}
      style={[styles.screen, { backgroundColor: theme.background }]}
    >
      <View style={[styles.topbar, { backgroundColor: theme.sidebar }]}>
        <ScrollView
          contentContainerStyle={styles.workspaceRail}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {workspaces.map((item) => {
            const active = item.id === workspace.id
            return (
              <Pressable
                accessibilityLabel={`Open ${item.name}`}
                key={item.id}
                onPress={() => void selectWorkspace(item.id)}
                style={({ pressed }) => [
                  styles.workspaceMark,
                  active && { backgroundColor: theme.accentMuted },
                  pressed && { opacity: 0.72 },
                ]}
              >
                <Avatar image={item.logo} name={item.name} size={32} />
              </Pressable>
            )
          })}
        </ScrollView>
        <View style={styles.workspaceHeading}>
          <View style={styles.workspaceCopy}>
            <Text
              numberOfLines={1}
              style={[styles.workspaceName, { color: theme.text }]}
            >
              {workspace.name}
            </Text>
            <Text
              style={[styles.workspaceMeta, { color: theme.textSecondary }]}
            >
              Spaces for your team
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Search workspace"
            onPress={() => router.push("/explore")}
            style={({ pressed }) => [
              styles.searchButton,
              { backgroundColor: theme.surfaceRaised },
              pressed && { backgroundColor: theme.pressed },
            ]}
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
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <ScrollView
          contentContainerStyle={styles.shortcutRow}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {shortcuts.map((shortcut) => (
            <Pressable
              key={shortcut.label}
              onPress={() => router.push("/explore")}
              style={({ pressed }) => [
                styles.shortcut,
                {
                  backgroundColor: theme.surface,
                  borderColor: theme.border,
                },
                pressed && { backgroundColor: theme.pressed },
              ]}
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
              <Text style={[styles.shortcutLabel, { color: theme.text }]}>
                {shortcut.label}
              </Text>
              <Text
                style={[styles.shortcutDetail, { color: theme.textSecondary }]}
              >
                {shortcut.detail}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.channelsHeading}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>
            Channels
          </Text>
          <Text style={[styles.channelCount, { color: theme.textSecondary }]}>
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
    </SafeAreaView>
  )
}

function LoadingScreen() {
  const theme = useTheme()
  return (
    <View style={[styles.loading, { backgroundColor: theme.background }]}>
      <InlineSpinner />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1 },
  loading: { alignItems: "center", flex: 1, justifyContent: "center" },
  topbar: {
    gap: Spacing.three,
    paddingBottom: Spacing.four,
    paddingTop: Spacing.two,
  },
  workspaceRail: { gap: Spacing.two, paddingHorizontal: Spacing.four },
  workspaceMark: { borderRadius: Radius.medium, padding: 3 },
  workspaceHeading: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  workspaceCopy: { flex: 1, gap: 1 },
  workspaceName: { fontSize: 22, fontWeight: "700", letterSpacing: -0.45 },
  workspaceMeta: { fontSize: 13, fontWeight: "500" },
  searchButton: {
    alignItems: "center",
    borderRadius: Radius.medium,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  content: {
    gap: Spacing.six,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.five,
  },
  shortcutRow: { gap: Spacing.two, paddingRight: Spacing.four },
  shortcut: {
    borderRadius: Radius.medium,
    borderWidth: 1,
    gap: 2,
    minHeight: 86,
    padding: Spacing.three,
    width: 132,
  },
  shortcutLabel: { fontSize: 14, fontWeight: "700", marginTop: 4 },
  shortcutDetail: { fontSize: 12, lineHeight: 16 },
  channelsHeading: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  sectionTitle: { fontSize: 18, fontWeight: "700", letterSpacing: -0.2 },
  channelCount: { fontSize: 13, fontWeight: "600" },
})
