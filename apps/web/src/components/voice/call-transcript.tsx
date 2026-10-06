import { useParticipants, useTranscriptions } from "@livekit/components-react"
import type { VoiceRequestState } from "@repo/realtime-types/events"
import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/avatar"
import { Button } from "@repo/ui/components/button"
import { Skeleton } from "@repo/ui/components/skeleton"
import { cn } from "@repo/ui/lib/utils"
import { getAvatarInitials } from "@repo/utils/avatar-colors"
import { formatTime } from "@repo/utils/date"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { captionLine } from "@/components/voice/call-captions"
import { CallSummary } from "@/components/voice/call-summary"
import { LorBlocks, LorFailedNotice } from "@/components/voice/lor-blocks"
import { formatDuration } from "@/components/voice/voice-lobby"
import {
  type TranscriptPage,
  useCallTranscript,
} from "@/hooks/use-call-transcript"
import { useVoiceEntityCards } from "@/hooks/use-voice-entity-cards"
import {
  hasResult,
  stageVoiceRequest,
  useVoiceRequests,
} from "@/hooks/use-voice-requests"

// One speaker's phrases within this window share a block.
const BLOCK_WINDOW_MS = 2 * 60_000
const FOLLOW_THRESHOLD_PX = 64
const NO_LINES: Line[] = []
const NO_NAMES = new Map<string, string>()

type Speaker = Pick<
  TranscriptPage["participants"][number],
  "name" | "image" | "avatarColor"
>
type Line = {
  id: string
  participantId: string
  at: number
  text: string
  final: boolean
}
type Gap = {
  id: string
  participantId: string | null
  at: number
  durationMs: number
}
type LorEntry = { id: string; at: number; request: VoiceRequestState }
type Block =
  | { kind: "speech"; id: string; participantId: string; lines: Line[] }
  | { kind: "gap"; id: string; gap: Gap }
  | { kind: "lor"; id: string; request: VoiceRequestState }

function toBlocks(entries: (Line | Gap | LorEntry)[]) {
  const blocks: Block[] = []
  for (const entry of entries) {
    if ("durationMs" in entry) {
      blocks.push({ kind: "gap", id: entry.id, gap: entry })
      continue
    }
    if ("request" in entry) {
      blocks.push({ kind: "lor", id: entry.id, request: entry.request })
      continue
    }
    const last = blocks.at(-1)
    const previous = last?.kind === "speech" ? last.lines.at(-1) : undefined
    if (
      last?.kind === "speech" &&
      previous &&
      last.participantId === entry.participantId &&
      entry.at - previous.at <= BLOCK_WINDOW_MS
    ) {
      last.lines.push(entry)
    } else {
      blocks.push({
        kind: "speech",
        id: entry.id,
        participantId: entry.participantId,
        lines: [entry],
      })
    }
  }
  return blocks
}

// Saved segments, capture gaps, and Lor's results in timeline order, then live
// lines this device heard that aren't saved yet. Saved segments and captions
// share an id. A result sits where it was asked, just after the words that
// asked it.
function buildBlocks(
  pages: TranscriptPage[],
  liveLines: Line[],
  requests: VoiceRequestState[]
) {
  const first = pages[0]
  if (!first) return []
  const startedAt = Date.parse(first.startedAt)
  const saved = pages.flatMap((page) => page.segments)
  const savedIds = new Set(saved.map((segment) => segment.segmentId))
  const entries: (Line | Gap | LorEntry)[] = [
    ...requests
      .filter(
        (request) =>
          hasResult(request) ||
          request.status === "failed" ||
          request.status === "awaiting_approval"
      )
      .map((request) => ({
        id: request.id,
        at: Date.parse(request.createdAt),
        request,
      })),
    ...saved.map((segment) => ({
      id: segment.segmentId,
      participantId: segment.participantId,
      at: startedAt + segment.startMs,
      text: segment.text,
      final: true,
    })),
    ...first.gaps.map((gap, index) => ({
      id: `gap-${index}`,
      participantId: gap.participantId,
      at: startedAt + gap.startMs,
      durationMs: gap.endMs - gap.startMs,
    })),
  ].sort((a, b) => a.at - b.at)
  return toBlocks([
    ...entries,
    ...liveLines.filter((line) => !savedIds.has(line.id)),
  ])
}

// The spoken block at a moment of the call: the last one starting at or
// before it.
function blockAtMoment(blocks: Block[], at: number) {
  let found: Block | undefined
  for (const block of blocks) {
    const start =
      block.kind === "speech"
        ? block.lines[0]?.at
        : block.kind === "gap"
          ? block.gap.at
          : undefined
    if (start === undefined) continue
    if (start > at) break
    found = block
  }
  return found ?? blocks.find((block) => block.kind !== "lor")
}

function SpeakerAvatar({ speaker }: { speaker: Speaker }) {
  return (
    <Avatar size="lg" className="mt-0.5">
      {speaker.image && <AvatarImage src={speaker.image} alt={speaker.name} />}
      <AvatarFallback
        avatarColor={speaker.avatarColor}
        className="text-base font-semibold"
        fallbackSeed={speaker.name}
      >
        {getAvatarInitials(speaker.name)}
      </AvatarFallback>
    </Avatar>
  )
}

// A request to Lor and its result, where it happened. During the call,
// "Show on stage" brings it back into Lor's window for everyone.
function LorResult({
  request,
  askedBy,
  canStage,
}: {
  request: VoiceRequestState
  askedBy: string
  canStage: boolean
}) {
  const queryClient = useQueryClient()
  const cards = useVoiceEntityCards(request, false)
  return (
    <div className="flex gap-3 px-4 py-1.5">
      <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
        <img src="/lor-mark.svg" alt="" className="size-6" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold leading-snug">Lor</span>
          <span className="text-xs text-muted-foreground">
            {formatTime(new Date(request.createdAt))}
          </span>
          {canStage && (
            <Button
              size="xs"
              variant="ghost"
              className="-my-1 ml-auto text-muted-foreground"
              onClick={() => void stageVoiceRequest(queryClient, request)}
            >
              Show on stage
            </Button>
          )}
        </div>
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {askedBy}: “{request.heardText}”
        </p>
        <div className="mt-2 flex flex-col gap-2">
          {request.result && (
            <LorBlocks
              blocks={request.result.blocks}
              cards={{ data: cards.data, failed: cards.isError }}
            />
          )}
          {request.approval ? (
            <p className="text-sm text-muted-foreground">
              Waiting for approval: {request.approval.label}
            </p>
          ) : (
            request.status === "failed" && (
              <LorFailedNotice className="self-start" />
            )
          )}
        </div>
      </div>
    </div>
  )
}

function TranscriptSkeleton() {
  return (
    <div className="flex flex-col gap-4 px-4 py-2">
      {["70%", "45%", "60%"].map((width) => (
        <div key={width} className="flex gap-3">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2 pt-1">
            <Skeleton className="h-3 w-20 rounded" />
            <Skeleton className="h-3 rounded" style={{ width }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function TranscriptView({
  sessionId,
  live,
  liveLines,
  liveNames,
  atMs,
}: {
  sessionId: string
  live: boolean
  liveLines: Line[]
  liveNames: Map<string, string>
  atMs?: number
}) {
  const { data, isPending, isError, hasNextPage } = useCallTranscript(
    sessionId,
    live
  )
  const pages = data?.pages ?? []
  const { requests, onStage } = useVoiceRequests(sessionId)
  // Live lines wait for every saved page, so nothing is skipped between them.
  const blocks = useMemo(
    () => buildBlocks(pages, hasNextPage ? NO_LINES : liveLines, requests),
    [pages, hasNextPage, liveLines, requests]
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
  const speakerFor = (participantId: string): Speaker =>
    speakers.get(participantId) ?? {
      name: liveNames.get(participantId) ?? "Someone",
      image: null,
      avatarColor: null,
    }

  // A live transcript follows new lines while the reader is at the bottom.
  const scrollRef = useRef<HTMLDivElement>(null)
  const followRef = useRef(live)
  const handleScroll = () => {
    const viewport = scrollRef.current
    if (!viewport) return
    followRef.current =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <
      FOLLOW_THRESHOLD_PX
  }
  useLayoutEffect(() => {
    const viewport = scrollRef.current
    if (blocks.length > 0 && viewport && followRef.current) {
      viewport.scrollTop = viewport.scrollHeight
    }
  }, [blocks])

  // A [[call:…]] citation or a summary item's time opens the transcript at a
  // moment: once every page has loaded, the block spoken then scrolls into
  // view and flashes. An object, so picking the same time again re-scrolls.
  const [target, setTarget] = useState<{ atMs: number } | null>(() =>
    atMs === undefined ? null : { atMs }
  )
  const [highlightId, setHighlightId] = useState<string | null>(null)
  useLayoutEffect(() => {
    const first = pages[0]
    if (!target || !first || hasNextPage) return
    setTarget(null)
    const block = blockAtMoment(
      blocks,
      Date.parse(first.startedAt) + target.atMs
    )
    if (!block) return
    scrollRef.current
      ?.querySelector(`[data-block-id="${CSS.escape(block.id)}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" })
    setHighlightId(block.id)
  }, [target, blocks, pages, hasNextPage])
  useEffect(() => {
    if (!highlightId) return
    const timer = setTimeout(() => setHighlightId(null), 2500)
    return () => clearTimeout(timer)
  }, [highlightId])

  const emptyText = live ? "Nothing said yet." : "No transcript for this call."
  const status = isPending ? (
    <TranscriptSkeleton />
  ) : isError ? (
    <p className="px-4 py-2 text-sm text-muted-foreground">
      Couldn't load the transcript.
    </p>
  ) : blocks.length === 0 ? (
    <p className="px-4 py-2 text-sm text-muted-foreground">{emptyText}</p>
  ) : null

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="min-h-0 flex-1 overflow-y-auto py-2"
    >
      {!live && (
        <CallSummary
          sessionId={sessionId}
          onOpenMoment={(moment) => setTarget({ atMs: moment })}
        />
      )}
      {status ??
        blocks.map((block) => {
          if (block.kind === "lor") {
            return (
              <LorResult
                key={block.id}
                request={block.request}
                askedBy={speakerFor(block.request.participantId).name}
                canStage={
                  live &&
                  (hasResult(block.request) ||
                    block.request.status === "awaiting_approval") &&
                  onStage?.id !== block.request.id
                }
              />
            )
          }
          if (block.kind === "gap") {
            const { participantId, durationMs } = block.gap
            const who = participantId
              ? `${speakerFor(participantId).name}'s audio not captured`
              : "Not captured"
            const length = formatDuration(durationMs / 60_000).toLowerCase()
            return (
              <div
                key={block.id}
                data-block-id={block.id}
                className={cn(
                  "flex items-center gap-3 px-4 py-2 text-xs text-muted-foreground transition-colors duration-700",
                  highlightId === block.id && "bg-primary/8"
                )}
              >
                <div className="h-px flex-1 bg-border/60" />
                <span>
                  {who} · {length}
                </span>
                <div className="h-px flex-1 bg-border/60" />
              </div>
            )
          }
          const speaker = speakerFor(block.participantId)
          const startedAt = block.lines[0]?.at ?? 0
          return (
            <div
              key={block.id}
              data-block-id={block.id}
              className={cn(
                "flex gap-3 px-4 py-1.5 transition-colors duration-700",
                highlightId === block.id && "bg-primary/8"
              )}
            >
              <SpeakerAvatar speaker={speaker} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold leading-snug">
                    {speaker.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatTime(new Date(startedAt))}
                  </span>
                </div>
                <p className="text-sm">
                  {block.lines.map((line) => (
                    <span
                      key={line.id}
                      className={cn(
                        "transition-colors",
                        line.final ? "text-foreground" : "text-muted-foreground"
                      )}
                    >
                      {line.text}{" "}
                    </span>
                  ))}
                </p>
              </div>
            </div>
          )
        })}
    </div>
  )
}

// Only mounted on the device in this call, so another call's captions never
// mix in.
function LiveTranscript({ sessionId }: { sessionId: string }) {
  const transcriptions = useTranscriptions()
  const participants = useParticipants()
  const liveLines = useMemo(
    () =>
      transcriptions
        .map(captionLine)
        .filter((line) => line.text.trim())
        .map((line) => ({ ...line, at: line.updatedAt })),
    [transcriptions]
  )
  const liveNames = useMemo(
    () =>
      new Map(
        participants.map((participant) => [
          participant.identity,
          participant.name || "Someone",
        ])
      ),
    [participants]
  )
  return (
    <TranscriptView
      sessionId={sessionId}
      live
      liveLines={liveLines}
      liveNames={liveNames}
    />
  )
}

export function CallTranscript({
  sessionId,
  live,
  atMs,
}: {
  sessionId: string
  live: boolean
  atMs?: number
}) {
  return live ? (
    <LiveTranscript sessionId={sessionId} />
  ) : (
    <TranscriptView
      sessionId={sessionId}
      live={false}
      liveLines={NO_LINES}
      liveNames={NO_NAMES}
      atMs={atMs}
    />
  )
}
