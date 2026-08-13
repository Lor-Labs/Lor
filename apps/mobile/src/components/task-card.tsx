import CheckmarkCircle02Icon from "@hugeicons/core-free-icons/CheckmarkCircle02Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useThemeColor } from "heroui-native/hooks"
import { Pressable, Text, View } from "react-native"
import { Shimmer } from "@/components/shimmer"
import {
  TaskFileRow,
  TaskPlanList,
  TaskPlanProgress,
  TaskStatusBadge,
} from "@/components/task-ui"
import { useTaskArtifacts, useTaskForCard } from "@/hooks/use-tasks"
import type { Message } from "@/lib/api-types"

// The card a task_card message renders as — mobile mirror of web: title and
// outcome up top, the live plan in a recessed well, delivered files underneath.
// No "Task" chrome strip; the title and steps already say what it is. Tapping
// opens the task's thread.
export function TaskCard({
  message,
  onOpenThread,
}: {
  message: Message
  onOpenThread?: (message: Message) => void
}) {
  const foreground = useThemeColor("foreground")
  const task = useTaskForCard(message.channelId, message.id)
  const { data: artifacts } = useTaskArtifacts(task?.id ?? null)

  const isComplete = task?.status === "completed"
  // One description slot, showing whatever matters most: the outcome once
  // delivered, otherwise the ask that started the task.
  const description = (isComplete ? task?.summary : null) ?? task?.goal

  return (
    <Pressable
      accessibilityLabel="Open task thread"
      accessibilityRole={onOpenThread ? "button" : undefined}
      className="mt-one max-w-[420px] rounded-lor-sm border border-border bg-surface pb-three"
      disabled={!onOpenThread}
      onPress={() => onOpenThread?.(message)}
    >
      <View className="flex-row items-start gap-two px-three pt-three">
        <View className="min-w-0 flex-1 gap-one">
          <Text className="text-[15px] font-semibold leading-5 text-foreground">
            {task?.title ?? message.content ?? "Task"}
          </Text>
          {description ? (
            <Text className="text-sm leading-5 text-muted" numberOfLines={2}>
              {description}
            </Text>
          ) : null}
        </View>
        {/* Status only when it's abnormal or needs someone; a completed task
            gets a quiet monochrome check instead of a green badge. */}
        {isComplete ? (
          <HugeiconsIcon
            color={foreground}
            icon={CheckmarkCircle02Icon}
            size={18}
          />
        ) : task ? (
          <TaskStatusBadge status={task.status} />
        ) : null}
      </View>

      {task ? (
        <View className="px-three pt-three">
          <View className="gap-three rounded-lor-sm bg-surface-secondary px-two py-two">
            {task.plan.length > 1 ? (
              <TaskPlanProgress items={task.plan} />
            ) : null}
            {task.plan.length > 0 ? <TaskPlanList items={task.plan} /> : null}
            {task.status === "running" && task.plan.length === 0 ? (
              <Shimmer>
                <Text className="text-sm italic text-muted">
                  Merlin is working…
                </Text>
              </Shimmer>
            ) : null}
          </View>

          {artifacts && artifacts.length > 0 ? (
            <View className="gap-one pt-two">
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
      ) : null}
    </Pressable>
  )
}
