import CheckmarkCircle02Icon from "@hugeicons/core-free-icons/CheckmarkCircle02Icon"
import CircleArrowRight02Icon from "@hugeicons/core-free-icons/CircleArrowRight02Icon"
import HelpCircleIcon from "@hugeicons/core-free-icons/HelpCircleIcon"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native"
import {
  differenceInMinutes,
  formatCallOffset,
  formatDateTime,
  formatDuration,
} from "@repo/utils/date"
import { useThemeColor } from "heroui-native/hooks"
import type { ReactNode } from "react"
import { Text, View } from "react-native"
import { Skeleton } from "@/components/ui/skeleton"
import { ParticipantStack } from "@/components/voice/voice-lobby"
import { useSummaryCard } from "@/hooks/use-call-summary"
import type { Message } from "@/lib/api-types"

const CARD = "mt-one rounded-lor-md bg-surface-secondary px-four py-three"

function SummaryRow({
  icon,
  color,
  atMs,
  children,
}: {
  icon: IconSvgElement
  color: string
  atMs: number | null
  children: ReactNode
}) {
  return (
    <View className="flex-row items-start gap-two py-one">
      <View className="pt-[2px]">
        <HugeiconsIcon color={color} icon={icon} size={16} strokeWidth={2} />
      </View>
      <View className="min-w-0 flex-1 gap-px">{children}</View>
      {atMs !== null ? (
        <Text className="pt-[2px] text-xs text-muted tabular-nums">
          {formatCallOffset(atMs)}
        </Text>
      ) : null}
    </View>
  )
}

function SummarySection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <View className="gap-one">
      <Text className="text-xs font-medium text-muted">{title}</Text>
      <View>{children}</View>
    </View>
  )
}

// Lor's summary of an ended call, posted in its chat. Read-only on the phone;
// it draws the call's current summary, so edits made on web show here too.
export function CallSummaryCard({ message }: { message: Message }) {
  const { data, isPending, isError } = useSummaryCard(message.id)
  const [success, warning, accent, surfaceSecondary] = useThemeColor([
    "success",
    "warning",
    "accent",
    "surface-secondary",
  ])

  if (isPending) {
    return (
      <View className={`${CARD} gap-two`}>
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-32" />
        <Skeleton className="mt-two h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
      </View>
    )
  }
  // The posted text stands in when the card can't load.
  if (isError) {
    return (
      <Text className="text-[15px] leading-[22px] text-foreground">
        {message.content}
      </Text>
    )
  }

  const { call, summary } = data
  const day = new Date(call.startedAt).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  })
  const length = call.endedAt
    ? formatDuration(differenceInMinutes(call.startedAt, call.endedAt))
    : null

  return (
    <View className={CARD}>
      <View className="flex-row items-start gap-three">
        <View className="min-w-0 flex-1 gap-px">
          <Text className="text-[16px] font-semibold leading-[21px] text-foreground">
            {summary?.title ?? "Call summary"}
          </Text>
          <Text className="text-xs text-muted">
            {[day, length].filter(Boolean).join(" · ")}
          </Text>
        </View>
        <ParticipantStack
          participants={call.participants}
          ringColor={surfaceSecondary}
        />
      </View>

      {summary ? (
        <View className="mt-four gap-four">
          <Text className="text-[15px] leading-[22px] text-foreground/90">
            {summary.summary}
          </Text>
          {summary.decisions.length > 0 ? (
            <SummarySection title="Decisions">
              {summary.decisions.map((item) => (
                <SummaryRow
                  atMs={item.atMs}
                  color={success}
                  icon={CheckmarkCircle02Icon}
                  key={`${item.atMs}-${item.text}`}
                >
                  <Text className="text-[15px] leading-[21px] text-foreground">
                    {item.text}
                  </Text>
                </SummaryRow>
              ))}
            </SummarySection>
          ) : null}
          {summary.openQuestions.length > 0 ? (
            <SummarySection title="Open questions">
              {summary.openQuestions.map((item) => (
                <SummaryRow
                  atMs={item.atMs}
                  color={warning}
                  icon={HelpCircleIcon}
                  key={`${item.atMs}-${item.text}`}
                >
                  <Text className="text-[15px] leading-[21px] text-foreground">
                    {item.text}
                  </Text>
                </SummaryRow>
              ))}
            </SummarySection>
          ) : null}
          {summary.actionItems.length > 0 ? (
            <SummarySection title="Action items">
              {summary.actionItems.map((item) => (
                <SummaryRow
                  atMs={item.atMs}
                  color={accent}
                  icon={CircleArrowRight02Icon}
                  key={`${item.atMs}-${item.title}`}
                >
                  <Text className="text-[15px] leading-[21px] text-foreground">
                    {item.owner ? (
                      <Text className="font-semibold">{item.owner}: </Text>
                    ) : null}
                    {item.title}
                  </Text>
                  {item.detail ? (
                    <Text className="text-[13px] leading-[18px] text-muted">
                      {item.detail}
                    </Text>
                  ) : null}
                </SummaryRow>
              ))}
            </SummarySection>
          ) : null}
          <Text className="text-xs text-muted" numberOfLines={1}>
            {data.editedAt
              ? `Edited by ${data.editedBy?.name ?? "someone"} · ${formatDateTime(data.editedAt)}`
              : "Written by Lor"}
          </Text>
        </View>
      ) : (
        <Text className="mt-four text-[15px] leading-[22px] text-muted">
          Lor couldn't write a summary for this call. Its transcript is indexed,
          so you can still ask Lor about it.
        </Text>
      )}
    </View>
  )
}
