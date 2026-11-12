import BubbleChatIcon from "@hugeicons/core-free-icons/BubbleChatIcon"
import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon"
import GitForkIcon from "@hugeicons/core-free-icons/GitForkIcon"
import HashtagIcon from "@hugeicons/core-free-icons/HashtagIcon"
import SourceCodeIcon from "@hugeicons/core-free-icons/SourceCodeIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { timeAgo } from "@repo/utils/date"
import { router } from "expo-router"
import { useThemeColor } from "heroui-native/hooks"
import type { ReactNode } from "react"
import { Text, View } from "react-native"
import { HarnessLogo } from "@/components/harness-logo"
import { TypewriterText } from "@/components/typewriter-text"
import { Avatar } from "@/components/ui/avatar"
import { PressableScale } from "@/components/ui/pressable-scale"
import { HARNESS_LABELS, type SessionHarness } from "@/lib/harness"
import { openExternalUrl } from "@/lib/open-url"

// A session's opening, the first item of its transcript: the title, then
// its facts as short items that wrap whole (never a line that starts with a
// separator): where and who and when, then a code session's repo, branch
// and agent, and the session it comes from on its own row. Mirrors web's
// SessionHeading (session-view.tsx).
export function SessionHeading({
  title,
  generatedTitle,
  channelName,
  repo,
  harness,
  source,
  startedBy,
  starter,
  createdAt,
}: {
  title: string
  // Lor's title types out; a person's rename shows at once.
  generatedTitle: boolean
  channelName: string
  // A code session's repo and branch; a tap opens it on GitHub. A new
  // branch shows by name, but the link stays on its base: the branch is on
  // GitHub only after the session's first push.
  repo: { fullName: string; branch: string; newBranch: string | null } | null
  // Claude Code or Codex; none for Lor's own agent.
  harness: Exclude<SessionHarness, "pi"> | null
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
      <View className="mt-three flex-row flex-wrap items-center gap-x-three gap-y-[6px]">
        <Fact>
          <HugeiconsIcon
            color={muted}
            icon={HashtagIcon}
            size={14}
            strokeWidth={2}
          />
          <Text className="shrink text-sm text-muted" numberOfLines={1}>
            {channelName}
          </Text>
        </Fact>
        <Fact>
          {starter ? (
            <Avatar
              avatarColor={starter.avatarColor}
              className="size-[18px]"
              fallback={starter.name.charAt(0).toUpperCase()}
              image={starter.image}
              name={starter.name}
              size="xs"
            />
          ) : null}
          <Text className="shrink text-sm text-muted" numberOfLines={1}>
            {startedBy}
          </Text>
        </Fact>
        <Text className="text-sm text-muted">{timeAgo(createdAt)}</Text>
      </View>
      {repo || harness ? (
        <View className="mt-[6px] flex-row flex-wrap items-center gap-x-three gap-y-[6px]">
          {repo ? (
            <PressableScale
              accessibilityHint={
                repo.newBranch
                  ? `Opens ${repo.branch}, its base, on GitHub`
                  : "Opens the branch on GitHub"
              }
              accessibilityLabel={`${repo.fullName}, branch ${repo.newBranch ?? repo.branch}`}
              accessibilityRole="link"
              className="max-w-full flex-row flex-wrap items-center gap-x-three gap-y-[6px]"
              feedback="dim"
              onPress={() =>
                openExternalUrl(
                  `https://github.com/${repo.fullName}/tree/${repo.branch}`
                )
              }
            >
              <Fact>
                <HugeiconsIcon
                  color={muted}
                  icon={SourceCodeIcon}
                  size={14}
                  strokeWidth={2}
                />
                <Text className="shrink text-sm text-muted" numberOfLines={1}>
                  {repo.fullName}
                </Text>
              </Fact>
              <Fact>
                <HugeiconsIcon
                  color={muted}
                  icon={GitBranchIcon}
                  size={14}
                  strokeWidth={2}
                />
                <Text className="shrink text-sm text-muted" numberOfLines={1}>
                  {repo.newBranch ?? repo.branch}
                </Text>
              </Fact>
            </PressableScale>
          ) : null}
          {harness ? (
            <Fact>
              <HarnessLogo harness={harness} size={13} />
              <Text className="text-sm text-muted">
                {HARNESS_LABELS[harness]}
              </Text>
            </Fact>
          ) : null}
        </View>
      ) : null}
      {source ? (
        <PressableScale
          accessibilityRole="link"
          className="mt-[6px] max-w-full flex-row items-center gap-[6px] self-start"
          feedback="dim"
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
          <Text className="shrink-0 text-sm text-muted">
            {source.forkedAt ? "Forked from" : "Continued from"}
          </Text>
          <Text
            className="min-w-0 shrink text-sm font-medium text-muted"
            numberOfLines={1}
          >
            {source.title}
          </Text>
        </PressableScale>
      ) : null}
      <View className="mt-five h-px bg-separator" />
    </View>
  )
}

// One fact of the heading: a mark and its words, kept together when the
// row wraps.
function Fact({ children }: { children: ReactNode }) {
  return (
    <View className="max-w-full flex-row items-center gap-[6px]">
      {children}
    </View>
  )
}
