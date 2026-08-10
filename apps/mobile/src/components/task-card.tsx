import CheckListIcon from "@hugeicons/core-free-icons/CheckListIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useThemeColor } from "heroui-native/hooks"
import { Pressable, Text, View } from "react-native"
import {
  TaskFileRow,
  TaskPlanList,
  TaskStatusBadge,
} from "@/components/task-ui"
import { useTaskArtifacts, useTaskForCard } from "@/hooks/use-tasks"
import type { Message } from "@/lib/api-types"

// The card a task_card message renders as — mobile mirror of web's coss-Frame
// card: "Task" chrome + status, title, live plan, deliverered files. Tapping
// it opens the task's thread.
export function TaskCard({
  message,
  onOpenThread,
}: {
  message: Message
  onOpenThread?: (message: Message) => void
}) {
  const muted = useThemeColor("muted")
  const task = useTaskForCard(message.channelId, message.id)
  const { data: artifacts } = useTaskArtifacts(task?.id ?? null)

  const header = (
    <View className="flex-row items-center gap-two px-three pt-two">
      <HugeiconsIcon color={muted} icon={CheckListIcon} size={14} />
      <Text className="text-xs font-semibold text-muted">Task</Text>
      <View className="flex-1" />
      {task ? <TaskStatusBadge status={task.status} /> : null}
    </View>
  )

  return (
    <Pressable
      accessibilityLabel="Open task thread"
      accessibilityRole={onOpenThread ? "button" : undefined}
      className="mt-one max-w-[420px] rounded-lor-sm border border-border bg-surface-secondary pb-three"
      disabled={!onOpenThread}
      onPress={() => onOpenThread?.(message)}
    >
      {header}
      <View className="gap-two px-three pt-two">
        <Text className="text-[15px] font-semibold leading-5 text-foreground">
          {task?.title ?? message.content ?? "Task"}
        </Text>
        {task && task.plan.length > 0 ? (
          <TaskPlanList items={task.plan} />
        ) : null}
        {task?.status === "running" && task.plan.length === 0 ? (
          <Text className="text-sm italic text-muted">Merlin is working…</Text>
        ) : null}
        {task?.status === "completed" && task.summary ? (
          <View className="border-t border-separator pt-two">
            <Text className="text-sm leading-5 text-muted">{task.summary}</Text>
          </View>
        ) : null}
        {artifacts && artifacts.length > 0 ? (
          <View className="gap-one">
            {artifacts.map((artifact) => (
              <TaskFileRow
                key={artifact.id}
                name={artifact.path}
                size={artifact.size}
                url={artifact.url}
              />
            ))}
          </View>
        ) : null}
      </View>
    </Pressable>
  )
}
