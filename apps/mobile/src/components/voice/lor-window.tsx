import AlertCircleIcon from "@hugeicons/core-free-icons/AlertCircleIcon"
import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon"
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useParticipants } from "@livekit/react-native"
import type { VoiceRequestState } from "@repo/realtime-types/events"
import { isActiveVoiceRequest } from "@repo/realtime-types/voice-requests"
import { useQueryClient } from "@tanstack/react-query"
import { SymbolView } from "expo-symbols"
import { useThemeColor } from "heroui-native/hooks"
import { useState } from "react"
import { Alert, ScrollView, Text, View } from "react-native"
import Animated, { Keyframe } from "react-native-reanimated"
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg"
import { ToolGlyph, toolKind } from "@/components/lor-tool-trail"
import { Shimmer } from "@/components/shimmer"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { LorBlocks } from "@/components/voice/lor-blocks"
import { resolveSimulatedApproval } from "@/components/voice/lor-simulator"
import {
  REACTION_MS,
  useLorReactions,
  useLorTools,
} from "@/components/voice/lor-stage-store"
import {
  isSimulatedRequest,
  stageVoiceRequest,
  voiceRequestsQueryKey,
} from "@/hooks/use-voice-requests"
import { api } from "@/lib/api"
import { authClient } from "@/lib/auth-client"

// Lor's brand mark (apps/web/public/lor-mark.svg).
export function LorMark({ size }: { size: number }) {
  return (
    <Svg height={(size * 470) / 776} viewBox="124 288 776 470" width={size}>
      <Defs>
        <LinearGradient
          gradientUnits="userSpaceOnUse"
          id="lor"
          x1="512"
          x2="512"
          y1="288"
          y2="758"
        >
          <Stop offset="0" stopColor="#5629e8" />
          <Stop offset="0.45" stopColor="#8155f2" />
          <Stop offset="1" stopColor="#cfa3f8" />
        </LinearGradient>
      </Defs>
      <Path
        d="M 134.17 673.78 L 358.47 366.11 A 190.0 190.0 0 0 1 512.00 288.04 A 190.0 190.0 0 0 1 665.53 366.11 L 889.83 673.78 A 53.0 53.0 0 0 1 881.62 745.13 A 53.0 53.0 0 0 1 809.84 742.79 L 561.08 498.14 A 70.0 70.0 0 0 0 512.00 478.05 A 70.0 70.0 0 0 0 462.92 498.14 L 214.16 742.79 A 53.0 53.0 0 0 1 142.38 745.13 A 53.0 53.0 0 0 1 134.17 673.78 Z"
        fill="url(#lor)"
      />
    </Svg>
  )
}

// "Alice", "Alice or Bob", "Alice, Bob, or Cat". Not Intl.ListFormat, which
// Hermes may lack.
function orList(names: string[]) {
  if (names.length <= 2) return names.join(" or ")
  return `${names.slice(0, -1).join(", ")}, or ${names.at(-1)}`
}

// A reaction rises from Lor's mark and fades, like web's.
const FLOAT_UP = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: 0 }, { scale: 0.6 }] },
  15: { opacity: 1, transform: [{ translateY: -8 }, { scale: 1 }] },
  75: { opacity: 1, transform: [{ translateY: -42 }, { scale: 1 }] },
  100: { opacity: 0, transform: [{ translateY: -56 }, { scale: 1 }] },
}).duration(REACTION_MS)

function Reactions({ requestId }: { requestId: string }) {
  const reactions = useLorReactions(requestId)
  return (
    <View
      className="absolute inset-x-0 bottom-1/2 items-center"
      pointerEvents="none"
    >
      {reactions.map((reaction) => (
        <Animated.Text
          className="absolute text-[24px]"
          entering={FLOAT_UP}
          key={reaction.id}
        >
          {reaction.emoji}
        </Animated.Text>
      ))}
    </View>
  )
}

// The tools Lor has used on this request, one glyph per kind; the newest
// pulses while Lor works.
function ToolRow({
  requestId,
  working,
}: {
  requestId: string
  working: boolean
}) {
  const muted = useThemeColor("muted")
  const toolNames = useLorTools(requestId)
  const marks = toolNames.filter(
    (toolName, index, all) =>
      all.findIndex((other) => toolKind(other) === toolKind(toolName)) === index
  )
  if (marks.length === 0) return null
  return (
    <View className="flex-row items-center gap-two">
      {marks.map((toolName, index) => (
        <Shimmer active={working && index === marks.length - 1} key={toolName}>
          <ToolGlyph color={muted} size={15} toolName={toolName} />
        </Shimmer>
      ))}
    </View>
  )
}

type PendingApproval = NonNullable<VoiceRequestState["approval"]>

// Only people in the call who can resolve it get the buttons; the server
// checks again.
function ApprovalCard({
  request,
  approval,
}: {
  request: VoiceRequestState
  approval: PendingApproval
}) {
  const queryClient = useQueryClient()
  const { data: auth } = authClient.useSession()
  const [sending, setSending] = useState(false)
  const canResolve = approval.approvers.some(
    (approver) => approver.userId === auth?.user.id
  )

  const resolve = async (resolution: "approve" | "reject") => {
    if (isSimulatedRequest(request)) {
      resolveSimulatedApproval(queryClient, request, resolution === "approve")
      return
    }
    setSending(true)
    const res = await api.v1.approvals[":approvalId"][resolution]
      .$post({ param: { approvalId: approval.approvalId } })
      .catch(() => null)
    // On success the request resumes, and its update removes this card.
    if (!res?.ok) {
      Alert.alert("Couldn't record that", "Try again.")
      setSending(false)
    }
  }

  return (
    <View className="gap-three rounded-lor-sm bg-surface-secondary p-three">
      <View className="gap-one">
        <Text className="text-[13px] text-muted">Lor needs approval</Text>
        <Text className="text-[15px] font-medium text-foreground">
          {approval.label}
        </Text>
      </View>
      {canResolve ? (
        <View className="flex-row gap-two">
          <Button
            className="flex-1"
            isDisabled={sending}
            onPress={() => void resolve("approve")}
          >
            <Button.Label>Approve</Button.Label>
          </Button>
          <Button
            className="flex-1"
            isDisabled={sending}
            onPress={() => void resolve("reject")}
            variant="secondary"
          >
            <Button.Label>Reject</Button.Label>
          </Button>
        </View>
      ) : (
        <Text className="text-[13px] text-muted">
          {approval.approvers.length > 0
            ? `Waiting for ${orList(approval.approvers.map((approver) => approver.name))} to approve`
            : "Waiting for someone who can approve"}
        </Text>
      )}
    </View>
  )
}

// Lor's window on the phone, the same window everyone in the call sees. The
// mark pulses while Lor listens or works; no status text.
export function LorWindow({
  request,
  results,
}: {
  request: VoiceRequestState
  // The call's results, oldest first, for stepping back ("2 of 3").
  results: VoiceRequestState[]
}) {
  const queryClient = useQueryClient()
  const [foreground, danger, muted] = useThemeColor([
    "foreground",
    "danger",
    "muted",
  ])
  const participants = useParticipants()
  const speakerName =
    participants.find(
      (participant) => participant.identity === request.participantId
    )?.name || "someone"
  const active = isActiveVoiceRequest(request)
  const approval =
    request.status === "awaiting_approval" ? request.approval : null
  const working = active && !approval
  const hasBlocks = (request.result?.blocks.length ?? 0) > 0

  // Cancels Lor's work while it's active; clears the finished result after.
  const close = async () => {
    const queryKey = voiceRequestsQueryKey(request.sessionId)
    const now = new Date().toISOString()
    queryClient.setQueryData<VoiceRequestState[]>(queryKey, (list) =>
      list?.map((entry) =>
        entry.id !== request.id
          ? entry
          : active
            ? { ...entry, status: "cancelled", finishedAt: now }
            : { ...entry, dismissedAt: now }
      )
    )
    if (isSimulatedRequest(request)) return
    const action =
      api.v1.voice.requests[":requestId"][active ? "cancel" : "dismiss"]
    const res = await action
      .$post({ param: { requestId: request.id } })
      .catch(() => null)
    // 409: someone else got there first, which closes the window anyway.
    if (!res || (!res.ok && res.status !== 409)) {
      Alert.alert(active ? "Couldn't cancel the request" : "Couldn't clear it")
      void queryClient.invalidateQueries({ queryKey })
    }
  }

  // A picked choice becomes a new request from whoever tapped it, which then
  // takes over the window.
  const [choosing, setChoosing] = useState(false)
  const choose = async (index: number) => {
    if (isSimulatedRequest(request)) {
      Alert.alert("Simulated", "The pick would go to Lor as a new request.")
      return
    }
    setChoosing(true)
    const res = await api.v1.voice.requests[":requestId"].choose
      .$post({ param: { requestId: request.id }, json: { choice: index } })
      .catch(() => null)
    if (!res?.ok) {
      Alert.alert("Couldn't send that to Lor")
      setChoosing(false)
    }
  }

  // Stepping stages the neighbouring result, so the whole call moves with it.
  const step = results.findIndex((entry) => entry.id === request.id)
  const stepTo = (index: number) => {
    const target = results[index]
    if (target) void stageVoiceRequest(queryClient, target)
  }

  return (
    <View className="mx-three mt-three max-h-[55%] overflow-hidden rounded-lor-md border border-separator bg-surface">
      <View className="flex-row items-center gap-three border-b border-separator py-two pl-three pr-one">
        <View>
          <Shimmer active={working}>
            <LorMark size={26} />
          </Shimmer>
          <Reactions requestId={request.id} />
        </View>
        <Text className="flex-1 text-[14px] text-muted" numberOfLines={2}>
          {request.status === "listening"
            ? `Listening to ${speakerName}`
            : request.heardText}
        </Text>
        <ToolRow requestId={request.id} working={working} />
        <IconButton
          accessibilityLabel={active ? "Cancel request" : "Clear"}
          onPress={() => void close()}
          variant="ghost"
        >
          <SymbolView
            name={{ ios: "xmark", android: "close", web: "close" }}
            size={15}
            tintColor={foreground}
          />
        </IconButton>
      </View>
      <ScrollView contentContainerClassName="gap-three p-three">
        {request.status === "listening" && (
          <Text className="text-[18px] font-medium text-foreground">
            {request.heardText}
          </Text>
        )}
        {hasBlocks && (
          <LorBlocks
            onChoose={
              request.status === "done" && !choosing
                ? (index) => void choose(index)
                : undefined
            }
            request={request}
          />
        )}
        {approval && (
          <ApprovalCard
            approval={approval}
            key={approval.approvalId}
            request={request}
          />
        )}
        {request.status === "failed" && (
          <View className="flex-row items-center gap-two rounded-lor-sm bg-danger-soft px-three py-two">
            <HugeiconsIcon
              color={danger}
              icon={AlertCircleIcon}
              size={16}
              strokeWidth={2}
            />
            <Text className="text-[14px] font-medium text-danger">
              Lor couldn't finish this
            </Text>
          </View>
        )}
      </ScrollView>
      {step >= 0 && results.length > 1 ? (
        <View className="flex-row items-center justify-end gap-one border-t border-separator px-one py-one">
          <IconButton
            accessibilityLabel="Earlier result"
            isDisabled={step === 0}
            onPress={() => stepTo(step - 1)}
            variant="ghost"
          >
            <HugeiconsIcon
              color={muted}
              icon={ArrowLeft01Icon}
              size={16}
              strokeWidth={2}
            />
          </IconButton>
          <Text className="text-[13px] text-muted tabular-nums">
            {step + 1} of {results.length}
          </Text>
          <IconButton
            accessibilityLabel="Later result"
            isDisabled={step === results.length - 1}
            onPress={() => stepTo(step + 1)}
            variant="ghost"
          >
            <HugeiconsIcon
              color={muted}
              icon={ArrowRight01Icon}
              size={16}
              strokeWidth={2}
            />
          </IconButton>
        </View>
      ) : null}
    </View>
  )
}
