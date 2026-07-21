import type { UnreadNotification } from "@repo/realtime-types"
import { timeAgo } from "@repo/utils/date"
import { useQueryClient } from "@tanstack/react-query"
import { router, useFocusEffect } from "expo-router"
import { useCallback, useEffect, useRef, useState } from "react"
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native"
import { DMAvatar } from "@/components/dm-avatar"
import { Screen } from "@/components/ui/screen"
import { Skeleton } from "@/components/ui/skeleton"
import { StatePanel } from "@/components/ui/state-panel"
import { useSocket } from "@/context/socket-context"
import { useUnread } from "@/context/unread-context"
import { useDMs } from "@/hooks/use-dms"
import type { DM } from "@/lib/api-types"
import { dmDisplayName, dmMemberName } from "@/lib/dms"

export default function DMsScreen() {
  const socket = useSocket()
  const queryClient = useQueryClient()
  const { dms, isLoading, error, refetch } = useDMs()
  const { getUnreadCount, getMentionCount } = useUnread()
  const [isPullRefreshing, setIsPullRefreshing] = useState(false)
  const hasFocusedRef = useRef(false)

  useFocusEffect(
    useCallback(() => {
      if (hasFocusedRef.current) void refetch()
      else hasFocusedRef.current = true
    }, [refetch])
  )

  useEffect(() => {
    if (!socket) return
    const onUnread = (payload: UnreadNotification) => {
      if (payload.workspaceId === null) {
        void queryClient.invalidateQueries({ queryKey: ["dms"] })
      }
    }
    socket.on("notification:unread", onUnread)
    return () => {
      socket.off("notification:unread", onUnread)
    }
  }, [socket, queryClient])

  const pullToRefresh = async () => {
    setIsPullRefreshing(true)
    try {
      await refetch()
    } finally {
      setIsPullRefreshing(false)
    }
  }

  const openDM = (dm: DM) => {
    router.push({ pathname: "/dm/[dmId]", params: { dmId: dm.id } } as never)
  }

  return (
    <Screen className="bg-background" edges={["top", "bottom"]}>
      <View className="min-h-[60px] justify-center border-b border-separator px-four">
        <Text className="text-[22px] font-bold tracking-[-0.4px] text-foreground">
          Messages
        </Text>
      </View>
      {isLoading ? (
        <DMListSkeleton />
      ) : error ? (
        <StatePanel
          action={{ label: "Try again", onPress: () => void refetch() }}
          className="flex-1"
          detail={error}
          status="danger"
          title="Conversations are unavailable"
        />
      ) : dms.length === 0 ? (
        <StatePanel
          className="flex-1"
          detail="Open someone's profile and tap Message to start a direct conversation."
          title="No conversations yet"
        />
      ) : (
        <FlatList
          className="flex-1"
          contentContainerClassName="pb-seven pt-two"
          data={dms}
          keyExtractor={(dm) => dm.id}
          refreshControl={
            <RefreshControl
              onRefresh={() => void pullToRefresh()}
              refreshing={isPullRefreshing}
            />
          }
          renderItem={({ item }) => (
            <DMRow
              dm={item}
              onPress={openDM}
              unreadCount={getUnreadCount(item.id) || getMentionCount(item.id)}
            />
          )}
          showsVerticalScrollIndicator={false}
        />
      )}
    </Screen>
  )
}

function DMRow({
  dm,
  onPress,
  unreadCount,
}: {
  dm: DM
  onPress: (dm: DM) => void
  unreadCount: number
}) {
  const name = dmDisplayName(dm)
  const preview = dmPreview(dm)
  const emphasized = unreadCount > 0

  return (
    <Pressable
      accessibilityHint="Opens this conversation"
      accessibilityLabel={`${name}${
        unreadCount > 0
          ? `, ${unreadCount} unread ${unreadCount === 1 ? "message" : "messages"}`
          : ""
      }`}
      accessibilityRole="button"
      className="min-h-[72px] flex-row items-center gap-three px-four py-two active:bg-surface-secondary"
      onPress={() => onPress(dm)}
    >
      <DMAvatar dm={dm} />
      <View className="min-w-0 flex-1 gap-px">
        <Text
          className={`text-[15px] leading-5 ${
            emphasized
              ? "font-bold text-foreground"
              : "font-semibold text-foreground"
          }`}
          numberOfLines={1}
        >
          {name}
        </Text>
        <Text
          className={`text-sm leading-5 ${
            emphasized ? "font-medium text-foreground" : "text-muted"
          }`}
          numberOfLines={1}
        >
          {preview}
        </Text>
      </View>
      <View className="items-end gap-one">
        {dm.lastMessage ? (
          <Text className="text-xs text-muted">
            {timeAgo(dm.lastMessage.createdAt)}
          </Text>
        ) : null}
        {unreadCount > 0 ? (
          <View className="h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5">
            <Text className="text-[11px] font-bold leading-[13px] text-danger-foreground">
              {unreadCount > 99 ? "99+" : unreadCount}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  )
}

function dmPreview(dm: DM) {
  if (!dm.lastMessage) return "Say hello"
  const content = dm.lastMessage.content ?? "Sent an attachment"
  if (dm.type === "group_dm") {
    return `${dmMemberName(dm.lastMessage.author)}: ${content}`
  }
  return content
}

function DMListSkeleton() {
  return (
    <View className="gap-two px-four pt-four">
      {[0, 1, 2, 3, 4].map((row) => (
        <View
          className="min-h-[72px] flex-row items-center gap-three"
          key={row}
        >
          <Skeleton className="size-11 rounded-full" />
          <View className="flex-1 gap-two">
            <Skeleton className="h-3.5 w-[45%] rounded-full" />
            <Skeleton
              className={`${row % 2 ? "w-[70%]" : "w-[55%]"} h-3 rounded-full`}
            />
          </View>
        </View>
      ))}
    </View>
  )
}
