import {
  CAPTION_ATTRIBUTES,
  CAPTION_TOPIC,
  type TranscriptLine,
} from "@repo/realtime-types/call-transcript"
import { type Room, RoomEvent } from "livekit-client"
import { useSyncExternalStore } from "react"

export type CaptionLine = TranscriptLine & {
  // The transcriber's clock, comparable with Lor's request times.
  updatedAt: number
  // This phone's clock, for how long the stage shows the line.
  heardAt: number
}

// Live captions for the call this phone is in. Registered once on the app's
// room and kept for the whole call, so the transcript has every line said
// while you were in it (web's useTranscriptions does the same). Each update
// is a new stream with the segment's text so far; the segment id keeps the
// line stable and matches the saved segment.
let lines: CaptionLine[] = []
const listeners = new Set<() => void>()

function publish(next: CaptionLine[]) {
  lines = next
  for (const listener of listeners) listener()
}

export function listenForCaptions(room: Room) {
  room.registerTextStreamHandler(CAPTION_TOPIC, (reader, { identity }) => {
    const { id, timestamp, attributes } = reader.info
    reader
      .readAll()
      .then((text) => {
        const lineId = attributes?.[CAPTION_ATTRIBUTES.segmentId] ?? id
        const final = attributes?.[CAPTION_ATTRIBUTES.final] === "true"
        const index = lines.findIndex((line) => line.id === lineId)
        const existing = lines[index]
        // A late interim update must not undo a finished line.
        if (existing?.final && !final) return
        const line: CaptionLine = {
          id: lineId,
          participantId: identity,
          at: existing?.at ?? timestamp,
          text,
          final,
          updatedAt: timestamp,
          heardAt: Date.now(),
        }
        publish(
          existing
            ? lines.map((entry, at) => (at === index ? line : entry))
            : [...lines, line]
        )
      })
      .catch(() => {})
  })
  const clear = () => publish([])
  room.on(RoomEvent.Disconnected, clear)
  return () => {
    room.unregisterTextStreamHandler(CAPTION_TOPIC)
    room.off(RoomEvent.Disconnected, clear)
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useCaptionLines() {
  return useSyncExternalStore(subscribe, () => lines)
}
