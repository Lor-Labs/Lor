import {
  AlertCircleIcon,
  Calendar03Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/avatar"
import { Badge } from "@repo/ui/components/badge"
import { Skeleton } from "@repo/ui/components/skeleton"
import { cn } from "@repo/ui/lib/utils"
import { getAvatarInitials } from "@repo/utils/avatar-colors"
import type { ComponentProps, ReactNode } from "react"
import {
  LinearPriorityIcon,
  LinearStatusIcon,
} from "@/components/voice/linear-issue-icons"
import type { VoiceEntityCards } from "@/hooks/use-voice-entity-cards"
import { connectorLogo } from "@/lib/connector-ui"

type LinearIssue = VoiceEntityCards["linear"]["issues"][number]
type PullRequest = VoiceEntityCards["github"]["pullRequests"][number]
type BadgeVariant = ComponentProps<typeof Badge>["variant"]

const LinearLogo = connectorLogo("linear")
const GithubLogo = connectorLogo("github")

const PULL_STATE: Record<
  PullRequest["state"],
  { label: string; variant: BadgeVariant }
> = {
  open: { label: "Open", variant: "success" },
  draft: { label: "Draft", variant: "secondary" },
  merged: { label: "Merged", variant: "info" },
  closed: { label: "Closed", variant: "error" },
}

type Signal = { label: string; icon: IconSvgElement; className: string }

const REVIEW_SIGNAL: Record<NonNullable<PullRequest["review"]>, Signal> = {
  approved: {
    label: "Approved",
    icon: CheckmarkCircle02Icon,
    className: "text-success-foreground",
  },
  changes_requested: {
    label: "Changes requested",
    icon: AlertCircleIcon,
    className: "text-destructive-foreground",
  },
  waiting: {
    label: "Review requested",
    icon: Clock01Icon,
    className: "text-muted-foreground",
  },
}

const CHECKS_SIGNAL: Record<NonNullable<PullRequest["checks"]>, Signal> = {
  passing: {
    label: "Checks passing",
    icon: CheckmarkCircle02Icon,
    className: "text-success-foreground",
  },
  failing: {
    label: "Checks failing",
    icon: AlertCircleIcon,
    className: "text-destructive-foreground",
  },
  running: {
    label: "Checks running",
    icon: Clock01Icon,
    className: "text-warning-foreground",
  },
}

function SignalLabel({ signal }: { signal: Signal }) {
  return (
    <span className={cn("flex items-center gap-1", signal.className)}>
      <HugeiconsIcon icon={signal.icon} strokeWidth={2} className="size-3.5" />
      {signal.label}
    </span>
  )
}

// One record: a link to it, its reference and title on top, details below.
function EntityCard({
  url,
  logo: Logo,
  refLabel,
  title,
  badge,
  children,
}: {
  url: string
  logo: typeof LinearLogo
  refLabel: string
  title: string
  badge: ReactNode
  children: ReactNode
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="flex flex-col gap-1 rounded-lg bg-muted/60 px-3 py-2.5 transition-colors hover:bg-muted"
    >
      <span className="flex min-w-0 items-center gap-2 text-sm">
        <Logo className="size-4 shrink-0" />
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {refLabel}
        </span>
        <span className="truncate font-medium">{title}</span>
        <span className="ml-auto shrink-0">{badge}</span>
      </span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-6 text-muted-foreground text-xs">
        {children}
      </span>
    </a>
  )
}

function MissingCard({
  refLabel,
  reason,
}: {
  refLabel: string
  reason: string
}) {
  return (
    <div className="rounded-lg border border-border/60 border-dashed px-3 py-2.5 text-muted-foreground text-sm">
      {refLabel}: {reason}
    </div>
  )
}

function LoadingCard({ refLabel }: { refLabel: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-muted/60 px-3 py-2.5">
      <span className="text-muted-foreground text-sm">{refLabel}</span>
      <Skeleton className="h-3 w-1/2" />
    </div>
  )
}

function CardList({
  title,
  grid = false,
  children,
}: {
  title: string | null
  // Board-style columns that collapse to one in a docked window.
  grid?: boolean
  children: ReactNode
}) {
  return (
    <div>
      {title && <h3 className="mb-2 font-medium text-sm">{title}</h3>}
      <div
        className={
          grid
            ? "grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-2"
            : "flex flex-col gap-1.5"
        }
      >
        {children}
      </div>
    </div>
  )
}

const shortDate = (date: Date) =>
  date.toLocaleDateString(undefined, { month: "short", day: "numeric" })

function Chip({
  children,
  className,
  title,
}: {
  children: ReactNode
  className?: string
  title?: string
}) {
  return (
    <span
      title={title}
      className={cn(
        "flex h-6 items-center gap-1.5 rounded-full border border-border/60 px-2 text-muted-foreground text-xs",
        className
      )}
    >
      {children}
    </span>
  )
}

// A connector account's picture (Linear assignee, GitHub author); initials
// until it loads.
function PersonAvatar({
  name,
  src,
  size,
}: {
  name: string
  src: string | null
  size: "sm" | "xs"
}) {
  return (
    <Avatar
      className={cn("shrink-0", size === "sm" ? "size-5" : "size-4")}
      title={name}
    >
      {src && <AvatarImage src={src} alt={name} />}
      <AvatarFallback
        fallbackSeed={name}
        className={cn(
          "font-semibold",
          size === "sm" ? "text-[9px]" : "text-[8px]"
        )}
      >
        {getAvatarInitials(name)}
      </AvatarFallback>
    </Avatar>
  )
}

// Shaped like a card on a Linear board: identifier and assignee, status and
// title, then priority, due date, and labels.
function IssueCard({ issue }: { issue: LinearIssue }) {
  const visuals = issue.visuals
  // A date-only value: midnight local time, not UTC.
  const due = issue.dueDate ? new Date(`${issue.dueDate}T00:00:00`) : null
  const overdue =
    due !== null && due.getTime() < Date.now() && issue.state !== "completed"
  return (
    <a
      href={issue.url}
      target="_blank"
      rel="noreferrer"
      className="flex flex-col gap-2.5 rounded-lg bg-muted/60 p-3 transition-colors hover:bg-muted"
    >
      <span className="flex items-center gap-2 text-muted-foreground text-xs">
        <LinearLogo className="size-3.5" />
        <span className="tabular-nums">{issue.identifier}</span>
        <span className="ml-auto">
          {issue.assignee ? (
            <PersonAvatar
              name={issue.assignee}
              src={visuals?.assigneeAvatarUrl ?? null}
              size="sm"
            />
          ) : (
            <span
              title="Unassigned"
              className="block size-5 rounded-full border border-muted-foreground/50 border-dashed"
            />
          )}
        </span>
      </span>
      <span className="flex items-start gap-2">
        <span title={issue.status ?? undefined} className="mt-[3px] flex">
          <LinearStatusIcon state={issue.state} />
        </span>
        <span className="line-clamp-2 font-medium text-sm">{issue.title}</span>
      </span>
      <span className="flex flex-wrap gap-1.5">
        {visuals && (
          <Chip title={issue.priority} className="w-6 justify-center px-0">
            <LinearPriorityIcon priority={visuals.priority} />
          </Chip>
        )}
        {due && (
          <Chip className={cn(overdue && "text-destructive-foreground")}>
            <HugeiconsIcon
              icon={Calendar03Icon}
              strokeWidth={2}
              className="size-3.5"
            />
            {shortDate(due)}
          </Chip>
        )}
        {visuals?.labels.map((label) => (
          <Chip key={label.name}>
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: label.color }}
            />
            {label.name}
          </Chip>
        ))}
      </span>
      <span className="text-muted-foreground text-xs">
        Created {shortDate(new Date(issue.createdAt))}
      </span>
    </a>
  )
}

function PullRequestCard({ pull }: { pull: PullRequest }) {
  const state = PULL_STATE[pull.state]
  return (
    <EntityCard
      url={pull.url}
      logo={GithubLogo}
      refLabel={pull.ref}
      title={pull.title}
      badge={<Badge variant={state.variant}>{state.label}</Badge>}
    >
      {pull.author && (
        <span className="flex items-center gap-1.5">
          <PersonAvatar
            name={pull.author}
            src={pull.authorAvatarUrl}
            size="xs"
          />
          {pull.author}
        </span>
      )}
      {pull.review && <SignalLabel signal={REVIEW_SIGNAL[pull.review]} />}
      {pull.checks && <SignalLabel signal={CHECKS_SIGNAL[pull.checks]} />}
      <span className="tabular-nums">
        <span className="text-success-foreground">+{pull.additions}</span>{" "}
        <span className="text-destructive-foreground">−{pull.deletions}</span>
      </span>
    </EntityCard>
  )
}

// The window's card data: loading until the first fetch lands, failed once
// it gives up.
export type EntityCardsState = {
  data: VoiceEntityCards | undefined
  failed: boolean
}

function Unloaded({
  refLabel,
  cards,
  reason,
}: {
  refLabel: string
  cards: EntityCardsState
  // Why it's missing once the cards loaded.
  reason: string
}) {
  if (!cards.data && !cards.failed) return <LoadingCard refLabel={refLabel} />
  return (
    <MissingCard
      refLabel={refLabel}
      reason={cards.data ? reason : "couldn't load"}
    />
  )
}

export function LinearIssueCards({
  title,
  identifiers,
  cards,
}: {
  title: string | null
  identifiers: string[]
  cards: EntityCardsState
}) {
  const linear = cards.data?.linear
  return (
    <CardList title={title} grid>
      {identifiers.map((identifier) => {
        const issue = linear?.issues.find(
          (entry) => entry.identifier === identifier
        )
        return issue ? (
          <IssueCard key={identifier} issue={issue} />
        ) : (
          <Unloaded
            key={identifier}
            refLabel={identifier}
            cards={cards}
            reason={
              linear?.connected === false
                ? "Linear isn't connected"
                : "couldn't load this issue"
            }
          />
        )
      })}
    </CardList>
  )
}

export function PullRequestCards({
  title,
  refs,
  cards,
}: {
  title: string | null
  refs: string[]
  cards: EntityCardsState
}) {
  const github = cards.data?.github
  return (
    <CardList title={title}>
      {refs.map((ref) => {
        // GitHub owner and repo names are case-insensitive.
        const pull = github?.pullRequests.find(
          (entry) => entry.ref.toLowerCase() === ref.toLowerCase()
        )
        return pull ? (
          <PullRequestCard key={ref} pull={pull} />
        ) : (
          <Unloaded
            key={ref}
            refLabel={ref}
            cards={cards}
            reason={
              github?.connected === false
                ? "GitHub isn't connected"
                : "couldn't load this pull request"
            }
          />
        )
      })}
    </CardList>
  )
}
