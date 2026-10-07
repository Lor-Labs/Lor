import AlertCircleIcon from "@hugeicons/core-free-icons/AlertCircleIcon"
import Calendar03Icon from "@hugeicons/core-free-icons/Calendar03Icon"
import CheckmarkCircle02Icon from "@hugeicons/core-free-icons/CheckmarkCircle02Icon"
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import {
  getAvatarColorStyle,
  getAvatarInitials,
} from "@repo/utils/avatar-colors"
import { Image } from "expo-image"
import { useThemeColor } from "heroui-native/hooks"
import { cn } from "heroui-native/utils"
import type { ReactNode } from "react"
import { Pressable, Text, View } from "react-native"
import { ConnectorIcon } from "@/components/connector-icon"
import {
  LinearPriorityIcon,
  LinearStatusIcon,
} from "@/components/voice/linear-issue-icons"
import type { EntityCards } from "@/components/voice/lor-blocks"
import { openExternalUrl } from "@/lib/open-url"

// Linear issues and GitHub pull requests in Lor's window, matching web
// (apps/web/src/components/voice/lor-entity-cards.tsx) in a single column.

type LinearIssue = EntityCards["linear"]["issues"][number]
type PullRequest = EntityCards["github"]["pullRequests"][number]
type ThemeTone = "success" | "danger" | "warning" | "muted"

function Card({ url, children }: { url: string; children: ReactNode }) {
  return (
    <Pressable
      accessibilityRole="link"
      className="gap-two rounded-lor-sm bg-surface-secondary p-three active:bg-surface-tertiary"
      onPress={() => openExternalUrl(url)}
    >
      {children}
    </Pressable>
  )
}

// A connector account's picture; initials until it loads.
function PersonAvatar({
  name,
  src,
  size,
}: {
  name: string
  src: string | null
  size: number
}) {
  const colors = getAvatarColorStyle(null, name)
  return (
    <View
      accessibilityLabel={name}
      className="items-center justify-center overflow-hidden rounded-full"
      style={{
        width: size,
        height: size,
        backgroundColor: colors.backgroundColor,
      }}
    >
      {src ? (
        <Image source={{ uri: src }} style={{ width: size, height: size }} />
      ) : (
        <Text
          className="font-semibold"
          style={{ color: colors.foregroundColor, fontSize: size * 0.42 }}
        >
          {getAvatarInitials(name)}
        </Text>
      )}
    </View>
  )
}

function Chip({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <View
      className={cn(
        "h-6 flex-row items-center gap-[6px] rounded-full border border-separator px-two",
        className
      )}
    >
      {children}
    </View>
  )
}

const shortDate = (date: Date) =>
  date.toLocaleDateString(undefined, { month: "short", day: "numeric" })

function IssueCard({ issue }: { issue: LinearIssue }) {
  const [muted, danger] = useThemeColor(["muted", "danger"])
  const visuals = issue.visuals
  // A date-only value: midnight local time, not UTC.
  const due = issue.dueDate ? new Date(`${issue.dueDate}T00:00:00`) : null
  const overdue =
    due !== null && due.getTime() < Date.now() && issue.state !== "completed"
  return (
    <Card url={issue.url}>
      <View className="flex-row items-center gap-two">
        <ConnectorIcon color={muted} connector="linear" size={13} />
        <Text className="text-[13px] text-muted">{issue.identifier}</Text>
        <View className="ml-auto">
          {issue.assignee ? (
            <PersonAvatar
              name={issue.assignee}
              size={20}
              src={visuals?.assigneeAvatarUrl ?? null}
            />
          ) : (
            <View
              accessibilityLabel="Unassigned"
              className="size-5 rounded-full border border-dashed border-muted"
            />
          )}
        </View>
      </View>
      <View className="flex-row items-start gap-two">
        <View
          accessibilityLabel={issue.status ?? undefined}
          className="mt-[3px]"
        >
          <LinearStatusIcon state={issue.state} />
        </View>
        <Text
          className="flex-1 text-[15px] font-medium leading-5 text-foreground"
          numberOfLines={2}
        >
          {issue.title}
        </Text>
      </View>
      <View className="flex-row flex-wrap gap-[6px]">
        {visuals && (
          <Chip className="w-6 justify-center px-0">
            <LinearPriorityIcon priority={visuals.priority} />
          </Chip>
        )}
        {due && (
          <Chip>
            <HugeiconsIcon
              color={overdue ? danger : muted}
              icon={Calendar03Icon}
              size={13}
              strokeWidth={2}
            />
            <Text
              className={cn(
                "text-[12px]",
                overdue ? "text-danger" : "text-muted"
              )}
            >
              {shortDate(due)}
            </Text>
          </Chip>
        )}
        {visuals?.labels.map((label) => (
          <Chip key={label.name}>
            <View
              className="size-2 rounded-full"
              style={{ backgroundColor: label.color }}
            />
            <Text className="text-[12px] text-muted">{label.name}</Text>
          </Chip>
        ))}
      </View>
      <Text className="text-[12px] text-muted">
        Created {shortDate(new Date(issue.createdAt))}
      </Text>
    </Card>
  )
}

const PULL_STATE: Record<
  PullRequest["state"],
  { label: string; pill: string; text: string }
> = {
  open: {
    label: "Open",
    pill: "bg-success-soft",
    text: "text-success-soft-foreground",
  },
  draft: {
    label: "Draft",
    pill: "bg-default-soft",
    text: "text-default-soft-foreground",
  },
  merged: {
    label: "Merged",
    pill: "bg-accent-soft",
    text: "text-accent-soft-foreground",
  },
  closed: {
    label: "Closed",
    pill: "bg-danger-soft",
    text: "text-danger-soft-foreground",
  },
}

type Signal = { label: string; tone: ThemeTone; icon: typeof Clock01Icon }

const REVIEW_SIGNAL: Record<NonNullable<PullRequest["review"]>, Signal> = {
  approved: { label: "Approved", tone: "success", icon: CheckmarkCircle02Icon },
  changes_requested: {
    label: "Changes requested",
    tone: "danger",
    icon: AlertCircleIcon,
  },
  waiting: { label: "Review requested", tone: "muted", icon: Clock01Icon },
}

const CHECKS_SIGNAL: Record<NonNullable<PullRequest["checks"]>, Signal> = {
  passing: {
    label: "Checks passing",
    tone: "success",
    icon: CheckmarkCircle02Icon,
  },
  failing: { label: "Checks failing", tone: "danger", icon: AlertCircleIcon },
  running: { label: "Checks running", tone: "warning", icon: Clock01Icon },
}

const TONE_TEXT: Record<ThemeTone, string> = {
  success: "text-success",
  danger: "text-danger",
  warning: "text-warning",
  muted: "text-muted",
}

function SignalLabel({ signal }: { signal: Signal }) {
  const color = useThemeColor(signal.tone)
  return (
    <View className="flex-row items-center gap-one">
      <HugeiconsIcon
        color={color}
        icon={signal.icon}
        size={13}
        strokeWidth={2}
      />
      <Text className={cn("text-[12px]", TONE_TEXT[signal.tone])}>
        {signal.label}
      </Text>
    </View>
  )
}

function PullRequestCard({ pull }: { pull: PullRequest }) {
  const muted = useThemeColor("muted")
  const state = PULL_STATE[pull.state]
  return (
    <Card url={pull.url}>
      <View className="flex-row items-center gap-two">
        <ConnectorIcon color={muted} connector="github" size={14} />
        <Text className="flex-1 text-[13px] text-muted" numberOfLines={1}>
          {pull.ref}
        </Text>
        <View className={cn("rounded-full px-two py-[2px]", state.pill)}>
          <Text className={cn("text-[12px] font-medium", state.text)}>
            {state.label}
          </Text>
        </View>
      </View>
      <Text
        className="text-[15px] font-medium leading-5 text-foreground"
        numberOfLines={2}
      >
        {pull.title}
      </Text>
      <View className="flex-row flex-wrap items-center gap-x-three gap-y-one">
        {pull.author && (
          <View className="flex-row items-center gap-[6px]">
            <PersonAvatar
              name={pull.author}
              size={16}
              src={pull.authorAvatarUrl}
            />
            <Text className="text-[12px] text-muted">{pull.author}</Text>
          </View>
        )}
        {pull.review && <SignalLabel signal={REVIEW_SIGNAL[pull.review]} />}
        {pull.checks && <SignalLabel signal={CHECKS_SIGNAL[pull.checks]} />}
        <Text className="text-[12px]">
          <Text className="text-success">+{pull.additions}</Text>{" "}
          <Text className="text-danger">−{pull.deletions}</Text>
        </Text>
      </View>
    </Card>
  )
}

// A reference that hasn't loaded: loading, then why it's missing.
function Unloaded({ refLabel, reason }: { refLabel: string; reason: string }) {
  return (
    <View className="rounded-lor-sm border border-dashed border-separator px-three py-two">
      <Text className="text-[14px] text-muted">
        {refLabel}: {reason}
      </Text>
    </View>
  )
}

export function EntityCardList({
  issues,
  pullRequests,
  cards,
  failed,
}: {
  issues?: string[]
  pullRequests?: string[]
  cards: EntityCards | undefined
  failed: boolean
}) {
  const unloaded = (connected: boolean | undefined, missing: string) =>
    !cards
      ? failed
        ? "couldn't load"
        : "loading…"
      : connected === false
        ? "not connected"
        : missing
  return (
    <View className="gap-two">
      {issues?.map((identifier) => {
        const issue = cards?.linear.issues.find(
          (entry) => entry.identifier === identifier
        )
        return issue ? (
          <IssueCard key={identifier} issue={issue} />
        ) : (
          <Unloaded
            key={identifier}
            reason={unloaded(
              cards?.linear.connected,
              "couldn't load this issue"
            )}
            refLabel={identifier}
          />
        )
      })}
      {pullRequests?.map((ref) => {
        // GitHub owner and repo names are case-insensitive.
        const pull = cards?.github.pullRequests.find(
          (entry) => entry.ref.toLowerCase() === ref.toLowerCase()
        )
        return pull ? (
          <PullRequestCard key={ref} pull={pull} />
        ) : (
          <Unloaded
            key={ref}
            reason={unloaded(
              cards?.github.connected,
              "couldn't load this pull request"
            )}
            refLabel={ref}
          />
        )
      })}
    </View>
  )
}
