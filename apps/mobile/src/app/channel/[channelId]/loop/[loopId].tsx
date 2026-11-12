import ArrowUpRight01Icon from "@hugeicons/core-free-icons/ArrowUpRight01Icon"
import CheckmarkCircle02Icon from "@hugeicons/core-free-icons/CheckmarkCircle02Icon"
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon"
import PauseIcon from "@hugeicons/core-free-icons/PauseIcon"
import PlayIcon from "@hugeicons/core-free-icons/PlayIcon"
import Refresh01Icon from "@hugeicons/core-free-icons/Refresh01Icon"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native"
import { describeLoopSchedule } from "@repo/realtime-types/loops"
import { router, useLocalSearchParams } from "expo-router"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import type { ReactNode } from "react"
import { Alert, ScrollView, Text, View } from "react-native"
import { LoopStatusChip } from "@/components/loop-card"
import { Button } from "@/components/ui/button"
import { triggerHaptic } from "@/components/ui/haptics"
import { PressableRow } from "@/components/ui/pressable-row"
import { PressableScale } from "@/components/ui/pressable-scale"
import { Screen } from "@/components/ui/screen"
import { ScreenHeader } from "@/components/ui/screen-header"
import { StatePanel } from "@/components/ui/state-panel"
import { useWorkspace } from "@/context/workspace-context"
import { useChannelDetail } from "@/hooks/use-channel-detail"
import {
  type LoopRun,
  useActivateLoop,
  useChannelLoops,
  useDeleteLoop,
  useLoopLifecycle,
  useLoopRuns,
  useRunLoopNow,
} from "@/hooks/use-loops"
import type { ChannelLoop } from "@/lib/api-types"

const PAUSED_REASON_LABEL: Record<string, string> = {
  manual: "Paused by the team",
  failures: "Paused after repeated failures",
  out_of_credits: "Paused: the workspace is out of credits",
}

// Completed is the expected outcome and wears no word; only the exceptions
// do.
const RUN_STATE_LABEL: Partial<Record<LoopRun["state"], string>> = {
  queued: "Queued",
  working: "Running",
  finalizing: "Running",
  failed: "Failed",
  stopped: "Stopped",
}

function formatRunTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function formatEndDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

// A loop's page: what it does, when it runs, how its recent runs went, and
// the controls to pause, resume, run now, complete or delete it. The prompt
// and schedule are read here and edited on the web. Mirrors web's loop
// panel (loop-panel.tsx).
export default function LoopScreen() {
  const { channelId, loopId } = useLocalSearchParams<{
    channelId: string
    loopId: string
  }>()
  const { workspace } = useWorkspace()
  const channelState = useChannelDetail({
    workspaceSlug: workspace?.slug ?? "",
    channelId: channelId ?? "",
  })
  const loops = useChannelLoops(channelId ?? "")
  const loop = loops.data?.find((item) => item.id === loopId) ?? null
  const channelName = channelState.channel?.name ?? "channel"
  const backToChannel = () =>
    channelId
      ? router.replace({
          pathname: "/channel/[channelId]",
          params: { channelId },
        })
      : router.replace("/")

  return (
    <Screen className="bg-background" edges={["top", "bottom"]}>
      <ScreenHeader
        onBack={backToChannel}
        subtitle={`#${channelName}`}
        title={loop?.name ?? "Loop"}
      />
      {loop ? (
        <LoopDetail loop={loop} />
      ) : loops.isPending ? (
        <View className="flex-1 items-center justify-center">
          <Spinner accessibilityLabel="Loading the loop" />
        </View>
      ) : (
        <StatePanel
          action={{ label: "Back to channel", onPress: backToChannel }}
          className="flex-1"
          detail="It may have been deleted."
          title="This loop is no longer available"
        />
      )}
    </Screen>
  )
}

function LoopDetail({ loop }: { loop: ChannelLoop }) {
  const [foreground, danger] = useThemeColor(["foreground", "danger"])
  const runs = useLoopRuns(loop)
  const lifecycle = useLoopLifecycle(loop)
  const runNow = useRunLoopNow(loop)
  const deleteLoop = useDeleteLoop(loop)
  const activate = useActivateLoop(loop)
  const sessionId = runs.data?.sessionId ?? null
  const openSession = sessionId
    ? () =>
        router.push({
          pathname: "/session/[sessionId]",
          params: { sessionId },
        })
    : undefined
  const scheduleText = describeLoopSchedule(loop.schedule, null)
  const busy = lifecycle.isPending || deleteLoop.isPending

  const confirmComplete = () =>
    Alert.alert(
      "Mark this loop completed?",
      "Completing is permanent: the loop never runs again. Pause it instead if you might want it back later.",
      [
        { style: "cancel", text: "Cancel" },
        { text: "Mark completed", onPress: () => lifecycle.mutate("complete") },
      ]
    )
  const confirmDelete = () =>
    Alert.alert(
      "Delete this loop?",
      "This removes the loop and its card from the channel permanently. Past run activity stays in the channel history.",
      [
        { style: "cancel", text: "Cancel" },
        {
          style: "destructive",
          text: "Delete loop",
          onPress: () => {
            // The loop leaves at once (a failure brings it back), so leave
            // its page now.
            deleteLoop.mutate()
            if (router.canGoBack()) router.back()
          },
        },
      ]
    )

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="gap-six px-four pb-eight pt-four"
      showsVerticalScrollIndicator={false}
    >
      <View className="gap-three">
        <View className="flex-row items-center gap-two">
          <LoopStatusChip status={loop.status} />
          <Text className="min-w-0 flex-1 text-[15px] text-foreground">
            {scheduleText}
          </Text>
        </View>
        {loop.status === "active" && loop.nextRunAt ? (
          <Text className="text-[13px] text-muted">
            Next run {formatRunTime(loop.nextRunAt)}
          </Text>
        ) : loop.status === "paused" ? (
          <Text className="text-[13px] text-muted">
            {(loop.pausedReason && PAUSED_REASON_LABEL[loop.pausedReason]) ??
              "Paused"}
          </Text>
        ) : null}
        {loop.status === "draft" ? (
          <Button
            className="self-start"
            isDisabled={activate.isPending}
            onPress={() => activate.mutate({})}
            size="sm"
          >
            {activate.isPending ? "Working…" : "Create Loop"}
          </Button>
        ) : loop.status === "completed" ? null : (
          <View className="flex-row flex-wrap gap-two">
            {loop.status === "active" ? (
              <LoopAction
                color={foreground}
                disabled={busy}
                icon={PauseIcon}
                label="Pause"
                onPress={() => {
                  triggerHaptic("light")
                  lifecycle.mutate("pause")
                }}
              />
            ) : (
              <LoopAction
                color={foreground}
                disabled={busy}
                icon={PlayIcon}
                label="Resume"
                onPress={() => {
                  triggerHaptic("light")
                  lifecycle.mutate("resume")
                }}
              />
            )}
            {loop.status === "active" ? (
              <LoopAction
                color={foreground}
                disabled={runNow.isPending}
                icon={Refresh01Icon}
                label={runNow.isPending ? "Starting…" : "Run now"}
                onPress={() => runNow.mutate()}
              />
            ) : null}
            {openSession ? (
              <LoopAction
                color={foreground}
                icon={ArrowUpRight01Icon}
                label="Open session"
                onPress={openSession}
              />
            ) : null}
          </View>
        )}
      </View>

      <Section title="Prompt">
        <View className="rounded-lor-md border border-border bg-surface px-three py-three">
          <Text
            className="text-[15px] leading-[22px] text-foreground"
            selectable
          >
            {loop.instructions}
          </Text>
        </View>
      </Section>

      <Section title="Schedule">
        <View className="overflow-hidden rounded-lor-md border border-border bg-surface">
          <DetailRow label="Repeats">{scheduleText}</DetailRow>
          <DetailRow label="Ends" last={!loop.timezone}>
            {loop.endAt
              ? `On ${formatEndDate(loop.endAt)}`
              : (loop.endCondition ?? "Never")}
          </DetailRow>
          {loop.timezone ? (
            <DetailRow label="Time zone" last>
              {loop.timezone}
            </DetailRow>
          ) : null}
        </View>
        <Text className="px-one text-[13px] leading-[18px] text-muted">
          The prompt and schedule can be changed on the web.
        </Text>
      </Section>

      {loop.status === "completed" && loop.completedNote ? (
        <Section title="Closing note">
          <View className="rounded-lor-md border border-border bg-surface px-three py-three">
            <Text className="text-[15px] leading-[22px] text-muted">
              {loop.completedNote}
            </Text>
          </View>
        </Section>
      ) : null}

      {loop.status === "draft" ? null : (
        <Section title="Recent runs">
          <View className="overflow-hidden rounded-lor-md border border-border bg-surface">
            {runs.isPending ? (
              <Text className="px-three py-three text-[15px] text-muted">
                Loading…
              </Text>
            ) : runs.data && runs.data.runs.length > 0 ? (
              runs.data.runs.map((run, index) => (
                <RunRow
                  key={run.id}
                  last={index === runs.data.runs.length - 1}
                  onOpen={run.inSession ? openSession : undefined}
                  run={run}
                />
              ))
            ) : (
              <Text className="px-three py-three text-[15px] text-muted">
                No runs yet.
              </Text>
            )}
          </View>
        </Section>
      )}

      <View className="overflow-hidden rounded-lor-md border border-border bg-surface">
        {loop.status === "active" || loop.status === "paused" ? (
          <PressableRow
            accessibilityRole="button"
            className="min-h-12 flex-row items-center gap-three border-b border-separator px-three"
            disabled={busy}
            highlightClassName="rounded-none"
            onPress={confirmComplete}
          >
            <HugeiconsIcon
              color={foreground}
              icon={CheckmarkCircle02Icon}
              size={18}
              strokeWidth={1.8}
            />
            <Text className="text-[15px] text-foreground">Mark completed</Text>
          </PressableRow>
        ) : null}
        <PressableRow
          accessibilityRole="button"
          className="min-h-12 flex-row items-center gap-three px-three"
          disabled={busy}
          highlightClassName="rounded-none"
          onPress={confirmDelete}
        >
          <HugeiconsIcon
            color={danger}
            icon={Delete02Icon}
            size={18}
            strokeWidth={1.8}
          />
          <Text className="text-[15px] text-danger">Delete loop</Text>
        </PressableRow>
      </View>
    </ScrollView>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-two">
      <Text className="px-one text-[13px] font-semibold leading-[18px] text-muted">
        {title}
      </Text>
      {children}
    </View>
  )
}

function DetailRow({
  label,
  children,
  last = false,
}: {
  label: string
  children: ReactNode
  last?: boolean
}) {
  return (
    <View
      className={`min-h-12 flex-row items-center gap-three px-three py-two ${
        last ? "" : "border-b border-separator"
      }`}
    >
      <Text className="text-[15px] text-muted">{label}</Text>
      <Text className="min-w-0 flex-1 text-right text-[15px] text-foreground">
        {children}
      </Text>
    </View>
  )
}

function LoopAction({
  color,
  disabled,
  icon,
  label,
  onPress,
}: {
  color: string
  disabled?: boolean
  icon: IconSvgElement
  label: string
  onPress: () => void
}) {
  return (
    <PressableScale
      accessibilityLabel={label}
      accessibilityRole="button"
      className="min-h-10 flex-row items-center gap-two rounded-full border border-border bg-surface px-four"
      disabled={disabled}
      onPress={onPress}
    >
      <HugeiconsIcon color={color} icon={icon} size={16} strokeWidth={2} />
      <Text className="text-[14px] font-semibold text-foreground">{label}</Text>
    </PressableScale>
  )
}

// One run: when it fired, how it went if not as expected, and its note. A
// run that answered in the loop's session opens it, where the full reply is.
function RunRow({
  run,
  last,
  onOpen,
}: {
  run: LoopRun
  last: boolean
  onOpen?: () => void
}) {
  const state = RUN_STATE_LABEL[run.state]
  const failed = run.state === "failed"
  const stopNote =
    run.stopReason && run.stopReason !== "completed"
      ? `Stopped: ${run.stopReason.replace(/_/g, " ")}`
      : null
  const content = (
    <>
      <View className="flex-row items-center gap-two">
        <Text
          className="min-w-0 shrink text-[15px] font-medium text-foreground"
          numberOfLines={1}
        >
          {formatRunTime(run.scheduledFor ?? run.createdAt)}
        </Text>
        {state ? (
          <Text
            className={`text-[13px] font-medium ${failed ? "text-danger" : "text-muted"}`}
          >
            {state}
          </Text>
        ) : null}
      </View>
      {run.note || stopNote ? (
        <Text
          className="text-[13px] leading-[18px] text-muted"
          numberOfLines={3}
        >
          {run.note ?? stopNote}
        </Text>
      ) : null}
    </>
  )
  const className = `gap-[2px] px-three py-three ${last ? "" : "border-b border-separator"}`
  if (!onOpen) return <View className={className}>{content}</View>
  return (
    <PressableRow
      accessibilityHint="Opens the loop's session"
      accessibilityRole="button"
      className={className}
      highlightClassName="rounded-none"
      onPress={onOpen}
    >
      {content}
    </PressableRow>
  )
}
