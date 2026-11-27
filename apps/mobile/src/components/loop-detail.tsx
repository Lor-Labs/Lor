import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon"
import ArrowUpRight01Icon from "@hugeicons/core-free-icons/ArrowUpRight01Icon"
import CheckmarkCircle02Icon from "@hugeicons/core-free-icons/CheckmarkCircle02Icon"
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon"
import DiscordIcon from "@hugeicons/core-free-icons/DiscordIcon"
import PauseIcon from "@hugeicons/core-free-icons/PauseIcon"
import PlayIcon from "@hugeicons/core-free-icons/PlayIcon"
import Refresh01Icon from "@hugeicons/core-free-icons/Refresh01Icon"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native"
import { describeLoopSchedule } from "@repo/realtime-types/loops"
import { useQuery } from "@tanstack/react-query"
import { router } from "expo-router"
import { useThemeColor } from "heroui-native/hooks"
import { type ReactNode, useState } from "react"
import { Alert, ScrollView, Text, View } from "react-native"
import { AgentCreature } from "@/components/agent-creature"
import { LoopStatusChip } from "@/components/loop-card"
import { PickerSheet } from "@/components/picker-sheet"
import { Button } from "@/components/ui/button"
import { triggerHaptic } from "@/components/ui/haptics"
import { PressableRow } from "@/components/ui/pressable-row"
import { PressableScale } from "@/components/ui/pressable-scale"
import { useWorkspace } from "@/context/workspace-context"
import { agentCreature, useAgents } from "@/hooks/use-agents"
import { usePlaceChats } from "@/hooks/use-chats"
import {
  type LoopRun,
  useActivateLoop,
  useDeleteLoop,
  useLoopLifecycle,
  useLoopRuns,
  useRunLoopNow,
  useSetLoopPlace,
} from "@/hooks/use-loops"
import type { ChannelLoop } from "@/lib/api-types"
import {
  openTextChannels,
  workspaceChannelsQueryOptions,
} from "@/lib/workspace-channels"

const PAUSED_REASON_LABEL: Record<string, string> = {
  manual: "Paused by the team",
  failures: "Paused after repeated failures",
  out_of_credits: "Paused: the workspace is out of credits",
  agent_left: "Paused when its agent left this chat",
  chat_archived: "Paused while its chat is archived",
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

// A loop's page body: what it does, when it runs, who runs it and where it
// reports, how its recent runs went, and the controls to pause, resume, run
// now, complete or delete it. The prompt and schedule are read here and
// edited on the web. Mirrors web's loop panel (loop-panel.tsx).
export function LoopDetail({ loop }: { loop: ChannelLoop }) {
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
  const scheduleText = describeLoopSchedule(loop.schedule, loop.timezone)
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
      "This removes the loop and its card for good. Past runs stay in the chat's history.",
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

      <RunBy loop={loop} />

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
          <DetailRow label="Repeats">
            {/* The time zone has its own row below. */}
            {describeLoopSchedule(loop.schedule, null)}
          </DetailRow>
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
            ) : runs.isError ? (
              <PressableRow
                accessibilityRole="button"
                className="px-three py-three"
                highlightClassName="rounded-none"
                onPress={() => void runs.refetch()}
              >
                <Text className="text-[15px] text-muted">
                  Couldn't load the runs.{" "}
                  <Text className="font-semibold text-accent">Try again</Text>
                </Text>
              </PressableRow>
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

const NO_CHAT = "none"

// Who runs the Loop and where it reports (reference/agents-and-chats.md
// §9). It is its agent's: a person can hand it to another agent in the same
// chat. The chat is optional: with none the Loop is the agent's work across
// its chats. Discord channels agents are in can be reported in too
// (decision 51). Not shown for a Loop in a channel that is not a chat.
function RunBy({ loop }: { loop: ChannelLoop }) {
  const muted = useThemeColor("muted")
  const { workspace } = useWorkspace()
  const workspaceSlug = workspace?.slug ?? ""
  const agents = useAgents(workspaceSlug)
  const { data: list } = useQuery(workspaceChannelsQueryOptions(workspaceSlug))
  const places = usePlaceChats(workspaceSlug, true)
  const place = useSetLoopPlace(loop)
  const [picking, setPicking] = useState<"agent" | "chat" | null>(null)
  if (!list || places.isPending) return null
  const chats = [
    ...openTextChannels(list).map((chat) => ({
      id: chat.id,
      name: chat.name,
      agentIds: chat.agentIds,
      discord: false,
    })),
    ...(places.data ?? []).map((chat) => ({
      id: chat.id,
      name: chat.name,
      agentIds: chat.agentIds,
      discord: true,
    })),
  ]
  const spotName = (spot: (typeof chats)[number]) =>
    spot.discord
      ? `#${spot.name ?? "channel"} in Discord`
      : (spot.name ?? "Chat")
  const chat = chats.find((item) => item.id === loop.channelId) ?? null
  if (loop.channelId && !chat) return null
  const owner = agents.find((agent) => agent.id === loop.agentId) ?? null
  const candidates = chat
    ? agents.filter((agent) => chat.agentIds.includes(agent.id))
    : agents
  if (!owner && candidates.length === 0) return null
  const gone = owner !== null && chat !== null && !candidates.includes(owner)
  const editable = loop.status !== "completed"
  const canHandOver =
    editable && candidates.some((agent) => agent.id !== owner?.id)
  // It can report in any chat its agent is in; one its agent left stays
  // listed until it is moved.
  const ownerChats = owner
    ? chats.filter(
        (item) => item.agentIds.includes(owner.id) || item.id === chat?.id
      )
    : chats
  const who = owner?.name ?? "The agent"

  return (
    <Section title="Run by">
      <View className="overflow-hidden rounded-lor-md border border-border bg-surface">
        <PressableRow
          accessibilityHint={
            canHandOver ? "Hands it to another agent" : undefined
          }
          accessibilityLabel={`Agent, ${owner?.name ?? "nobody yet"}`}
          accessibilityRole={canHandOver ? "button" : "text"}
          className="min-h-12 flex-row items-center gap-three border-b border-separator px-three py-two"
          disabled={!canHandOver}
          highlightClassName="rounded-none"
          onPress={() => {
            triggerHaptic("selection")
            setPicking("agent")
          }}
        >
          <Text className="text-[15px] text-muted">Agent</Text>
          <View className="min-w-0 flex-1 flex-row items-center justify-end gap-two">
            {owner ? (
              <AgentCreature creature={agentCreature(owner)} size={20} still />
            ) : null}
            <Text
              className="shrink text-[15px] text-foreground"
              numberOfLines={1}
            >
              {owner?.name ?? "Nobody yet"}
            </Text>
          </View>
          {canHandOver ? (
            <HugeiconsIcon color={muted} icon={ArrowRight01Icon} size={15} />
          ) : null}
        </PressableRow>
        <PressableRow
          accessibilityHint={editable ? "Moves where it reports" : undefined}
          accessibilityLabel={`Reports in, ${chat ? spotName(chat) : "no chat"}`}
          accessibilityRole={editable ? "button" : "text"}
          className="min-h-12 flex-row items-center gap-three px-three py-two"
          disabled={!editable}
          highlightClassName="rounded-none"
          onPress={() => {
            triggerHaptic("selection")
            setPicking("chat")
          }}
        >
          <Text className="text-[15px] text-muted">Reports in</Text>
          <View className="min-w-0 flex-1 flex-row items-center justify-end gap-two">
            {chat?.discord ? (
              <HugeiconsIcon color={muted} icon={DiscordIcon} size={15} />
            ) : null}
            <Text
              className="shrink text-[15px] text-foreground"
              numberOfLines={1}
            >
              {chat
                ? chat.discord
                  ? `#${chat.name ?? "channel"}`
                  : (chat.name ?? "Chat")
                : "No chat"}
            </Text>
          </View>
          {editable ? (
            <HugeiconsIcon color={muted} icon={ArrowRight01Icon} size={15} />
          ) : null}
        </PressableRow>
      </View>
      <Text className="px-one text-[13px] leading-[18px] text-muted">
        {gone
          ? `${who} is no longer in ${chat ? spotName(chat) : "this chat"}. Pick another agent, or another chat.`
          : chat
            ? `${who} posts each run's result in ${spotName(chat)}.`
            : `With no chat, ${who} posts a result in the chat it belongs to, or nowhere.`}
      </Text>
      <PickerSheet
        isOpen={picking === "agent"}
        onOpenChange={(isOpen) => setPicking(isOpen ? "agent" : null)}
        onPick={(agentId) => {
          setPicking(null)
          if (agentId !== owner?.id) {
            triggerHaptic("success")
            place.mutate({ agentId })
          }
        }}
        options={candidates.map((agent) => ({
          value: agent.id,
          label: agent.name,
          detail: agent.role ?? undefined,
        }))}
        selected={owner?.id ?? null}
        title="Run by"
      />
      <PickerSheet
        isOpen={picking === "chat"}
        onOpenChange={(isOpen) => setPicking(isOpen ? "chat" : null)}
        onPick={(value) => {
          setPicking(null)
          const channelId = value === NO_CHAT ? null : value
          if (channelId !== loop.channelId) {
            triggerHaptic("success")
            place.mutate({ channelId })
          }
        }}
        options={[
          ...ownerChats.map((item) => ({
            value: item.id,
            label: item.discord
              ? `#${item.name ?? "channel"}`
              : (item.name ?? "Chat"),
            detail: item.discord ? "Discord channel" : undefined,
          })),
          {
            value: NO_CHAT,
            label: "No chat",
            detail: "Its work across its chats",
          },
        ]}
        search={
          ownerChats.length > 8 ? { placeholder: "Find a chat" } : undefined
        }
        selected={loop.channelId ?? NO_CHAT}
        title="Reports in"
      />
    </Section>
  )
}
