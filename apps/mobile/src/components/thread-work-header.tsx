import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useThemeColor } from "heroui-native/hooks"
import { Popover } from "heroui-native/popover"
import { type ReactNode, useMemo, useState } from "react"
import { Text, View } from "react-native"
import { ApprovalGateCard } from "@/components/approval-card"
import { MerlinToolTrail } from "@/components/merlin-tool-trail"
import {
  PlanFileRow,
  PlanStatusBadge,
  PlanStepList,
} from "@/components/plan-ui"
import { usePlan, usePlanArtifacts, usePlanForThread } from "@/hooks/use-plans"
import type { Message } from "@/lib/api-types"
import type { MerlinToolCall } from "@/lib/merlin"

export type PlanSourceFile = {
  url: string
  filename: string
  size: number
}

// Anchored popover chip — the mobile analogue of web's Plan/Files popovers.
// Controlled so content actions (opening a file) can close it.
function SectionPopover({
  label,
  children,
}: {
  label: string
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const muted = useThemeColor("muted")
  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      <Popover.Trigger className="min-h-7 flex-row items-center gap-one rounded-lor-sm px-two py-one">
        <HugeiconsIcon color={muted} icon={ArrowRight01Icon} size={12} />
        <Text className="text-xs font-medium text-muted">{label}</Text>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Overlay />
        <Popover.Content
          align="start"
          className="p-three"
          offset={6}
          placement="bottom"
          presentation="popover"
          width={300}
        >
          {children(() => setOpen(false))}
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  )
}

// Docked strip under the thread header — the thread's work surface (mirrors
// web's thread-work-header). Status + Plan/Files popover chips when a plan
// anchors to the thread, an Activity chip mirroring the newest run's tool
// trail whenever Merlin worked here, and the pending approval card, which is
// always visible.
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
  const plan = usePlanForThread(channelId, threadRootId)
  const { data: detail } = usePlan(plan?.id ?? null)
  const { data: artifacts } = usePlanArtifacts(plan?.id ?? null)

  const { activityCalls, childrenByParent } = useMemo(() => {
    const topLevel: MerlinToolCall[] = []
    const children = new Map<string, MerlinToolCall[]>()
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
  const streaming = activityMessage?.status === "pending"

  const pendingApproval =
    detail?.pendingApproval?.status === "pending"
      ? detail.pendingApproval
      : null
  const outputs = artifacts ?? []
  const doneCount = !plan
    ? 0
    : plan.status === "completed"
      ? plan.steps.length
      : plan.steps.filter((item) => item.status === "done").length
  const fileCount = outputs.length + sources.length
  const showPlan = !!plan && plan.steps.length > 0
  const showFiles = !!plan && fileCount > 0
  const showActivity = activityCalls.length > 0

  if (!showPlan && !showFiles && !showActivity && !pendingApproval) return null

  return (
    <View className="gap-two border-b border-separator px-four pb-three">
      <View className="flex-row flex-wrap items-center gap-two">
        {plan ? <PlanStatusBadge status={plan.status} /> : null}
        {plan && showPlan ? (
          <SectionPopover label={`Steps · ${doneCount}/${plan.steps.length}`}>
            {() => <PlanStepList items={plan.steps} />}
          </SectionPopover>
        ) : null}
        {showFiles ? (
          <SectionPopover label={`Files · ${fileCount}`}>
            {(close) => (
              <View className="gap-two">
                {outputs.length > 0 ? (
                  <View className="gap-one">
                    {sources.length > 0 ? (
                      <Text className="text-xs font-semibold text-muted">
                        Outputs
                      </Text>
                    ) : null}
                    {outputs.map((artifact) => (
                      <PlanFileRow
                        key={artifact.id}
                        name={artifact.path}
                        onOpen={close}
                        size={artifact.size}
                        url={artifact.url}
                      />
                    ))}
                  </View>
                ) : null}
                {sources.length > 0 ? (
                  <View className="gap-one">
                    {outputs.length > 0 ? (
                      <Text className="text-xs font-semibold text-muted">
                        Sources
                      </Text>
                    ) : null}
                    {sources.map((source) => (
                      <PlanFileRow
                        key={source.url}
                        name={source.filename}
                        onOpen={close}
                        size={source.size}
                        url={source.url}
                      />
                    ))}
                  </View>
                ) : null}
              </View>
            )}
          </SectionPopover>
        ) : null}
        {showActivity ? (
          <SectionPopover
            label={
              streaming ? "Working…" : `Activity · ${activityCalls.length}`
            }
          >
            {() => (
              <MerlinToolTrail
                childrenByParent={childrenByParent}
                embedded
                streaming={streaming}
                toolCalls={activityCalls}
              />
            )}
          </SectionPopover>
        ) : null}
      </View>
      {pendingApproval ? (
        <ApprovalGateCard approval={pendingApproval} channelId={channelId} />
      ) : null}
    </View>
  )
}
