import {
  Cancel01Icon,
  HelpCircleIcon,
  LockKeyIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import { Button } from "@repo/ui/components/button"
import { Input } from "@repo/ui/components/input"
import { cn } from "@repo/ui/lib/utils"
import { useQuery } from "@tanstack/react-query"
import { useParams } from "@tanstack/react-router"
import { useState } from "react"
import { MessageMarkdown } from "@/components/chat/message-markdown"
import { rememberClaudeCodeMode } from "@/components/session/claude-code-mode-picker"
import {
  type ApprovalResolverSpec,
  type ChannelApproval,
  resolverLabel,
  useCanResolveApproval,
  useMessageApprovals,
  useResolveChannelApproval,
} from "@/hooks/use-approvals"
import { apiClient } from "@/lib/api-client"

export type ApprovalCardData = {
  id: string
  description: string
  planId: string | null
  target: string | null
  toolName: string | null
  resolver: ApprovalResolverSpec | null
  resolverUserName: string | null
  // A Claude Code prompt: only the turn's sender decides it.
  onlyUserId?: string | null
  // A Claude Code plan waiting for approval: its Markdown.
  plan?: string | null
  // A Claude Code question: its questions, and once answered, the answers.
  questions?: ChannelApproval["questions"]
  answers?: ChannelApproval["answers"]
  status: "pending" | "approved" | "rejected" | "expired"
  resolvedBy: string | null
}

type Answers = NonNullable<ChannelApproval["answers"]>
type Question = NonNullable<ChannelApproval["questions"]>[number]

// What a Claude Code prompt's decision carries beyond yes or no.
type ResolveExtra = { planMode?: "acceptEdits" | "default"; answers?: Answers }

// The gate cards under a paused run's own message, one per gated call.
// Renders nothing unless this message's run paused on approvals. In a session
// they stay after the decision as its record: nothing else posts (the
// decision reaches Lor as the harness approval response).
export function MessageApprovalCard({
  channelId,
  messageId,
  threadRootId,
}: {
  channelId: string
  messageId: string
  threadRootId: string | null
}) {
  const approvals = useMessageApprovals(channelId, messageId, threadRootId)
  if (approvals.length === 0) return null
  return (
    <div className="mt-2 flex max-w-xl flex-col gap-2">
      {approvals.map((approval) => (
        <ApprovalGateCard
          key={approval.id}
          channelId={channelId}
          threadRootId={threadRootId}
          approval={approval}
        />
      ))}
    </div>
  )
}

// One approval gate, wherever it surfaces (plan header, channel/thread
// placeholder). Buttons show only for people the resolver spec allows — the
// server re-checks on resolve regardless.
export function ApprovalGateCard({
  channelId,
  threadRootId = null,
  approval,
}: {
  channelId: string
  // Lets a decision move the session's sidebar row at once.
  threadRootId?: string | null
  approval: ApprovalCardData
}) {
  const { workspaceSlug } = useParams({ strict: false })
  const resolve = useResolveChannelApproval(channelId)

  // Same queries the settings dialog runs, deduped by react-query.
  const { data: activeMember } = useQuery({
    queryKey: ["active-workspace-member", workspaceSlug],
    queryFn: async (): Promise<{ userId: string; role: string } | null> => {
      const res = await authClient.organization.getActiveMember()
      return res.data
        ? {
            userId: res.data.userId as string,
            role: res.data.role as string,
          }
        : null
    },
    enabled: !!workspaceSlug,
  })
  const { data: membersData } = useQuery({
    queryKey: ["workspace-members", workspaceSlug],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].members.$get({
        param: { workspaceSlug: workspaceSlug as string },
      })
      if (!res.ok) throw new Error("Failed to fetch workspace members")
      return res.json()
    },
    enabled: !!workspaceSlug,
  })

  const canResolve = useCanResolveApproval(
    membersData?.workspaceId,
    activeMember ?? null,
    membersData?.ownerId,
    approval.resolver,
    approval.onlyUserId
  )

  const onResolve = (
    resolution: "approve" | "reject",
    extra: ResolveExtra = {}
  ) => {
    if (!activeMember) return
    resolve.mutate({
      approvalId: approval.id,
      resolution,
      userId: activeMember.userId,
      planId: approval.planId,
      threadRootId,
      ...(extra.planMode ? { claudeCodeMode: extra.planMode } : {}),
      ...(extra.answers ? { answers: extra.answers } : {}),
    })
    // The sender's next message goes on in that mode too, not in Plan.
    if (extra.planMode) rememberClaudeCodeMode(extra.planMode)
  }

  const resolvedByName =
    approval.resolvedBy === activeMember?.userId
      ? "you"
      : (membersData?.members.find((m) => m.userId === approval.resolvedBy)
          ?.name ?? null)

  return (
    <ApprovalGateView
      approval={approval}
      canResolve={canResolve}
      pending={resolve.isPending}
      onResolve={onResolve}
      resolvedByName={resolvedByName}
    />
  )
}

const RESOLVED_LABEL = {
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
} as const

// One quiet row: what Lor wants to do, who can allow it, and the buttons;
// once decided, what was decided and by whom. Data in, callback out (the
// /design page renders it with sample data).
export function ApprovalGateView({
  approval,
  canResolve,
  pending,
  onResolve,
  resolvedByName,
}: {
  approval: ApprovalCardData
  canResolve: boolean
  pending: boolean
  onResolve: (resolution: "approve" | "reject", extra?: ResolveExtra) => void
  resolvedByName: string | null
}) {
  if (approval.status === "pending" && approval.plan) {
    return (
      <PlanApprovalView
        approval={approval}
        plan={approval.plan}
        canResolve={canResolve}
        pending={pending}
        onResolve={onResolve}
      />
    )
  }
  if (approval.status === "pending" && approval.questions) {
    return (
      <QuestionApprovalView
        approval={approval}
        questions={approval.questions}
        canResolve={canResolve}
        pending={pending}
        onResolve={onResolve}
      />
    )
  }
  if (approval.status !== "pending") {
    const approved = approval.status === "approved"
    const answered =
      approval.questions && approval.answers
        ? answerSummary(approval.questions, approval.answers)
        : null
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border/60 py-2 ps-3 pe-3">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-lg",
            approved
              ? "bg-success/12 text-success-foreground"
              : "bg-foreground/[0.05] text-muted-foreground"
          )}
        >
          <HugeiconsIcon
            icon={approved ? Tick02Icon : Cancel01Icon}
            className="size-3.5"
            strokeWidth={2.25}
          />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] text-foreground/80 leading-5">
            {approval.description}
          </p>
          <p className="truncate text-muted-foreground text-xs leading-4">
            {approval.questions
              ? approved
                ? "Answered"
                : "Skipped"
              : RESOLVED_LABEL[approval.status]}
            {resolvedByName && ` by ${resolvedByName}`}
            {answered && ` · ${answered}`}
          </p>
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border/60 bg-card py-2.5 ps-3 pe-2.5 dark:bg-foreground/[0.025]">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-warning/12 text-warning-foreground">
        <HugeiconsIcon
          icon={LockKeyIcon}
          className="size-3.5"
          strokeWidth={2}
        />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium leading-5">
          {approval.description}
        </p>
        <p className="truncate text-muted-foreground text-xs leading-4">
          {canResolve
            ? "Needs your approval"
            : resolverLabel(approval.resolver, approval.resolverUserName)}
          {approval.toolName && (
            <>
              {" · "}
              <span className="font-mono">{approval.toolName}</span>
            </>
          )}
        </p>
      </div>
      {canResolve && (
        <div className="ms-auto flex shrink-0 gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => onResolve("reject")}
          >
            Reject
          </Button>
          <Button
            size="sm"
            disabled={pending}
            onClick={() => onResolve("approve")}
          >
            Approve
          </Button>
        </div>
      )}
    </div>
  )
}

// A Claude Code plan (ExitPlanMode): the plan itself and the choices of
// Claude Code's own plan dialog. Keep planning rejects, so Claude Code goes
// on planning.
function PlanApprovalView({
  approval,
  plan,
  canResolve,
  pending,
  onResolve,
}: {
  approval: ApprovalCardData
  plan: string
  canResolve: boolean
  pending: boolean
  onResolve: (resolution: "approve" | "reject", extra?: ResolveExtra) => void
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-card p-3 dark:bg-foreground/[0.025]">
      <div className="flex items-center gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-warning/12 text-warning-foreground">
          <HugeiconsIcon
            icon={LockKeyIcon}
            className="size-3.5"
            strokeWidth={2}
          />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium leading-5">
            {approval.description}
          </p>
          <p className="truncate text-muted-foreground text-xs leading-4">
            {canResolve
              ? "Needs your approval"
              : resolverLabel(approval.resolver, approval.resolverUserName)}
          </p>
        </div>
      </div>
      <div className="max-h-80 overflow-y-auto rounded-lg border border-border/50 bg-muted/30 px-3 py-2">
        <MessageMarkdown content={plan} mentions={[]} className="text-sm" />
      </div>
      {canResolve && (
        <div className="flex flex-wrap justify-end gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => onResolve("reject")}
          >
            Keep planning
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => onResolve("approve", { planMode: "default" })}
          >
            Approve, ask for edits
          </Button>
          <Button
            size="sm"
            disabled={pending}
            onClick={() => onResolve("approve", { planMode: "acceptEdits" })}
          >
            Approve and accept edits
          </Button>
        </div>
      )}
    </div>
  )
}

// A Claude Code question (AskUserQuestion): per question, pick options or
// write an answer, as in Claude Code's own prompt. Skip declines, and Claude
// Code goes on without it.
function QuestionApprovalView({
  approval,
  questions,
  canResolve,
  pending,
  onResolve,
}: {
  approval: ApprovalCardData
  questions: Question[]
  canResolve: boolean
  pending: boolean
  onResolve: (resolution: "approve" | "reject", extra?: ResolveExtra) => void
}) {
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [written, setWritten] = useState<Record<string, string>>({})
  const answers: Answers = Object.fromEntries(
    questions.flatMap((question) => {
      const optionIds = picked[question.id] ?? []
      const freeform = written[question.id]?.trim()
      if (optionIds.length === 0 && !freeform) return []
      return [[question.id, { optionIds, ...(freeform ? { freeform } : {}) }]]
    })
  )
  const toggle = (question: Question, optionId: string) =>
    setPicked((current) => {
      const chosen = current[question.id] ?? []
      const next = chosen.includes(optionId)
        ? chosen.filter((id) => id !== optionId)
        : question.allowMultiple
          ? [...chosen, optionId]
          : [optionId]
      return { ...current, [question.id]: next }
    })

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-3 dark:bg-foreground/[0.025]">
      <div className="flex items-center gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-warning/12 text-warning-foreground">
          <HugeiconsIcon
            icon={HelpCircleIcon}
            className="size-3.5"
            strokeWidth={2}
          />
        </span>
        <p className="min-w-0 flex-1 truncate text-muted-foreground text-xs leading-4">
          {canResolve
            ? "Claude Code needs your answer"
            : resolverLabel(approval.resolver, approval.resolverUserName)}
        </p>
      </div>
      {questions.map((question) => (
        <div key={question.id} className="flex flex-col gap-1.5">
          <p className="text-[13px] font-medium leading-5">
            {question.header && (
              <span className="me-1.5 rounded bg-muted px-1 py-px font-normal text-muted-foreground text-xs">
                {question.header}
              </span>
            )}
            {question.question}
          </p>
          {question.options && question.options.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {question.options.map((option) => (
                <Button
                  key={option.id}
                  size="sm"
                  variant={
                    picked[question.id]?.includes(option.id)
                      ? "default"
                      : "outline"
                  }
                  disabled={!canResolve || pending}
                  title={option.description}
                  onClick={() => toggle(question, option.id)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          )}
          {canResolve && (
            <Input
              size="sm"
              value={written[question.id] ?? ""}
              onChange={(event) =>
                setWritten((current) => ({
                  ...current,
                  [question.id]: event.target.value,
                }))
              }
              placeholder="Or write your own answer"
              disabled={pending}
            />
          )}
        </div>
      ))}
      {canResolve && (
        <div className="flex justify-end gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => onResolve("reject")}
          >
            Skip
          </Button>
          <Button
            size="sm"
            disabled={pending || Object.keys(answers).length === 0}
            onClick={() => onResolve("approve", { answers })}
          >
            Send answer
          </Button>
        </div>
      )}
    </div>
  )
}

// One line of what was answered: "Color: Blue".
function answerSummary(questions: Question[], answers: Answers): string {
  return questions
    .flatMap((question) => {
      const answer = answers[question.id]
      if (!answer) return []
      const value =
        answer.freeform ??
        answer.optionIds
          .map(
            (id) => question.options?.find((option) => option.id === id)?.label
          )
          .filter(Boolean)
          .join(", ")
      return value ? [`${question.header ?? question.question}: ${value}`] : []
    })
    .join("; ")
}
