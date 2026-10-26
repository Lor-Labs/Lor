import {
  Cancel01Icon,
  LockKeyIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import { Button } from "@repo/ui/components/button"
import { Checkbox } from "@repo/ui/components/checkbox"
import { Input } from "@repo/ui/components/input"
import { Kbd } from "@repo/ui/components/kbd"
import { Radio, RadioGroup } from "@repo/ui/components/radio-group"
import { cn } from "@repo/ui/lib/utils"
import { useQuery } from "@tanstack/react-query"
import { useParams } from "@tanstack/react-router"
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type Variants,
} from "motion/react"
import {
  type KeyboardEvent,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
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

// The --ease-out token (globals.css) and the strong ease-in-out, for Motion.
const EASE_OUT = [0.23, 1, 0.32, 1] as const
const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const

// A step slides out and the next question slides in from the side it comes
// from: forward from the right, back from the left.
const QUESTION_STEP = {
  enter: (direction: number) => ({
    opacity: 0,
    transform: `translateX(${direction * 24}px)`,
  }),
  center: { opacity: 1, transform: "translateX(0px)" },
  exit: (direction: number) => ({
    opacity: 0,
    transform: `translateX(${direction * -24}px)`,
  }),
} satisfies Variants

// The "Question 2 of 4" line rolls: forward rises in from below, back drops in
// from above.
const STEP_LABEL = {
  enter: (direction: number) => ({
    opacity: 0,
    transform: `translateY(${direction * 6}px)`,
  }),
  center: { opacity: 1, transform: "translateY(0px)" },
  exit: (direction: number) => ({
    opacity: 0,
    transform: `translateY(${direction * -6}px)`,
  }),
} satisfies Variants

// The card eases to the next question's height instead of jumping; it snaps
// under reduced motion.
function AnimatedHeight({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | "auto">("auto")
  const reduceMotion = useReducedMotion()
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(() => setHeight(element.offsetHeight))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return (
    <motion.div
      initial={false}
      animate={{ height }}
      transition={{ duration: reduceMotion ? 0 : 0.25, ease: EASE_IN_OUT }}
      className="overflow-hidden"
    >
      {/* popLayout takes the leaving step out of the flow, inside this box. */}
      <div ref={ref} className="relative">
        {children}
      </div>
    </motion.div>
  )
}

// A Claude Code question (AskUserQuestion) as a stepper, one question at a
// time: pick options (number keys too) or write your own answer, which
// Claude Code takes over the options. Skip leaves a question unanswered;
// with none answered the questions are declined and Claude Code goes on.
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
  const [step, setStep] = useState(0)
  // 1 forward, -1 back: the next question comes in from that side.
  const [direction, setDirection] = useState(1)
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [written, setWritten] = useState<Record<string, string>>({})
  const question = questions[step]
  if (!question) return null

  const go = (to: number) => {
    setDirection(to > step ? 1 : -1)
    setStep(to)
  }

  const options = question.options ?? []
  const chosen = picked[question.id] ?? []
  const enabled = canResolve && !pending
  const last = step === questions.length - 1
  const answerOf = (id: string) => {
    const freeform = written[id]?.trim()
    if (freeform) return { optionIds: [], freeform }
    const optionIds = picked[id] ?? []
    return optionIds.length > 0 ? { optionIds } : null
  }
  const answered = answerOf(question.id) !== null

  const pick = (optionId: string) => {
    setWritten((current) => ({ ...current, [question.id]: "" }))
    setPicked((current) => {
      const ids = current[question.id] ?? []
      const next = !question.allowMultiple
        ? [optionId]
        : ids.includes(optionId)
          ? ids.filter((id) => id !== optionId)
          : [...ids, optionId]
      return { ...current, [question.id]: next }
    })
  }
  const write = (value: string) => {
    setWritten((current) => ({ ...current, [question.id]: value }))
    if (value.trim())
      setPicked((current) => ({ ...current, [question.id]: [] }))
  }
  // `skipped`: the current question, skipped on the last step.
  const submit = (skipped?: string) => {
    const answers: Answers = Object.fromEntries(
      questions.flatMap((q) => {
        const answer = q.id === skipped ? null : answerOf(q.id)
        return answer ? [[q.id, answer]] : []
      })
    )
    if (Object.keys(answers).length === 0) onResolve("reject")
    else onResolve("approve", { answers })
  }
  const next = () => (last ? submit() : go(step + 1))
  const skip = () => {
    setPicked((current) => ({ ...current, [question.id]: [] }))
    setWritten((current) => ({ ...current, [question.id]: "" }))
    if (last) submit(question.id)
    else go(step + 1)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!enabled) return
    if (event.key === "Enter" && answered) {
      event.preventDefault()
      next()
      return
    }
    if (event.target instanceof HTMLInputElement) return
    const option = options[Number(event.key) - 1]
    if (option) {
      event.preventDefault()
      pick(option.id)
    }
  }

  const rowClass = (selected: boolean) =>
    cn(
      "flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors",
      enabled ? "cursor-pointer hover:bg-muted" : "cursor-default",
      selected ? "bg-muted" : "bg-muted/40"
    )
  const optionText = (option: (typeof options)[number], index: number) => (
    <>
      <span
        className="min-w-0 flex-1 truncate text-sm"
        title={option.description}
      >
        <span className="font-medium">{option.label}</span>
        {option.description && (
          <span className="ms-2 text-muted-foreground">
            {option.description}
          </span>
        )}
      </span>
      {enabled && index < 9 && <Kbd>{index + 1}</Kbd>}
    </>
  )
  const hint =
    options.length === 0
      ? "Write your answer."
      : question.allowMultiple
        ? "Select all that apply, or write your own."
        : "Choose one, or write your own."

  return (
    <div
      onKeyDown={onKeyDown}
      className="flex flex-col gap-4 rounded-xl border border-border/60 bg-card p-4 dark:bg-foreground/[0.025]"
    >
      <div className="flex flex-col gap-2">
        {questions.length > 1 && (
          <div className="flex gap-1">
            {questions.map((q, index) => (
              <span key={q.id} className="h-1 flex-1 rounded-full bg-muted">
                {/* Fills from the left; clip-path keeps the pill's ends round,
                    where scaleX would squash them. */}
                <span
                  className="block h-full rounded-full bg-foreground/80 transition-[clip-path] duration-250 ease-out motion-reduce:transition-none"
                  style={{
                    clipPath:
                      index <= step
                        ? "inset(0 0 0 0 round 9999px)"
                        : "inset(0 100% 0 0 round 9999px)",
                  }}
                />
              </span>
            ))}
          </div>
        )}
        <div className="relative">
          <AnimatePresence mode="popLayout" initial={false} custom={direction}>
            <motion.p
              key={question.id}
              custom={direction}
              variants={STEP_LABEL}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.2, ease: EASE_OUT }}
              className="text-muted-foreground text-xs"
            >
              {questions.length > 1
                ? `Question ${step + 1} of ${questions.length}`
                : "Claude Code asks"}
              {question.header && ` · ${question.header}`}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>
      <AnimatedHeight>
        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
          <motion.div
            key={question.id}
            custom={direction}
            variants={QUESTION_STEP}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.22, ease: EASE_OUT }}
            className="flex flex-col gap-4"
          >
            <div className="flex flex-col gap-0.5">
              <p className="font-medium text-[15px] leading-6">
                {question.question}
              </p>
              <p className="text-muted-foreground text-sm">{hint}</p>
            </div>
            {options.length > 0 &&
              (question.allowMultiple ? (
                <div className="flex flex-col gap-1.5">
                  {options.map((option, index) => (
                    // biome-ignore lint/a11y/noLabelWithoutControl: Base UI's Checkbox renders the input
                    <label
                      key={option.id}
                      className={rowClass(chosen.includes(option.id))}
                    >
                      <Checkbox
                        checked={chosen.includes(option.id)}
                        onCheckedChange={() => pick(option.id)}
                        disabled={!enabled}
                      />
                      {optionText(option, index)}
                    </label>
                  ))}
                </div>
              ) : (
                <RadioGroup
                  value={chosen[0] ?? ""}
                  onValueChange={(value) => pick(String(value))}
                  disabled={!enabled}
                  className="gap-1.5"
                >
                  {options.map((option, index) => (
                    // biome-ignore lint/a11y/noLabelWithoutControl: Base UI's Radio renders the input
                    <label
                      key={option.id}
                      className={rowClass(chosen.includes(option.id))}
                    >
                      <Radio value={option.id} />
                      {optionText(option, index)}
                    </label>
                  ))}
                </RadioGroup>
              ))}
            {canResolve && (
              <Input
                unstyled
                size="lg"
                value={written[question.id] ?? ""}
                onChange={(event) => write(event.target.value)}
                placeholder="Or write your own answer…"
                disabled={pending}
                className="rounded-lg bg-muted/40 text-sm transition-colors focus-within:bg-muted"
              />
            )}
          </motion.div>
        </AnimatePresence>
      </AnimatedHeight>
      <div className="flex items-center gap-1.5">
        {step > 0 && (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => go(step - 1)}
          >
            Previous
          </Button>
        )}
        <div className="ms-auto flex items-center gap-1.5">
          {canResolve ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={skip}
              >
                Skip
              </Button>
              <Button size="sm" disabled={!enabled || !answered} onClick={next}>
                {last ? "Send" : "Next"}
              </Button>
            </>
          ) : (
            <>
              <span className="text-muted-foreground text-xs">
                {resolverLabel(approval.resolver, approval.resolverUserName)}
              </span>
              {!last && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => go(step + 1)}
                >
                  Next
                </Button>
              )}
            </>
          )}
        </div>
      </div>
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
