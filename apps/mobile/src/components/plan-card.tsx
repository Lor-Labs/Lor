import CheckmarkCircle02Icon from "@hugeicons/core-free-icons/CheckmarkCircle02Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useThemeColor } from "heroui-native/hooks"
import { Pressable, Text, View } from "react-native"
import { FileChip } from "@/components/file-chip"
import {
  PlanStatusBadge,
  PlanStepList,
  PlanStepProgress,
} from "@/components/plan-ui"
import { Shimmer } from "@/components/shimmer"
import { usePlanArtifacts, usePlanForCard } from "@/hooks/use-plans"
import type { Message } from "@/lib/api-types"
import { openExternalUrl } from "@/lib/open-url"

// The card a plan_card message renders as — mobile mirror of web: title and
// outcome up top, the live plan in a recessed well, delivered files underneath.
// No "Plan" chrome strip; the title and steps already say what it is. Tapping
// opens the plan's thread.
export function PlanCard({
  message,
  onOpenThread,
}: {
  message: Message
  onOpenThread?: (message: Message) => void
}) {
  const foreground = useThemeColor("foreground")
  const plan = usePlanForCard(message.channelId, message.id)
  const { data: artifacts } = usePlanArtifacts(plan?.id ?? null)

  const isComplete = plan?.status === "completed"
  // One description slot, showing whatever matters most: the outcome once
  // delivered, otherwise the ask that started the plan.
  const description = (isComplete ? plan?.summary : null) ?? plan?.goal

  return (
    <Pressable
      accessibilityLabel="Open plan thread"
      accessibilityRole={onOpenThread ? "button" : undefined}
      className="mt-one max-w-[420px] rounded-lor-sm border border-border bg-surface pb-three"
      disabled={!onOpenThread}
      // The plan's anchor thread is no longer necessarily the card message;
      // handlers navigate by .id only, so hand them the root id.
      onPress={() =>
        onOpenThread?.(plan ? { ...message, id: plan.threadRootId } : message)
      }
    >
      <View className="flex-row items-start gap-two px-three pt-three">
        <View className="min-w-0 flex-1 gap-one">
          <Text className="text-[15px] font-semibold leading-5 text-foreground">
            {plan?.title ?? message.content ?? "Plan"}
          </Text>
          {description ? (
            <Text className="text-sm leading-5 text-muted" numberOfLines={2}>
              {description}
            </Text>
          ) : null}
        </View>
        {/* Status only when it's abnormal or needs someone; a completed plan
            gets a quiet monochrome check instead of a green badge. */}
        {isComplete ? (
          <HugeiconsIcon
            color={foreground}
            icon={CheckmarkCircle02Icon}
            size={18}
          />
        ) : plan ? (
          <PlanStatusBadge status={plan.status} />
        ) : null}
      </View>

      {plan ? (
        <View className="px-three pt-three">
          <View className="gap-three rounded-lor-sm bg-surface-secondary px-two py-two">
            {plan.steps.length > 1 ? (
              <PlanStepProgress items={plan.steps} />
            ) : null}
            {plan.steps.length > 0 ? <PlanStepList items={plan.steps} /> : null}
            {plan.status === "running" && plan.steps.length === 0 ? (
              <Shimmer>
                <Text className="text-sm italic text-muted">
                  Lor is working…
                </Text>
              </Shimmer>
            ) : null}
          </View>

          {artifacts && artifacts.length > 0 ? (
            <View className="gap-one pt-two">
              {artifacts.map(({ id, path, size, url }) => (
                <FileChip
                  key={id}
                  name={path}
                  onPress={url ? () => openExternalUrl(url) : undefined}
                  size={size}
                />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  )
}
