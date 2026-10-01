import { randomUUID } from "node:crypto"
import { stt } from "@livekit/agents"
import type * as deepgram from "@livekit/agents-plugin-deepgram"
import { AudioStream, type RemoteTrack } from "@livekit/rtc-node"
import {
  recordCaptureGap,
  recordTranscriptSegment,
  type TranscriptSegmentInput,
} from "@repo/voice/server"
import { logger } from "./logger"

export const STT_PROVIDER = "deepgram"
export const STT_MODEL = "nova-3"
// Deepgram's own retries are exhausted by the time a stream fails for good.
const RESTART_DELAY_MS = 5_000
const SAMPLE_RATE = 16_000

export type Caption = { segmentId: string; text: string; final: boolean }

type MicStreamInput = {
  sessionId: string
  participantId: string
  trackId: string
  track: RemoteTrack
  speech: deepgram.STT
  sessionStartedAt: Date
  publishCaption: (caption: Caption) => Promise<void>
}

// One unmuted microphone's Deepgram stream. Interim and final text go out as
// live captions; final text becomes segments on the session timeline. A
// stream that fails for good records a provider_error gap until it restarts
// or the microphone goes away.
export class MicStream {
  readonly #input: MicStreamInput
  #stream: stt.SpeechStream | null = null
  #closed = false
  #failedAtMs: number | null = null
  #restartTimer: ReturnType<typeof setTimeout> | undefined
  // The phrase being spoken; its id is shared by its captions and segment.
  #segmentId: string | null = null
  // Captions publish in order, so a late interim can't overwrite a final.
  #captions: Promise<void> = Promise.resolve()

  constructor(input: MicStreamInput) {
    this.#input = input
  }

  start() {
    void this.#run()
  }

  close() {
    if (this.#closed) return
    this.#closed = true
    clearTimeout(this.#restartTimer)
    this.#stream?.close()
    this.#stream = null
    this.#endGap()
  }

  #sessionMs() {
    return Date.now() - this.#input.sessionStartedAt.getTime()
  }

  async #run() {
    const { track, speech } = this.#input
    const stream = speech.stream()
    this.#stream = stream
    this.#segmentId = null
    // Deepgram's times are relative to the stream; this puts them on the
    // session timeline.
    stream.startTimeOffset = this.#sessionMs() / 1000
    stream.updateInputStream(
      new AudioStream(track, { sampleRate: SAMPLE_RATE, numChannels: 1 })
    )

    try {
      for await (const event of stream) {
        const final = event.type === stt.SpeechEventType.FINAL_TRANSCRIPT
        if (!final && event.type !== stt.SpeechEventType.INTERIM_TRANSCRIPT) {
          continue
        }
        const alternative = event.alternatives?.[0]
        const text = alternative?.text.trim()
        if (!alternative || !text) continue
        this.#segmentId ??= randomUUID()
        const segmentId = this.#segmentId
        this.#caption({ segmentId, text, final })
        if (!final) continue
        this.#segmentId = null
        await this.#save({
          sessionId: this.#input.sessionId,
          participantId: this.#input.participantId,
          trackId: this.#input.trackId,
          segmentId,
          startMs: Math.round(alternative.startTime * 1000),
          endMs: Math.round(alternative.endTime * 1000),
          text,
          provider: STT_PROVIDER,
          model: STT_MODEL,
        })
      }
    } catch (err) {
      logger.warn(
        { err, trackId: this.#input.trackId },
        "transcriber: speech stream threw"
      )
    }

    // A clean end means the track ended; only a terminal error restarts.
    if (this.#closed || !stream.terminalError) return
    logger.error(
      {
        err: stream.terminalError,
        sessionId: this.#input.sessionId,
        participantId: this.#input.participantId,
      },
      "transcriber: speech stream failed"
    )
    this.#failedAtMs = this.#sessionMs()
    this.#restartTimer = setTimeout(() => {
      if (this.#closed) return
      this.#endGap()
      void this.#run()
    }, RESTART_DELAY_MS)
  }

  #caption(caption: Caption) {
    this.#captions = this.#captions
      .then(() => this.#input.publishCaption(caption))
      .catch((err: unknown) =>
        logger.warn({ err }, "transcriber: caption publish failed")
      )
  }

  async #save(segment: TranscriptSegmentInput) {
    try {
      await recordTranscriptSegment(segment)
    } catch (err) {
      // One retry with the same segment id; the write is idempotent.
      logger.warn({ err }, "transcriber: segment write failed, retrying")
      await recordTranscriptSegment(segment).catch((retryErr: unknown) =>
        logger.error(
          { err: retryErr, sessionId: segment.sessionId },
          "transcriber: segment lost"
        )
      )
    }
  }

  #endGap() {
    if (this.#failedAtMs === null) return
    const startMs = this.#failedAtMs
    this.#failedAtMs = null
    void recordCaptureGap({
      sessionId: this.#input.sessionId,
      participantId: this.#input.participantId,
      startMs,
      endMs: this.#sessionMs(),
      reason: "provider_error",
    }).catch((err: unknown) =>
      logger.error({ err }, "transcriber: gap write failed")
    )
  }
}
