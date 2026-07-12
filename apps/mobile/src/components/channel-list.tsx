import { Pressable, StyleSheet, Text, View } from "react-native"
import { SectionLabel, Skeleton, textStyles } from "@/components/ui/primitives"
import { Radius, Spacing } from "@/constants/theme"
import { useTheme } from "@/hooks/use-theme"
import type { Channel, ChannelCategory } from "@/lib/api-types"

function ChannelRow({
  channel,
  onPress,
}: {
  channel: Channel
  onPress: (channel: Channel) => void
}) {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityLabel={`Open ${channel.name}`}
      accessibilityRole="button"
      onPress={() => onPress(channel)}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: theme.pressed },
      ]}
    >
      <Text style={[styles.hash, { color: theme.textTertiary }]}>#</Text>
      <Text numberOfLines={1} style={[styles.rowName, { color: theme.text }]}>
        {channel.name ?? "untitled"}
      </Text>
      {channel.topic ? (
        <Text
          numberOfLines={1}
          style={[styles.rowTopic, { color: theme.textSecondary }]}
        >
          {channel.topic}
        </Text>
      ) : null}
    </Pressable>
  )
}

function ChannelSection({
  title,
  channels,
  onPress,
}: {
  title: string
  channels: Channel[]
  onPress: (channel: Channel) => void
}) {
  if (channels.length === 0) return null
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.chevron}>⌄</Text>
        <SectionLabel>{title}</SectionLabel>
      </View>
      {channels.map((channel) => (
        <ChannelRow channel={channel} key={channel.id} onPress={onPress} />
      ))}
    </View>
  )
}

export function ChannelList({
  data,
  isLoading,
  onPress,
}: {
  data?: { uncategorized: Channel[]; categories: ChannelCategory[] }
  isLoading: boolean
  onPress: (channel: Channel) => void
}) {
  if (isLoading) return <ChannelListSkeleton />
  if (!data) return null

  return (
    <View style={styles.list}>
      <ChannelSection
        channels={data.uncategorized}
        onPress={onPress}
        title="Channels"
      />
      {data.categories.map((category) => (
        <ChannelSection
          channels={category.channels}
          key={category.id}
          onPress={onPress}
          title={category.name ?? "Channels"}
        />
      ))}
    </View>
  )
}

function ChannelListSkeleton() {
  return (
    <View style={styles.list}>
      {[0, 1].map((section) => (
        <View key={section} style={styles.section}>
          <Skeleton style={styles.skeletonLabel} />
          {[0, 1, 2, 3].map((row) => (
            <View key={row} style={styles.skeletonRow}>
              <Skeleton style={styles.skeletonIcon} />
              <Skeleton
                style={[styles.skeletonName, { width: `${44 + row * 9}%` }]}
              />
            </View>
          ))}
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  list: { gap: Spacing.six, paddingBottom: Spacing.seven },
  section: { gap: 2 },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 3,
    marginBottom: Spacing.one,
    paddingHorizontal: Spacing.one,
  },
  chevron: { color: "#8d8780", fontSize: 17, lineHeight: 17, marginTop: -4 },
  row: {
    alignItems: "center",
    borderRadius: Radius.small,
    flexDirection: "row",
    gap: Spacing.two,
    minHeight: 40,
    paddingHorizontal: Spacing.three,
  },
  hash: { fontSize: 20, fontWeight: "400", lineHeight: 22, width: 17 },
  rowName: { ...textStyles.bodyMedium, flexShrink: 0 },
  rowTopic: { ...textStyles.caption, flex: 1, marginLeft: Spacing.one },
  skeletonLabel: {
    height: 10,
    marginBottom: Spacing.two,
    marginLeft: Spacing.one,
    width: 80,
  },
  skeletonRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.two,
    minHeight: 40,
    paddingHorizontal: Spacing.three,
  },
  skeletonIcon: { height: 16, width: 16 },
  skeletonName: { height: 13 },
})
