import AtSignIcon from "@hugeicons/core-free-icons/AtSignIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import { Pressable, ScrollView, Text, View } from "react-native"
import { Avatar } from "@/components/ui/avatar"
import type { MentionCandidate } from "@/lib/mentions"
import { BROADCAST_MENTION_IDS } from "@/lib/mentions"

export function MentionSuggestionMenu({
  candidates,
  error,
  isLoading,
  onSelect,
}: {
  candidates: MentionCandidate[]
  error: string | null
  isLoading: boolean
  onSelect: (candidate: MentionCandidate) => void
}) {
  const accent = useThemeColor("accent")

  return (
    <View
      accessibilityLabel="Mention suggestions"
      className="absolute bottom-full left-three right-three mb-two max-h-[264px] overflow-hidden rounded-lor-md border border-border bg-overlay"
      style={{ zIndex: 20, elevation: 8 }}
    >
      {isLoading && candidates.length <= 1 ? (
        <View className="h-16 flex-row items-center gap-two px-three">
          <Spinner size="sm" />
          <Text className="text-sm text-muted">Loading people…</Text>
        </View>
      ) : error && candidates.length <= 1 ? (
        <View className="min-h-16 justify-center px-three py-two">
          <Text className="text-sm font-medium text-foreground">
            People are unavailable
          </Text>
          <Text className="text-xs text-muted" numberOfLines={1}>
            {error}
          </Text>
        </View>
      ) : candidates.length === 0 ? (
        <View className="h-16 justify-center px-three">
          <Text className="text-sm text-muted">No matching people</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerClassName="py-one"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {candidates.map((candidate) => {
            const isBroadcast = BROADCAST_MENTION_IDS.has(candidate.id)
            const secondary = isBroadcast
              ? candidate.id === "everyone"
                ? "Notify everyone in this workspace"
                : candidate.id === "channel"
                  ? "Notify everyone in this channel"
                  : "Notify channel members who are online"
              : candidate.name !== candidate.label
                ? candidate.name
                : candidate.isBot
                  ? "App"
                  : candidate.status === "online"
                    ? "Online"
                    : "Offline"

            return (
              <Pressable
                accessibilityLabel={`Mention @${candidate.label}`}
                accessibilityRole="button"
                className="mx-one min-h-12 flex-row items-center gap-three rounded-lor-sm px-two py-two active:bg-default"
                key={candidate.id}
                onPress={() => onSelect(candidate)}
              >
                {isBroadcast ? (
                  <View className="size-8 items-center justify-center rounded-lor-sm bg-default">
                    <HugeiconsIcon color={accent} icon={AtSignIcon} size={17} />
                  </View>
                ) : (
                  <Avatar
                    avatarColor={candidate.avatarColor}
                    image={candidate.image}
                    name={candidate.name}
                    size="xs"
                  />
                )}
                <View className="min-w-0 flex-1">
                  <Text
                    className="text-sm font-semibold text-foreground"
                    numberOfLines={1}
                  >
                    @{candidate.label}
                  </Text>
                  <Text className="text-xs text-muted" numberOfLines={1}>
                    {secondary}
                  </Text>
                </View>
                {candidate.status === "online" && !isBroadcast ? (
                  <View
                    accessibilityLabel="Online"
                    className="size-[7px] rounded-full bg-success"
                  />
                ) : null}
              </Pressable>
            )
          })}
        </ScrollView>
      )}
    </View>
  )
}
