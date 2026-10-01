import {
  abandonVoiceRequest,
  checkAddress,
  createVoiceRequest,
  type LorNameMatch,
  matchLorName,
  recordVoiceRequestCheck,
} from "@repo/voice/server"
import { logger } from "./logger"
import type { HeardLine } from "./mic-stream"

// The speaker has finished once nothing new is heard from them for this long.
const QUIET_MS = 900
// A request Jev found incomplete waits this long for the speaker to go on.
const CONTINUE_MS = 4_000
const MAX_CHECKS = 3
// Earlier lines Jev sees as context.
const RECENT_LINES = 12

type Line = { speakerName: string; text: string }

type Pending = {
  requestId: Promise<string | null>
  speakerName: string
  gate: LorNameMatch
  texts: string[]
  endMs: number
  checks: number
  timer?: ReturnType<typeof setTimeout>
  checking: boolean
  // Speech arrived while Jev was deciding, so its answer may be stale.
  heardDuringCheck: boolean
}

// Listens for requests to Lor on one call: gates each final line on Lor's
// name, waits for the speaker to finish, then asks Jev. At most one pending
// request per speaker; their following lines extend it.
export class LorListener {
  readonly #sessionId: string
  readonly #recent: Line[] = []
  readonly #pending = new Map<string, Pending>()

  constructor(sessionId: string) {
    this.#sessionId = sessionId
  }

  hear(participantId: string, speakerName: string, line: HeardLine) {
    const pending = this.#pending.get(participantId)
    if (pending) {
      if (line.final) {
        pending.texts.push(line.text)
        pending.endMs = line.endMs
      }
      if (pending.checking) pending.heardDuringCheck = true
      else this.#wait(participantId, pending, QUIET_MS)
      return
    }
    if (!line.final) return

    const gate = matchLorName(line.text)
    if (!gate) {
      this.#remember({ speakerName, text: line.text })
      return
    }
    const next: Pending = {
      requestId: createVoiceRequest({
        sessionId: this.#sessionId,
        participantId,
        heardText: line.text,
        startMs: line.startMs,
        endMs: line.endMs,
        gate,
      }).catch((err: unknown) => {
        logger.error({ err }, "lor request: create failed")
        return null
      }),
      speakerName,
      gate,
      texts: [line.text],
      endMs: line.endMs,
      checks: 0,
      checking: false,
      heardDuringCheck: false,
    }
    this.#pending.set(participantId, next)
    this.#wait(participantId, next, QUIET_MS)
  }

  // Requests still listening when the transcriber leaves can't be decided.
  async close() {
    const pending = [...this.#pending.values()]
    this.#pending.clear()
    await Promise.all(
      pending.map(async (entry) => {
        clearTimeout(entry.timer)
        const requestId = await entry.requestId
        if (requestId) await abandonVoiceRequest(requestId).catch(() => {})
      })
    )
  }

  #remember(line: Line) {
    this.#recent.push(line)
    if (this.#recent.length > RECENT_LINES) this.#recent.shift()
  }

  #wait(participantId: string, pending: Pending, ms: number) {
    clearTimeout(pending.timer)
    pending.timer = setTimeout(
      () => void this.#check(participantId, pending),
      ms
    )
  }

  #settle(participantId: string, pending: Pending) {
    clearTimeout(pending.timer)
    if (this.#pending.get(participantId) === pending) {
      this.#pending.delete(participantId)
    }
    this.#remember({
      speakerName: pending.speakerName,
      text: pending.texts.join(" "),
    })
  }

  async #check(participantId: string, pending: Pending) {
    const requestId = await pending.requestId
    if (!requestId) {
      this.#settle(participantId, pending)
      return
    }
    pending.checking = true
    pending.heardDuringCheck = false
    const heardText = pending.texts.join(" ")
    const { endMs } = pending
    const { verdict, check } = await checkAddress({
      recent: this.#recent.map((line) => `[${line.speakerName}] ${line.text}`),
      speakerName: pending.speakerName,
      text: heardText,
    })
    pending.checking = false
    pending.checks += 1

    // The speaker went on during the check: decide again on the whole line,
    // unless the answer was already a clear no.
    const stale = pending.heardDuringCheck && verdict !== "reject"
    const status =
      verdict === "accept" && !stale
        ? "queued"
        : verdict === "reject" || pending.checks >= MAX_CHECKS
          ? "rejected"
          : "listening"
    const applied = await recordVoiceRequestCheck(requestId, {
      check,
      status,
      heardText,
      endMs,
    }).catch((err: unknown) => {
      logger.error({ err, requestId }, "lor request: check write failed")
      return false
    })
    logger.info(
      {
        sessionId: this.#sessionId,
        requestId,
        gate: pending.gate,
        verdict,
        status,
        check,
      },
      "lor request: checked"
    )
    if (!applied || status !== "listening") {
      this.#settle(participantId, pending)
      return
    }
    this.#wait(participantId, pending, stale ? QUIET_MS : CONTINUE_MS)
  }
}
