import ArrowTurnForwardIcon from "@hugeicons/core-free-icons/ArrowTurnForwardIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { formatDateTime } from "@repo/utils/date"
import { router } from "expo-router"
import { useThemeColor } from "heroui-native/hooks"
import { useState } from "react"
import { Pressable, Text, View } from "react-native"
import { MessageContent } from "@/components/message-content"
import { Avatar } from "@/components/ui/avatar"
import type { Message } from "@/lib/api-types"

type Forwarded = NonNullable<Message["forwarded"]>

// Taller originals collapse behind "Show more".
const COLLAPSED_HEIGHT = 240

// A forwarded message (type "forward"): the original as it was when
// forwarded, under the forwarder's note. Drawn from the snapshot, so it
// reads the same for people who can't open the source; the footer names the
// source and opens it. Mirrors web's forwarded-message-card.tsx.
export function ForwardedMessageCard({
  forwarded,
  preview = false,
}: {
  forwarded: Forwarded
  // The forward sheet's preview: no source footer.
  preview?: boolean
}) {
  const muted = useThemeColor("muted")
  const [expanded, setExpanded] = useState(false)
  const [contentHeight, setContentHeight] = useState(0)
  const canExpand = contentHeight > COLLAPSED_HEIGHT
  const { author, source } = forwarded
  const where = [`#${source.channelName ?? "channel"}`, source.sessionTitle]
    .filter(Boolean)
    .join(" › ")

  const openSource = () => {
    if (source.sessionId) {
      router.push({
        pathname: "/session/[sessionId]",
        params: {
          sessionId: source.sessionId,
          focusMessageId: forwarded.messageId,
        },
      })
      return
    }
    router.push({
      pathname: "/channel/[channelId]",
      params: {
        channelId: source.channelId,
        focusMessageId: forwarded.messageId,
      },
    })
  }

  return (
    <View className="mt-one max-w-2xl border-l-2 border-border py-px pl-three">
      <View className="flex-row items-center gap-one">
        <HugeiconsIcon color={muted} icon={ArrowTurnForwardIcon} size={13} />
        <Text className="text-xs italic text-muted">Forwarded</Text>
      </View>
      <View className="mt-[6px] flex-row items-center gap-[6px]">
        <Avatar
          className="size-4"
          fallback={author.name.charAt(0).toUpperCase()}
          image={author.image}
          name={author.name}
          size="xs"
        />
        <Text className="text-[13px] font-medium text-foreground">
          {author.name}
        </Text>
      </View>
      <View
        className="mt-one overflow-hidden"
        style={expanded ? undefined : { maxHeight: COLLAPSED_HEIGHT }}
      >
        <View
          onLayout={(event) =>
            setContentHeight(event.nativeEvent.layout.height)
          }
        >
          <MessageContent
            content={forwarded.content}
            mentions={forwarded.mentions}
          />
        </View>
      </View>
      {canExpand ? (
        <Pressable
          accessibilityRole="button"
          className="mt-one self-start active:opacity-60"
          hitSlop={8}
          onPress={() => setExpanded((current) => !current)}
        >
          <Text className="text-xs text-muted">
            {expanded ? "Show less" : "Show more"}
          </Text>
        </Pressable>
      ) : null}
      {preview ? null : (
        <Pressable
          accessibilityHint="Opens the original message"
          accessibilityRole="button"
          className="mt-[6px] min-h-7 flex-row items-center gap-one self-start active:opacity-60"
          onPress={openSource}
        >
          <Text className="shrink text-xs text-muted" numberOfLines={1}>
            {where}
          </Text>
          <Text className="text-xs text-muted">·</Text>
          <Text className="text-xs text-muted">
            {formatDateTime(forwarded.createdAt)}
          </Text>
        </Pressable>
      )}
    </View>
  )
}
