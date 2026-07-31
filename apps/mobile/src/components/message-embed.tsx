import ExternalLinkIcon from "@hugeicons/core-free-icons/ExternalLinkIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { Image } from "expo-image"
import { useThemeColor } from "heroui-native/hooks"
import { Pressable, Text, View } from "react-native"
import type { Message } from "@/lib/api-types"
import { openExternalUrl } from "@/lib/open-url"

export function MessageEmbed({ embed }: { embed: Message["embeds"][number] }) {
  const accent = useThemeColor("accent")
  return (
    <Pressable
      accessibilityHint="Opens the link"
      accessibilityLabel={embed.title ?? embed.url}
      accessibilityRole="link"
      className="mt-one max-w-[480px] overflow-hidden rounded-lor-sm border border-border border-l-[3px] border-l-accent bg-surface-secondary"
      onPress={() => openExternalUrl(embed.url)}
    >
      <View className="gap-one p-three">
        {embed.title ? (
          <Text className="text-sm font-semibold text-accent" numberOfLines={2}>
            {embed.title}
          </Text>
        ) : null}
        {embed.description ? (
          <Text className="text-[13px] leading-[18px] text-muted">
            {embed.description}
          </Text>
        ) : null}
        {!embed.title && !embed.description ? (
          <View className="flex-row items-center gap-two">
            <HugeiconsIcon color={accent} icon={ExternalLinkIcon} size={14} />
            <Text
              className="min-w-0 flex-1 text-sm text-accent"
              numberOfLines={2}
            >
              {embed.url}
            </Text>
          </View>
        ) : null}
      </View>
      {embed.thumbnail ? (
        <Image
          accessibilityLabel={embed.title ?? "Link preview"}
          className="h-[180px] w-full"
          contentFit="cover"
          source={{ uri: embed.thumbnail }}
        />
      ) : null}
      {embed.siteName ? (
        <View className="border-t border-border px-three py-two">
          <Text className="text-xs text-muted">{embed.siteName}</Text>
        </View>
      ) : null}
    </Pressable>
  )
}
