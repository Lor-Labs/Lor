import { useParticipants } from "@livekit/react-native"
import type { VoiceRequestState } from "@repo/realtime-types/events"
import { isActiveVoiceRequest } from "@repo/realtime-types/voice-requests"
import { useQueryClient } from "@tanstack/react-query"
import { SymbolView } from "expo-symbols"
import { useThemeColor } from "heroui-native/hooks"
import { Alert, ScrollView, Text, View } from "react-native"
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg"
import { Shimmer } from "@/components/shimmer"
import { IconButton } from "@/components/ui/icon-button"
import { LorBlocks } from "@/components/voice/lor-blocks"
import { voiceRequestsQueryKey } from "@/hooks/use-voice-requests"
import { api } from "@/lib/api"

// Lor's brand mark (apps/web/public/lor-mark.svg).
function LorMark({ size }: { size: number }) {
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

// Lor's window on the phone: the same window everyone in the call sees, read
// only. The mark pulses while Lor listens or works; no status text. Approvals
// show who can approve; the buttons stay on desktop for now.
export function LorWindow({ request }: { request: VoiceRequestState }) {
  const queryClient = useQueryClient()
  const [foreground] = useThemeColor(["foreground"])
  const participants = useParticipants()
  const speakerName =
    participants.find(
      (participant) => participant.identity === request.participantId
    )?.name || "someone"
  const active = isActiveVoiceRequest(request)
  const approval =
    request.status === "awaiting_approval" ? request.approval : null
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

  return (
    <View className="mx-three mt-three max-h-[55%] overflow-hidden rounded-lor-md border border-separator bg-surface">
      <View className="flex-row items-center gap-three border-b border-separator py-two pl-three pr-one">
        <Shimmer active={active && !approval}>
          <LorMark size={26} />
        </Shimmer>
        <Text className="flex-1 text-[14px] text-muted" numberOfLines={2}>
          {request.status === "listening"
            ? `Listening to ${speakerName}`
            : request.heardText}
        </Text>
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
        {hasBlocks && <LorBlocks request={request} />}
        {approval && (
          <View className="gap-one rounded-lor-sm bg-surface-secondary p-three">
            <Text className="text-[13px] text-muted">Lor needs approval</Text>
            <Text className="text-[15px] font-medium text-foreground">
              {approval.label}
            </Text>
            <Text className="text-[13px] text-muted">
              {approval.approvers.length > 0
                ? `Waiting for ${orList(approval.approvers.map((approver) => approver.name))} to approve`
                : "Waiting for someone who can approve"}
            </Text>
          </View>
        )}
        {request.status === "failed" && (
          <Text className="text-[14px] text-muted">
            Lor couldn't finish this.
          </Text>
        )}
      </ScrollView>
    </View>
  )
}
