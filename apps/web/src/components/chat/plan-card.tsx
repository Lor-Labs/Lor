import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Badge } from "@repo/ui/components/badge"
import { cn } from "@repo/ui/lib/utils"
import { ArtifactFileCard } from "@/components/chat/artifact-file-card"
import {
  PlanStepList,
  PlanStepProgress,
} from "@/components/chat/plan-step-list"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import { usePlanForCard } from "@/hooks/use-channel-plans"
import { usePlanArtifacts } from "@/hooks/use-plan"
import type { Message } from "@/lib/api-types"
import { PLAN_STATUS_META } from "@/lib/plan-ui"
import { toSearchPreviewText } from "@/lib/search-preview"

// The card a plan_card message renders as: title and outcome in the header, the
// live plan in a recessed well, delivered files underneath. Clicking opens the
// plan's thread — a stretched overlay button carries the click, so the step rows
// and file chips (both z-20) stay interactive.
const SURFACE_CLASS =
  "relative mt-1.5 w-full max-w-xl overflow-hidden rounded-xl border bg-card transition-colors"

export function PlanCard({
  message,
  onOpenThread,
}: {
  message: Message
  onOpenThread?: (rootMessageId: string) => void
}) {
  const plan = usePlanForCard(message.channelId, message.id)
  const { data: artifacts } = usePlanArtifacts(plan?.id ?? null)
  const { view, isCollapsed } = useRightSidebar()
  const threadRootId = plan?.threadRootId ?? message.id
  const isOpenThread =
    !isCollapsed &&
    view?.type === "thread" &&
    view.threadRootId === threadRootId

  if (!plan) {
    return (
      <div className={cn("group/plan", SURFACE_CLASS)}>
        {onOpenThread && (
          <button
            type="button"
            aria-label="Open plan thread"
            onClick={() => onOpenThread(message.id)}
            className="absolute inset-0 z-10 cursor-pointer rounded-xl"
          />
        )}
        <p className="line-clamp-2 px-4 py-3.5 text-muted-foreground text-sm leading-5">
          {toSearchPreviewText(message.content, message.mentions ?? [], {
            dropUnresolvedMentions: true,
          })}
        </p>
      </div>
    )
  }

  const meta = PLAN_STATUS_META[plan.status]
  const isComplete = plan.status === "completed"
  // One description slot, showing whatever matters most right now: the outcome
  // once delivered, otherwise the ask that started the plan. Rendered as plain
  // text, so mention tokens and markdown are flattened.
  const description = toSearchPreviewText(
    (isComplete ? plan.summary : null) ?? plan.goal,
    message.mentions ?? [],
    { dropUnresolvedMentions: true }
  )

  return (
    <div
      className={cn(
        "group/plan",
        SURFACE_CLASS,
        isOpenThread ? "border-foreground/25" : "hover:bg-muted/30"
      )}
    >
      {onOpenThread && (
        <button
          type="button"
          aria-label="Open plan thread"
          onClick={() => onOpenThread(threadRootId)}
          className="absolute inset-0 z-10 cursor-pointer rounded-xl"
        />
      )}

      <div className="flex items-start justify-between gap-4 px-4 pt-4">
        <div className="min-w-0 space-y-1">
          <p className="text-pretty font-medium text-sm leading-5">
            {plan.title}
          </p>
          {description && (
            <p className="line-clamp-2 text-pretty text-muted-foreground text-sm leading-5">
              {description}
            </p>
          )}
        </div>
        {isComplete ? (
          <HugeiconsIcon
            icon={CheckmarkCircle02Icon}
            size={18}
            className="mt-0.5 shrink-0 text-primary"
          />
        ) : (
          <Badge variant={meta.badgeVariant} size="sm" className="shrink-0">
            <HugeiconsIcon
              icon={meta.icon}
              size={12}
              className={meta.spin ? "animate-spin" : undefined}
            />
            {meta.label}
          </Badge>
        )}
      </div>

      <div className="px-4 pb-4">
        {/* The recessed plan well only exists when there's something to show —
            a step-less parked plan otherwise renders an empty gray bar. */}
        {(plan.steps.length > 0 || plan.status === "running") && (
          <div className="mt-4 min-w-0 rounded-lg bg-secondary/60 px-4 py-3.5 ring-1 ring-border/40 ring-inset">
            {plan.steps.length > 1 && <PlanStepProgress items={plan.steps} />}
            {plan.steps.length > 0 && (
              <PlanStepList
                items={plan.steps}
                className={plan.steps.length > 1 ? "mt-4" : undefined}
              />
            )}
            {plan.status === "running" && plan.steps.length === 0 && (
              <p className="shimmer text-muted-foreground text-sm">
                Lor is working…
              </p>
            )}
          </div>
        )}

        {artifacts && artifacts.length > 0 && (
          <div className="relative z-20 mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {artifacts.map((artifact) => (
              <ArtifactFileCard
                key={artifact.id}
                artifactId={artifact.id}
                name={artifact.path}
                contentType={artifact.mime}
                size={artifact.size}
                variant="chip"
                className="w-full max-w-none"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
