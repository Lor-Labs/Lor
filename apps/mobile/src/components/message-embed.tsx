import ExternalLinkIcon from "@hugeicons/core-free-icons/ExternalLinkIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { Image } from "expo-image"
import { useThemeColor } from "heroui-native/hooks"
import { Pressable, Text, View } from "react-native"
import type { Message } from "@/lib/api-types"
import { openExternalUrl } from "@/lib/open-url"

// Link previews and webhook cards (Discord embeds / Slack attachments).
// Rich cards may have no url (not tappable), sender-chosen accent colors,
// author lines, field pairs, and a footer.
export function MessageEmbed({ embed }: { embed: Message["embeds"][number] }) {
  const accent = useThemeColor("accent")
  const footer = [embed.footer, embed.siteName].find(Boolean)
  const body = (
    <>
      <View className="gap-one p-three">
        {embed.author?.name ? (
          <Text className="text-xs font-semibold text-foreground">
            {embed.author.name}
          </Text>
        ) : null}
        {embed.title ? (
          <Text
            className={
              embed.url
                ? "text-sm font-semibold text-accent"
                : "text-sm font-semibold text-foreground"
            }
            numberOfLines={2}
          >
            {embed.title}
          </Text>
        ) : null}
        {embed.description ? (
          <Text className="text-[13px] leading-[18px] text-muted">
            {embed.description}
          </Text>
        ) : null}
        {embed.fields?.length
          ? embed.fields.map((field, index) => (
              <View key={`${field.name}-${index}`}>
                {field.name ? (
                  <Text className="text-xs font-semibold text-foreground">
                    {field.name}
                  </Text>
                ) : null}
                {field.value ? (
                  <Text className="text-[13px] leading-[18px] text-muted">
                    {field.value}
                  </Text>
                ) : null}
              </View>
            ))
          : null}
        {!embed.title &&
        !embed.description &&
        !embed.fields?.length &&
        embed.url ? (
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
      {(embed.image ?? embed.thumbnail) ? (
        <Image
          accessibilityLabel={embed.title ?? "Embed image"}
          className="h-[180px] w-full"
          contentFit="cover"
          source={{ uri: embed.image ?? embed.thumbnail }}
        />
      ) : null}
      {footer ? (
        <View className="border-t border-border px-three py-two">
          <Text className="text-xs text-muted">{footer}</Text>
        </View>
      ) : null}
    </>
  )

  const className =
    "mt-one max-w-[480px] overflow-hidden rounded-lor-sm border border-border border-l-[3px] bg-surface-secondary"
  const accentStyle = embed.color
    ? { borderLeftColor: embed.color }
    : { borderLeftColor: accent }

  if (!embed.url) {
    return (
      <View className={className} style={accentStyle}>
        {body}
      </View>
    )
  }
  return (
    <Pressable
      accessibilityHint="Opens the link"
      accessibilityLabel={embed.title ?? embed.url}
      accessibilityRole="link"
      className={className}
      style={accentStyle}
      onPress={() => {
        if (embed.url) openExternalUrl(embed.url)
      }}
    >
      {body}
    </Pressable>
  )
}
