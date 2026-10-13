import { ArrowRight01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Popover,
  PopoverPopup,
  PopoverTrigger,
} from "@repo/ui/components/popover"
import { useMemo } from "react"
import { ApprovalGateCard } from "@/components/chat/approval-card"
import {
  ArtifactFileCard,
  UploadFileCard,
} from "@/components/chat/artifact-file-card"
import { LorToolTrail } from "@/components/chat/lor-tool-trail"
import { PlanStepList } from "@/components/chat/plan-step-list"
import { MorphText } from "@/components/ui/morph-text"
import { usePlanForThread } from "@/hooks/use-channel-plans"
import { usePlan, usePlanArtifacts } from "@/hooks/use-plan"
import type { LorToolCallView, Message } from "@/lib/api-types"

export type PlanSourceFile = {
  url: string
  filename: string
  size: number
  contentType: string
}

export type WorkOutputFile = {
  id: string
  path: string
  mime: string
  size: number | null
}

const SECTION_TRIGGER_CLASS =
  "group flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground data-popup-open:bg-foreground/5 data-popup-open:text-foreground"

function SectionChevron() {
  return (
    <HugeiconsIcon
      icon={ArrowRight01Icon}
      className="size-3 transition-transform group-data-popup-open:rotate-90"
      strokeWidth={2}
    />
  )
}

export function WorkFileList({
  outputs,
  sources,
}: {
  outputs: WorkOutputFile[]
  sources: PlanSourceFile[]
}) {
  return (
    <div className="space-y-2">
      {outputs.length > 0 && (
        <div className="space-y-1.5">
          {sources.length > 0 && (
            <p className="px-1 font-medium text-muted-foreground text-xs">
              Outputs
            </p>
          )}
          {outputs.map((artifact) => (
            <ArtifactFileCard
              key={artifact.id}
              artifactId={artifact.id}
              name={artifact.path}
              size={artifact.size}
              className="w-full"
            />
          ))}
        </div>
      )}
      {sources.length > 0 && (
        <div className="space-y-1.5">
          {outputs.length > 0 && (
            <p className="px-1 font-medium text-muted-foreground text-xs">
              Sources
            </p>
          )}
          {sources.map((source) => (
            <UploadFileCard
              key={source.url}
              name={source.filename}
              size={source.size}
              url={source.url}
              className="w-full"
            />
          ))}
        </div>
      )}
    </div>
  )
}

// A thread's plan, plan outputs and newest tool trail: the docked work header
// in a thread, the rail in a session.
export function useThreadWork(
  channelId: string,
  threadRootId: string,
  activityMessage: Message | null
) {
  const plan = usePlanForThread(channelId, threadRootId)
  const { data: artifacts } = usePlanArtifacts(plan?.id ?? null)

  const { activityCalls, childrenByParent } = useMemo(() => {
    const topLevel: LorToolCallView[] = []
    const children = new Map<string, LorToolCallView[]>()
    for (const call of activityMessage?.lorToolCalls ?? []) {
      if (call.parentToolCallId) {
        const siblings = children.get(call.parentToolCallId) ?? []
        siblings.push(call)
        children.set(call.parentToolCallId, siblings)
      } else {
        topLevel.push(call)
      }
    }
    return { activityCalls: topLevel, childrenByParent: children }
  }, [activityMessage])

  const doneCount = !plan
    ? 0
    : plan.status === "completed"
      ? plan.steps.length
      : plan.steps.filter((item) => item.status === "done").length

  return {
    plan,
    outputs: artifacts ?? [],
    doneCount,
    activityCalls,
    childrenByParent,
    streaming: activityMessage?.status === "pending",
  }
}

// Docked strip under the thread panel header — the thread's work surface.
// Plan/Files popover chips (the anti-lost-in-scroll anchors) when a plan
// anchors to the thread, an Activity chip mirroring the newest run's tool
// trail whenever Lor is (or was) working here, and the pending approval
// card, always visible. Renders a bare border when idle so the panel header's
// border-b-0 always has an edge under it.
export function ThreadWorkHeader({
  channelId,
  threadRootId,
  sources,
  activityMessage,
}: {
  channelId: string
  threadRootId: string
  sources: PlanSourceFile[]
  activityMessage: Message | null
}) {
  const {
    plan,
    outputs,
    doneCount,
    activityCalls,
    childrenByParent,
    streaming,
  } = useThreadWork(channelId, threadRootId, activityMessage)
  const { data: detail } = usePlan(plan?.id ?? null)

  const pendingApproval =
    detail?.pendingApproval?.status === "pending"
      ? detail.pendingApproval
      : null
  const fileCount = outputs.length + sources.length
  const showPlan = !!plan && plan.steps.length > 0
  const showFiles = !!plan && fileCount > 0
  const showActivity = activityCalls.length > 0

  if (!showPlan && !showFiles && !showActivity && !pendingApproval) {
    return <div className="shrink-0 border-b" />
  }

  return (
    <div className="shrink-0 border-b px-3 pb-2">
      {(showPlan || showFiles || showActivity) && (
        <div className="-ml-0.5 flex items-center gap-1">
          {plan && showPlan && (
            <Popover>
              <PopoverTrigger className={SECTION_TRIGGER_CLASS}>
                <SectionChevron />
                <MorphText>{`Steps · ${doneCount}/${plan.steps.length}`}</MorphText>
              </PopoverTrigger>
              <PopoverPopup
                side="bottom"
                align="start"
                className="w-80"
                viewportClassName="p-3"
              >
                <PlanStepList items={plan.steps} />
              </PopoverPopup>
            </Popover>
          )}
          {showFiles && (
            <Popover>
              <PopoverTrigger className={SECTION_TRIGGER_CLASS}>
                <SectionChevron />
                {`Files · ${fileCount}`}
              </PopoverTrigger>
              <PopoverPopup
                side="bottom"
                align="start"
                className="w-80"
                viewportClassName="p-3"
              >
                <WorkFileList outputs={outputs} sources={sources} />
              </PopoverPopup>
            </Popover>
          )}
          {showActivity && (
            <Popover>
              <PopoverTrigger className={SECTION_TRIGGER_CLASS}>
                <SectionChevron />
                {streaming ? (
                  <span className="shimmer">Working…</span>
                ) : (
                  `Activity · ${activityCalls.length}`
                )}
              </PopoverTrigger>
              <PopoverPopup
                side="bottom"
                align="start"
                className="w-96"
                viewportClassName="p-3"
              >
                <div className="max-h-96 overflow-y-auto">
                  <LorToolTrail
                    toolCalls={activityCalls}
                    childrenByParent={childrenByParent}
                    streaming={streaming}
                    embedded
                  />
                </div>
              </PopoverPopup>
            </Popover>
          )}
        </div>
      )}
      {pendingApproval && (
        <div className="mt-2">
          <ApprovalGateCard
            channelId={channelId}
            threadRootId={threadRootId}
            approval={pendingApproval}
          />
        </div>
      )}
    </div>
  )
}
