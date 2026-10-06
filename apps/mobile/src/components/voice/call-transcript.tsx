import { LegendList, type LegendListRef } from "@legendapp/list/react-native"
import {
  buildTranscriptBlocks,
  type TranscriptBlock,
  transcriptBlockAt,
} from "@repo/realtime-types/call-transcript"
import type { VoiceRequestState } from "@repo/realtime-types/events"
import {
  hasVoiceResult,
  pickVoiceRequestOnStage,
} from "@repo/realtime-types/voice-requests"
import { formatDuration, formatTime } from "@repo/utils/date"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"
import { Text, View } from "react-native"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { LorBlocks } from "@/components/voice/lor-blocks"
import { LorMark } from "@/components/voice/lor-window"
import {
  type TranscriptPage,
  useCallTranscript,
} from "@/hooks/use-call-transcript"
import {
  stageVoiceRequest,
  useVoiceRequestList,
} from "@/hooks/use-voice-requests"

const HIGHLIGHT_MS = 2500

type Speaker = Pick<
  TranscriptPage["participants"][number],
  "name" | "image" | "avatarColor"
>
const UNKNOWN_SPEAKER: Speaker = {
  name: "Someone",
  image: null,
  avatarColor: null,
}

// A request to Lor and its result, where it happened. During the call, "Show
// on stage" brings it back into Lor's window for everyone.
function LorResult({
  request,
  askedBy,
  onShowOnStage,
}: {
  request: VoiceRequestState
  askedBy: string
  onShowOnStage: (() => void) | undefined
}) {
  return (
    <View className="flex-row gap-three">
      <View className="size-9 items-center justify-center rounded-full bg-surface-secondary">
        <LorMark size={20} />
      </View>
      <View className="min-w-0 flex-1 gap-two">
        <View className="gap-px">
          <View className="flex-row items-center gap-two">
            <Text className="text-[15px] font-semibold text-foreground">
              Lor
            </Text>
            <Text className="text-xs text-muted">
              {formatTime(request.createdAt)}
            </Text>
            {onShowOnStage ? (
              <Button
                className="ml-auto"
                onPress={onShowOnStage}
                size="sm"
                variant="ghost"
              >
                <Button.Label>Show on stage</Button.Label>
              </Button>
            ) : null}
          </View>
          <Text className="text-[13px] text-muted" numberOfLines={2}>
            {askedBy}: “{request.heardText}”
          </Text>
        </View>
        {request.result ? <LorBlocks request={request} /> : null}
        {request.approval ? (
          <Text className="text-[14px] text-muted">
            Waiting for approval: {request.approval.label}
          </Text>
        ) : request.status === "failed" ? (
          <Text className="text-[14px] font-medium text-danger">
            Lor couldn't finish this
          </Text>
        ) : null}
      </View>
    </View>
  )
}

function BlockRow({
  block,
  speakerFor,
  showOnStage,
  onStageId,
}: {
  block: TranscriptBlock
  speakerFor: (participantId: string) => Speaker
  // Set during the call.
  showOnStage: ((request: VoiceRequestState) => void) | undefined
  onStageId: string | null
}) {
  if (block.kind === "lor") {
    const { request } = block
    const canStage =
      showOnStage &&
      (hasVoiceResult(request) || request.status === "awaiting_approval") &&
      onStageId !== request.id
    return (
      <LorResult
        askedBy={speakerFor(request.participantId).name}
        onShowOnStage={canStage ? () => showOnStage(request) : undefined}
        request={request}
      />
    )
  }
  if (block.kind === "gap") {
    const { participantId, durationMs } = block.gap
    const who = participantId
      ? `${speakerFor(participantId).name}'s audio not captured`
      : "Not captured"
    return (
      <View className="flex-row items-center gap-three">
        <View className="h-px flex-1 bg-separator" />
        <Text className="text-xs text-muted">
          {who} · {formatDuration(durationMs / 60_000)}
        </Text>
        <View className="h-px flex-1 bg-separator" />
      </View>
    )
  }
  const speaker = speakerFor(block.participantId)
  return (
    <View className="flex-row gap-three">
      <Avatar
        avatarColor={speaker.avatarColor}
        image={speaker.image}
        name={speaker.name}
        size="sm"
      />
      <View className="min-w-0 flex-1 gap-px">
        <View className="flex-row items-baseline gap-two">
          <Text className="text-[15px] font-semibold text-foreground">
            {speaker.name}
          </Text>
          <Text className="text-xs text-muted">
            {formatTime(new Date(block.lines[0]?.at ?? 0))}
          </Text>
        </View>
        <Text className="text-[15px] leading-[22px] text-foreground">
          {block.lines.map((line) => line.text).join(" ")}
        </Text>
      </View>
    </View>
  )
}

// A call's transcript on the phone. Saved lines only: a live call refreshes
// them every few seconds and follows the newest while you're at the bottom.
// `atMs` (a citation or a time on Lor's summary card) scrolls to the block
// spoken then and flashes it.
export function CallTranscript({
  sessionId,
  live,
  atMs,
}: {
  sessionId: string
  live: boolean
  atMs?: number
}) {
  const { data, isPending, isError, hasNextPage } = useCallTranscript(
    sessionId,
    live
  )
  const requests = useVoiceRequestList(sessionId)
  const pages = data?.pages ?? []
  const blocks = useMemo(
    () => buildTranscriptBlocks(pages, [], requests),
    [pages, requests]
  )
  const speakers = useMemo(
    () =>
      new Map(
        (pages[0]?.participants ?? []).map((participant) => [
          participant.id,
          participant,
        ])
      ),
    [pages]
  )
  const speakerFor = (participantId: string) =>
    speakers.get(participantId) ?? UNKNOWN_SPEAKER
  const queryClient = useQueryClient()
  const onStageId = pickVoiceRequestOnStage(requests)?.id ?? null
  const showOnStage = live
    ? (request: VoiceRequestState) =>
        void stageVoiceRequest(queryClient, request)
    : undefined

  const listRef = useRef<LegendListRef>(null)
  const [pendingAt, setPendingAt] = useState(atMs)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  // Waits for every page, so the moment's block is there to scroll to.
  useEffect(() => {
    const first = pages[0]
    if (pendingAt === undefined || !first || hasNextPage) return
    setPendingAt(undefined)
    const block = transcriptBlockAt(
      blocks,
      Date.parse(first.startedAt) + pendingAt
    )
    const index = block ? blocks.indexOf(block) : -1
    if (!block || index < 0) return
    void listRef.current?.scrollToIndex({
      index,
      animated: true,
      viewPosition: 0.4,
    })
    setHighlightId(block.id)
  }, [pendingAt, pages, blocks, hasNextPage])
  useEffect(() => {
    if (!highlightId) return
    const timer = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [highlightId])

  if (isPending) {
    return (
      <View className="gap-five p-four">
        {["w-[70%]", "w-[45%]", "w-[60%]"].map((width) => (
          <View className="flex-row gap-three" key={width}>
            <Skeleton className="size-8 rounded-full" />
            <View className="flex-1 gap-two pt-one">
              <Skeleton className="h-3 w-20" />
              <Skeleton className={`h-3 ${width}`} />
            </View>
          </View>
        ))}
      </View>
    )
  }
  if (isError || blocks.length === 0) {
    return (
      <Text className="p-four text-[15px] text-muted">
        {isError
          ? "Couldn't load the transcript."
          : live
            ? "Nothing said yet."
            : "No transcript for this call."}
      </Text>
    )
  }

  return (
    <LegendList
      contentContainerStyle={{ paddingVertical: 8 }}
      data={blocks}
      estimatedItemSize={72}
      extraData={`${highlightId}:${onStageId}`}
      initialScrollIndex={live && atMs === undefined ? blocks.length - 1 : 0}
      keyExtractor={(block) => block.id}
      maintainScrollAtEnd={live}
      ref={listRef}
      renderItem={({ item }) => (
        <View
          className={`px-four py-two ${
            highlightId === item.id ? "bg-accent-soft" : ""
          }`}
        >
          <BlockRow
            block={item}
            onStageId={onStageId}
            showOnStage={showOnStage}
            speakerFor={speakerFor}
          />
        </View>
      )}
    />
  )
}
