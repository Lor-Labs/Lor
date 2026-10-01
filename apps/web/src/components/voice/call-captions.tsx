import { useParticipants, useTranscriptions } from "@livekit/components-react"
import { cn } from "@repo/ui/lib/utils"
import { CAPTION_ATTRIBUTES } from "@repo/voice"
import { useEffect, useState } from "react"

const MAX_LINES = 3
// A finished line stays up briefly; an interim line whose final never came
// (a failed stream) clears on its own.
const FINAL_LINGER_MS = 6_000
const INTERIM_LINGER_MS = 15_000

// Live captions from the transcriber. Interim text is muted and settles to
// the normal foreground in place once the phrase is final.
export function CallCaptions() {
  const transcriptions = useTranscriptions()
  const participants = useParticipants()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])

  const names = new Map(
    participants.map((participant) => [
      participant.identity,
      participant.name || "Someone",
    ])
  )
  const lines = transcriptions
    .map((transcription) => ({
      // Each update is a new stream; the segment id keeps the line stable.
      id:
        transcription.streamInfo.attributes?.[CAPTION_ATTRIBUTES.segmentId] ??
        transcription.streamInfo.id,
      name: names.get(transcription.participantInfo.identity) ?? "Someone",
      text: transcription.text,
      final:
        transcription.streamInfo.attributes?.[CAPTION_ATTRIBUTES.final] ===
        "true",
      updatedAt: transcription.streamInfo.timestamp,
    }))
    .filter(
      (line) =>
        now - line.updatedAt <
        (line.final ? FINAL_LINGER_MS : INTERIM_LINGER_MS)
    )
    .slice(-MAX_LINES)

  if (lines.length === 0) return null

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-4">
      <div
        aria-live="polite"
        className="flex max-w-2xl flex-col gap-1 rounded-lg bg-card/90 px-3 py-2 text-sm shadow-sm backdrop-blur"
      >
        {lines.map((line) => (
          <p key={line.id}>
            <span className="font-medium text-foreground">{line.name}</span>{" "}
            <span
              className={cn(
                "transition-colors",
                line.final ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {line.text}
            </span>
          </p>
        ))}
      </div>
    </div>
  )
}
