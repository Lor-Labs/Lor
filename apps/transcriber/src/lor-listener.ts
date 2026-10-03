import type { VoiceRequestCheck } from "@repo/db/schema"
import type { VoiceRequestState } from "@repo/realtime-types/events"
import {
  abandonVoiceRequest,
  checkAddress,
  createVoiceRequest,
  type LorNameMatch,
  matchLorName,
  notifyVoiceRequest,
  recordVoiceRequestCheck,
} from "@repo/voice/server"
import { logger } from "./logger"
import type { HeardLine } from "./mic-stream"
import { enqueueVoiceRequest } from "./queue"

// Once Lor is listening, this much silence from the speaker closes it.
const CONTINUE_MS = 4_000
const MAX_CHECKS = 8
// Earlier lines Jev sees as context.
const RECENT_LINES = 12

type Line = { speakerName: string; text: string }

type Pending = {
  participantId: string
  speakerName: string
  gate: LorNameMatch
  finals: string[]
  // The speaker's unfinished line, if any.
  interim: string
  startMs: number
  endMs: number
  // Set once Jev first says Lor is addressed and the row exists.
  request: VoiceRequestState | null
  checks: number
  checking: boolean
  // Speech arrived during a check, so its answer may be stale.
  heardDuringCheck: boolean
  finalDuringCheck: boolean
  timer?: ReturnType<typeof setTimeout>
}

// Listens for requests to Lor on one call. Jev checks the speaker's live words
// as soon as they contain Lor's name, so Lor's window can open while they're
// still talking, then again at each finished line. A request starts only on a
// complete line with no speech during its check.
export class LorListener {
  readonly #sessionId: string
  readonly #threadRootId: string | null
  readonly #recent: Line[] = []
  readonly #pending = new Map<string, Pending>()
  // Speakers whose live line Jev already rejected; their final is checked
  // instead of every interim update.
  readonly #liveRejected = new Set<string>()

  constructor(sessionId: string, threadRootId: string | null) {
    this.#sessionId = sessionId
    this.#threadRootId = threadRootId
  }

  hear(participantId: string, speakerName: string, line: HeardLine) {
    const pending = this.#pending.get(participantId)
    if (pending) {
      if (line.final) {
        pending.finals.push(line.text)
        pending.interim = ""
        pending.endMs = line.endMs
      } else {
        pending.interim = line.text
      }
      if (pending.checking) {
        pending.heardDuringCheck = true
        if (line.final) pending.finalDuringCheck = true
        return
      }
      this.#waitForMore(pending)
      if (line.final) void this.#check(pending)
      return
    }

    if (line.final) this.#liveRejected.delete(participantId)
    else if (this.#liveRejected.has(participantId)) return
    const gate = matchLorName(line.text)
    if (!gate) {
      if (line.final) this.#remember({ speakerName, text: line.text })
      return
    }
    const next: Pending = {
      participantId,
      speakerName,
      gate,
      finals: line.final ? [line.text] : [],
      interim: line.final ? "" : line.text,
      startMs: line.startMs,
      endMs: line.endMs,
      request: null,
      checks: 0,
      checking: false,
      heardDuringCheck: false,
      finalDuringCheck: false,
    }
    this.#pending.set(participantId, next)
    void this.#check(next)
  }

  // Lor stops listening when the transcriber leaves.
  async close() {
    const pending = [...this.#pending.values()]
    this.#pending.clear()
    await Promise.all(pending.map((entry) => this.#abandon(entry)))
  }

  #remember(line: Line) {
    this.#recent.push(line)
    if (this.#recent.length > RECENT_LINES) this.#recent.shift()
  }

  // A request turns queued once; that's when the worker gets it.
  #publish(request: VoiceRequestState) {
    if (this.#threadRootId) notifyVoiceRequest(this.#threadRootId, request)
    if (request.status === "queued") {
      enqueueVoiceRequest(request.id).catch((err: unknown) =>
        logger.error(
          { err, requestId: request.id },
          "lor request: enqueue failed"
        )
      )
    }
  }

  #waitForMore(pending: Pending) {
    clearTimeout(pending.timer)
    pending.timer = setTimeout(() => {
      if (pending.checking) return
      this.#settle(pending)
      void this.#abandon(pending)
    }, CONTINUE_MS)
  }

  async #abandon(pending: Pending) {
    clearTimeout(pending.timer)
    if (!pending.request) return
    const request = await abandonVoiceRequest(pending.request.id).catch(
      () => null
    )
    if (request) this.#publish(request)
  }

  #settle(pending: Pending) {
    clearTimeout(pending.timer)
    if (this.#pending.get(pending.participantId) === pending) {
      this.#pending.delete(pending.participantId)
    }
    if (pending.finals.length > 0) {
      this.#remember({
        speakerName: pending.speakerName,
        text: pending.finals.join(" "),
      })
    }
  }

  async #check(pending: Pending) {
    pending.checking = true
    pending.heardDuringCheck = false
    pending.finalDuringCheck = false
    const heardText = [...pending.finals, pending.interim].join(" ").trim()
    const live = pending.interim !== ""
    const { endMs } = pending
    const { verdict, check } = await checkAddress({
      recent: this.#recent.map((line) => `[${line.speakerName}] ${line.text}`),
      speakerName: pending.speakerName,
      text: heardText,
    })
    pending.checking = false
    pending.checks += 1

    // Never start on a line the speaker is still adding to.
    const outcome =
      verdict === "accept" && pending.heardDuringCheck ? "listen" : verdict
    const status =
      outcome === "accept"
        ? "queued"
        : outcome === "reject" || pending.checks >= MAX_CHECKS
          ? "rejected"
          : "listening"
    const request = await this.#save(pending, {
      check,
      status,
      heardText,
      endMs,
      live,
    }).catch((err: unknown) => {
      logger.error({ err }, "lor request: write failed")
      return null
    })
    logger.info(
      {
        sessionId: this.#sessionId,
        requestId: request?.id ?? null,
        gate: pending.gate,
        live,
        verdict,
        status,
        check,
      },
      "lor request: checked"
    )

    // A rejected live line gets a second look once the speaker finishes it.
    if (status === "rejected" && live && !pending.request) {
      if (pending.finalDuringCheck) {
        void this.#check(pending)
        return
      }
      this.#liveRejected.add(pending.participantId)
    }
    if (status !== "listening" || !request) {
      this.#settle(pending)
      return
    }
    if (pending.finalDuringCheck) {
      void this.#check(pending)
      return
    }
    this.#waitForMore(pending)
  }

  // The row exists from Jev's first yes; final-line rejections are recorded
  // too, for tuning. Null when the request is gone (rejected or cancelled).
  async #save(
    pending: Pending,
    update: {
      check: VoiceRequestCheck
      status: "listening" | "rejected" | "queued"
      heardText: string
      endMs: number
      live: boolean
    }
  ) {
    const { live, ...fields } = update
    if (pending.request) {
      const request = await recordVoiceRequestCheck(pending.request.id, fields)
      if (request) {
        pending.request = request
        this.#publish(request)
      }
      return request
    }
    if (fields.status === "rejected" && live) return null
    const request = await createVoiceRequest({
      sessionId: this.#sessionId,
      participantId: pending.participantId,
      heardText: fields.heardText,
      startMs: pending.startMs,
      endMs: fields.endMs,
      gate: pending.gate,
      check: fields.check,
      status: fields.status,
    })
    if (!request || fields.status === "rejected") return null
    pending.request = request
    this.#publish(request)
    return request
  }
}
