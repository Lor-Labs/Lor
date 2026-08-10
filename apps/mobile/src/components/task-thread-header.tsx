import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useThemeColor } from "heroui-native/hooks"
import { Popover } from "heroui-native/popover"
import type { ReactNode } from "react"
import { Text, View } from "react-native"
import {
  TaskFileRow,
  TaskPlanList,
  TaskStatusBadge,
} from "@/components/task-ui"
import { Button } from "@/components/ui/button"
import {
  useResolveApproval,
  useTask,
  useTaskArtifacts,
  useTaskForCard,
} from "@/hooks/use-tasks"
import type { TaskApproval } from "@/lib/api-types"

export type TaskSourceFile = {
  url: string
  filename: string
  size: number
}

function ApprovalCard({
  taskId,
  approval,
}: {
  taskId: string
  approval: TaskApproval
}) {
  const resolve = useResolveApproval(taskId)
  return (
    <View className="gap-two rounded-lor-sm bg-warning-soft p-three">
      <Text className="text-sm font-semibold text-foreground">
        Merlin asks for approval
      </Text>
      <Text className="text-sm leading-5 text-muted">
        {approval.description}
      </Text>
      <View className="flex-row gap-two pt-one">
        <Button
          isDisabled={resolve.isPending}
          onPress={() =>
            resolve.mutate({ approvalId: approval.id, resolution: "approve" })
          }
          size="sm"
        >
          {resolve.isPending ? "Working…" : "Approve"}
        </Button>
        <Button
          isDisabled={resolve.isPending}
          onPress={() =>
            resolve.mutate({ approvalId: approval.id, resolution: "reject" })
          }
          size="sm"
          variant="secondary"
        >
          Reject
        </Button>
      </View>
    </View>
  )
}

// Anchored popover chip — the mobile analogue of web's Plan/Files popovers.
function SectionPopover({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  const muted = useThemeColor("muted")
  return (
    <Popover>
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
          {children}
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
            <TaskPlanList items={task.plan} />
          </SectionPopover>
        ) : null}
        {showFiles ? (
          <SectionPopover label={`Files · ${fileCount}`}>
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
                      size={source.size}
                      url={source.url}
                    />
                  ))}
                </View>
              ) : null}
            </View>
          </SectionPopover>
        ) : null}
      </View>
      {pendingApproval ? (
        <ApprovalCard approval={pendingApproval} taskId={task.id} />
      ) : null}
    </View>
  )
}
