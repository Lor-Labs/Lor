import { FlatList, StyleSheet, Text, View } from "react-native"
import { Avatar, Skeleton, StatePanel } from "@/components/ui/primitives"
import { Radius, Spacing } from "@/constants/theme"
import { useTheme } from "@/hooks/use-theme"
import type { Message } from "@/lib/api-types"

const MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1000

function displayName(message: Message) {
  return (
    message.overrideName ??
    message.author.displayUsername ??
    message.author.name
  )
}

function isSameDay(left: string, right: string) {
  const leftDate = new Date(left)
  const rightDate = new Date(right)
  return (
    leftDate.getFullYear() === rightDate.getFullYear() &&
    leftDate.getMonth() === rightDate.getMonth() &&
    leftDate.getDate() === rightDate.getDate()
  )
}

function dateLabel(date: string) {
  return new Date(date).toLocaleDateString([], {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

function MessageRow({
  message,
  showHeader,
}: {
  message: Message
  showHeader: boolean
}) {
  const theme = useTheme()
  const isMerlin = displayName(message).toLowerCase() === "merlin"
  const isPending = message.id.startsWith("mobile-")
  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })

  return (
    <View
      style={[
        styles.row,
        !showHeader && styles.compactRow,
        isMerlin && { backgroundColor: theme.merlinMuted },
      ]}
    >
      <View style={styles.avatarSlot}>
        {showHeader ? (
          isMerlin ? (
            <View
              style={[styles.merlinAvatar, { backgroundColor: theme.merlin }]}
            >
              <Text style={styles.merlinMark}>M</Text>
            </View>
          ) : (
            <Avatar
              image={message.overrideAvatarUrl ?? message.author.image}
              name={displayName(message)}
              size={40}
            />
          )
        ) : null}
      </View>
      <View style={styles.messageCopy}>
        {showHeader ? (
          <View style={styles.meta}>
            <Text
              style={[
                styles.name,
                { color: isMerlin ? theme.merlin : theme.text },
              ]}
            >
              {displayName(message)}
            </Text>
            <Text style={[styles.time, { color: theme.textTertiary }]}>
              {time}
            </Text>
            {isPending ? (
              <Text style={[styles.sent, { color: theme.textTertiary }]}>
                Sending
              </Text>
            ) : null}
          </View>
        ) : null}
        {message.content ? (
          <Text style={[styles.content, { color: theme.text }]}>
            {message.content}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

function DateDivider({ date }: { date: string }) {
  const theme = useTheme()
  return (
    <View style={styles.dateDivider}>
      <View style={[styles.dateLine, { backgroundColor: theme.divider }]} />
      <Text style={[styles.dateText, { color: theme.textTertiary }]}>
        {dateLabel(date)}
      </Text>
      <View style={[styles.dateLine, { backgroundColor: theme.divider }]} />
    </View>
  )
}

export function MessageList({
  messages,
  isLoading,
  error,
  channelName,
  onRetry,
}: {
  messages: Message[]
  isLoading: boolean
  error: string | null
  channelName: string
  currentUserId?: string
  onRetry: () => void
}) {
  const theme = useTheme()
  if (isLoading) return <MessageListSkeleton />
  if (error) {
    return (
      <StatePanel
        action={{ label: "Try again", onPress: onRetry }}
        detail={error}
        style={styles.empty}
        title="Messages are unavailable"
      />
    )
  }
  if (messages.length === 0) {
    return (
      <StatePanel
        detail={`This is the beginning of #${channelName}. Say hello to your team.`}
        style={styles.empty}
        title={`Welcome to #${channelName}`}
      />
    )
  }

  return (
    <FlatList
      contentContainerStyle={styles.listContent}
      data={messages}
      inverted
      keyExtractor={(message) => message.id}
      renderItem={({ item, index }) => {
        const older = messages[index + 1]
        const showHeader =
          !older ||
          older.authorId !== item.authorId ||
          new Date(item.createdAt).getTime() -
            new Date(older.createdAt).getTime() >
            MESSAGE_GROUP_WINDOW_MS
        const showDate = !older || !isSameDay(item.createdAt, older.createdAt)
        return (
          <View>
            {showDate ? <DateDivider date={item.createdAt} /> : null}
            <MessageRow message={item} showHeader={showHeader} />
          </View>
        )
      }}
      showsVerticalScrollIndicator={false}
      style={{ backgroundColor: theme.background }}
    />
  )
}

function MessageListSkeleton() {
  return (
    <View style={styles.skeletonList}>
      {[0, 1, 2, 3, 4].map((item) => (
        <View key={item} style={styles.skeletonRow}>
          <Skeleton style={styles.skeletonAvatar} />
          <View style={styles.skeletonCopy}>
            <Skeleton style={styles.skeletonName} />
            <Skeleton
              style={[styles.skeletonLine, { width: item % 2 ? "62%" : "82%" }]}
            />
            {item === 1 ? (
              <Skeleton style={[styles.skeletonLine, { width: "42%" }]} />
            ) : null}
          </View>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  listContent: { paddingVertical: Spacing.four },
  row: {
    flexDirection: "row",
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  compactRow: { paddingBottom: 3, paddingTop: 3 },
  avatarSlot: { minWidth: 40, paddingTop: 1 },
  merlinAvatar: {
    alignItems: "center",
    borderRadius: Radius.medium,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  merlinMark: { color: "#fdfcf9", fontSize: 17, fontWeight: "700" },
  messageCopy: { flex: 1, gap: 2, minWidth: 0 },
  meta: { alignItems: "baseline", flexDirection: "row", gap: Spacing.two },
  name: { fontSize: 15, fontWeight: "700", letterSpacing: -0.1 },
  time: { fontSize: 12, fontWeight: "500" },
  sent: { fontSize: 11, fontWeight: "600", marginLeft: "auto" },
  content: { fontSize: 16, lineHeight: 22 },
  dateDivider: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
  },
  dateLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dateText: { fontSize: 12, fontWeight: "600" },
  empty: { flex: 1 },
  skeletonList: {
    gap: Spacing.six,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.five,
  },
  skeletonRow: { flexDirection: "row", gap: Spacing.three },
  skeletonAvatar: { borderRadius: Radius.medium, height: 40, width: 40 },
  skeletonCopy: { flex: 1, gap: Spacing.two, paddingTop: 2 },
  skeletonName: { height: 14, width: 100 },
  skeletonLine: { height: 12 },
})
