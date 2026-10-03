import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  Clock01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { Badge } from "@repo/ui/components/badge"
import { Skeleton } from "@repo/ui/components/skeleton"
import { cn } from "@repo/ui/lib/utils"
import type { ComponentProps, ReactNode } from "react"
import type { VoiceEntityCards } from "@/hooks/use-voice-entity-cards"
import { connectorLogo } from "@/lib/connector-ui"

type LinearIssue = VoiceEntityCards["linear"]["issues"][number]
type PullRequest = VoiceEntityCards["github"]["pullRequests"][number]
type BadgeVariant = ComponentProps<typeof Badge>["variant"]

const LinearLogo = connectorLogo("linear")
const GithubLogo = connectorLogo("github")

const ISSUE_STATE_VARIANT: Record<string, BadgeVariant> = {
  started: "warning",
  completed: "success",
  canceled: "secondary",
  duplicate: "secondary",
}

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
  children,
}: {
  title: string | null
  children: ReactNode
}) {
  return (
    <div>
      {title && <h3 className="mb-2 font-medium text-sm">{title}</h3>}
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  )
}

function IssueCard({ issue }: { issue: LinearIssue }) {
  const details = [issue.priority, issue.assignee ?? "Unassigned", issue.team]
  const variant = ISSUE_STATE_VARIANT[issue.state ?? ""] ?? "outline"
  return (
    <EntityCard
      url={issue.url}
      logo={LinearLogo}
      refLabel={issue.identifier}
      title={issue.title}
      badge={issue.status && <Badge variant={variant}>{issue.status}</Badge>}
    >
      {details.filter(Boolean).map((detail) => (
        <span key={detail}>{detail}</span>
      ))}
      {issue.labels.length > 0 && <span>{issue.labels.join(", ")}</span>}
    </EntityCard>
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
      {pull.author && <span>{pull.author}</span>}
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
    <CardList title={title}>
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
