import BubbleChatIcon from "@hugeicons/core-free-icons/BubbleChatIcon"
import CommandLineIcon from "@hugeicons/core-free-icons/CommandLineIcon"
import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon"
import GitForkIcon from "@hugeicons/core-free-icons/GitForkIcon"
import SourceCodeIcon from "@hugeicons/core-free-icons/SourceCodeIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { timeAgo } from "@repo/utils/date"
import { router } from "expo-router"
import { useThemeColor } from "heroui-native/hooks"
import { Linking, Pressable, Text, View } from "react-native"
import { TypewriterText } from "@/components/typewriter-text"
import { Avatar } from "@/components/ui/avatar"

// A session's opening, the first item of its transcript: the title, then one
// quiet line of context, and the session it comes from on its own row.
// Mirrors web's SessionHeading (session-view.tsx).
export function SessionHeading({
  title,
  generatedTitle,
  channelName,
  repo,
  harnessLabel,
  source,
  startedBy,
  starter,
  createdAt,
}: {
  title: string
  // Lor's title types out; a person's rename shows at once.
  generatedTitle: boolean
  channelName: string
  // A code session's repo and branch; a tap opens it on GitHub.
  repo: { fullName: string; branch: string } | null
  // Claude Code or Codex; none for Lor's own agent.
  harnessLabel: string | null
  // "Continue in Code" or a fork: the session this one comes from. A fork
  // opens it at the reply it was forked from.
  source: { id: string; title: string; forkedAt: string | null } | null
  startedBy: string
  // The person who started it; null for loops and automations.
  starter: {
    name: string
    image: string | null
    avatarColor: string | null
  } | null
  createdAt: string
}) {
  const muted = useThemeColor("muted")
  return (
    <View className="px-four pt-five">
      <Text
        accessibilityRole="header"
        className="text-[24px] font-bold leading-[30px] tracking-[-0.4px] text-foreground"
      >
        <TypewriterText animate={generatedTitle} text={title} />
      </Text>
      <View className="mt-two flex-row flex-wrap items-center gap-x-[6px] gap-y-one">
        <Text className="text-sm text-muted">#{channelName}</Text>
        {repo ? (
          <>
            <Text className="text-sm text-muted">·</Text>
            <Pressable
              accessibilityRole="link"
              className="flex-row items-center gap-one active:opacity-60"
              onPress={() =>
                void Linking.openURL(
                  `https://github.com/${repo.fullName}/tree/${repo.branch}`
                )
              }
            >
              <HugeiconsIcon
                color={muted}
                icon={SourceCodeIcon}
                size={14}
                strokeWidth={2}
              />
              <Text className="text-sm text-muted">{repo.fullName}</Text>
              <HugeiconsIcon
                color={muted}
                icon={GitBranchIcon}
                size={14}
                strokeWidth={2}
              />
              <Text className="text-sm text-muted">{repo.branch}</Text>
            </Pressable>
          </>
        ) : null}
        {harnessLabel ? (
          <>
            <Text className="text-sm text-muted">·</Text>
            <View className="flex-row items-center gap-one">
              <HugeiconsIcon
                color={muted}
                icon={CommandLineIcon}
                size={14}
                strokeWidth={2}
              />
              <Text className="text-sm text-muted">{harnessLabel}</Text>
            </View>
          </>
        ) : null}
        <Text className="text-sm text-muted">·</Text>
        <View className="flex-row items-center gap-[6px]">
          {starter ? (
            <Avatar
              avatarColor={starter.avatarColor}
              className="size-5"
              fallback={starter.name.charAt(0).toUpperCase()}
              image={starter.image}
              name={starter.name}
              size="xs"
            />
          ) : null}
          <Text className="text-sm text-muted">{startedBy}</Text>
        </View>
        <Text className="text-sm text-muted">·</Text>
        <Text className="text-sm text-muted">{timeAgo(createdAt)}</Text>
      </View>
      {source ? (
        <Pressable
          accessibilityRole="link"
          className="mt-two flex-row items-center gap-[6px] self-start active:opacity-60"
          onPress={() =>
            router.push({
              pathname: "/session/[sessionId]",
              params: source.forkedAt
                ? { sessionId: source.id, focusMessageId: source.forkedAt }
                : { sessionId: source.id },
            })
          }
        >
          <HugeiconsIcon
            color={muted}
            icon={source.forkedAt ? GitForkIcon : BubbleChatIcon}
            size={14}
            strokeWidth={2}
          />
          <Text className="shrink-0 text-[13px] text-muted">
            {source.forkedAt ? "Forked from" : "Continued from"}
          </Text>
          <Text
            className="min-w-0 shrink text-[13px] font-medium text-muted"
            numberOfLines={1}
          >
            {source.title}
          </Text>
        </Pressable>
      ) : null}
      <View className="mt-five h-px bg-separator" />
    </View>
  )
}
