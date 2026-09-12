import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useThemeColor } from "heroui-native/hooks"
import { Popover } from "heroui-native/popover"
import { type ReactNode, useMemo, useState } from "react"
import { Text, View } from "react-native"
import { ApprovalGateCard } from "@/components/approval-card"
import { MerlinToolTrail } from "@/components/merlin-tool-trail"
import {
  TaskFileRow,
  TaskPlanList,
  TaskStatusBadge,
} from "@/components/task-ui"
import { useTask, useTaskArtifacts, useTaskForThread } from "@/hooks/use-tasks"
import type { Message } from "@/lib/api-types"
import type { MerlinToolCall } from "@/lib/merlin"

export type TaskSourceFile = {
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
// web's thread-work-header). Status + Plan/Files popover chips when a task
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
  sources: TaskSourceFile[]
  activityMessage: Message | null
}) {
  const task = useTaskForThread(channelId, threadRootId)
  const { data: detail } = useTask(task?.id ?? null)
  const { data: artifacts } = useTaskArtifacts(task?.id ?? null)

  const { activityCalls, childrenByParent } = useMemo(() => {
    const topLevel: MerlinToolCall[] = []
    const children = new Map<string, MerlinToolCall[]>()
    for (const call of activityMessage?.merlinToolCalls ?? []) {
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
  const doneCount = !task
    ? 0
    : task.status === "completed"
      ? task.plan.length
      : task.plan.filter((item) => item.status === "done").length
  const fileCount = outputs.length + sources.length
  const showPlan = !!task && task.plan.length > 0
  const showFiles = !!task && fileCount > 0
  const showActivity = activityCalls.length > 0

  if (!showPlan && !showFiles && !showActivity && !pendingApproval) return null

  return (
    <View className="gap-two border-b border-separator px-four pb-three">
      <View className="flex-row flex-wrap items-center gap-two">
        {task ? <TaskStatusBadge status={task.status} /> : null}
        {task && showPlan ? (
          <SectionPopover label={`Plan · ${doneCount}/${task.plan.length}`}>
            {() => <TaskPlanList items={task.plan} />}
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
                      <TaskFileRow
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
                      <TaskFileRow
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
