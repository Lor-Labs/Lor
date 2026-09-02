import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useThemeColor } from "heroui-native/hooks"
import { Popover } from "heroui-native/popover"
import { type ReactNode, useState } from "react"
import { Text, View } from "react-native"
import { ApprovalGateCard } from "@/components/approval-card"
import {
  TaskFileRow,
  TaskPlanList,
  TaskStatusBadge,
} from "@/components/task-ui"
import { useTask, useTaskArtifacts, useTaskForCard } from "@/hooks/use-tasks"

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

// Docked strip under the thread header when the root is a task card: status,
// Plan/Files popover chips (Outputs = artifacts, Sources = thread uploads),
// and the pending approval card, which is always visible.
export function TaskThreadHeader({
  channelId,
  cardMessageId,
  sources,
}: {
  channelId: string
  cardMessageId: string
  sources: TaskSourceFile[]
}) {
  const task = useTaskForCard(channelId, cardMessageId)
  const { data: detail } = useTask(task?.id ?? null)
  const { data: artifacts } = useTaskArtifacts(task?.id ?? null)

  if (!task) return null

  const pendingApproval =
    detail?.pendingApproval?.status === "pending"
      ? detail.pendingApproval
      : null
  const outputs = artifacts ?? []
  const doneCount = task.plan.filter((item) => item.status === "done").length
  const fileCount = outputs.length + sources.length
  const showPlan = task.plan.length > 0
  const showFiles = fileCount > 0

  if (!showPlan && !showFiles && !pendingApproval) return null

  return (
    <View className="gap-two border-b border-separator px-four pb-three">
      <View className="flex-row items-center gap-two">
        <TaskStatusBadge status={task.status} />
        {showPlan ? (
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
      </View>
      {pendingApproval ? (
        <ApprovalGateCard approval={pendingApproval} channelId={channelId} />
      ) : null}
    </View>
  )
}
