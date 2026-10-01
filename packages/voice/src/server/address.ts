import type { VoiceRequestCheck } from "@repo/db/schema"
import { env } from "@repo/env/server"

// Address detection: is a transcript line said to Lor? Stage 1 is a local
// name gate on every final segment; stage 2 asks Jev (TypeSafe's decision
// model on the AI Gateway), and only for lines that passed the gate.

// Deepgram writes "Lor" reliably thanks to the keyterm; these are the words
// it's still misheard as.
const LOR_NAME = /\blor\b/i
const LOR_HOMOPHONES = /\b(lore|law|lower|laura)\b/i

export type LorNameMatch = "name" | "homophone"

export function matchLorName(text: string): LorNameMatch | null {
  if (LOR_NAME.test(text)) return "name"
  if (LOR_HOMOPHONES.test(text)) return "homophone"
  return null
}

const JEV_URL = "https://ai-gateway.vercel.sh/typesafe/v1/systemone"
const JEV_MODEL = "typesafe-ai/jev"
const JEV_TIMEOUT_MS = 3_000
// Sampled 2026-10-01: direct requests scored ~0.9 addressed and passing
// mentions or homophones ~0.05; "Lor, can you, um" scored 0.04 complete.
const ADDRESSED_MIN = 0.5
const COMPLETE_MIN = 0.5

const KIND_CRITERIA = {
  request: "Asks Lor to do, find, show, or answer something",
  mention: "Mentions or talks about Lor, or thanks it, without asking anything",
  continuation: "Follows up on something Lor just did or showed",
} as const
type RequestKind = keyof typeof KIND_CRITERIA

export type AddressVerdict = "accept" | "reject" | "incomplete"

export type AddressInput = {
  // Earlier lines, oldest first, as "[Name] text".
  recent: string[]
  speakerName: string
  text: string
}

function jevState(input: AddressInput) {
  const recent =
    input.recent.length > 0
      ? `Recent conversation:\n${input.recent.join("\n")}\n\n`
      : ""
  return `Lor is an AI assistant listening to this team call. Its name may be transcribed as lore, law, lower, or Laura.\n\n${recent}Latest line, from ${input.speakerName}:\n${input.text}`
}

const QUESTIONS = {
  addressed: {
    type: "noul",
    instructions:
      "Is the speaker of the latest line talking directly to Lor, rather than to the team or about Lor?",
  },
  kind: {
    type: "choice",
    instructions: "What is the latest line?",
    criteria: KIND_CRITERIA,
  },
  complete: {
    type: "noul",
    instructions:
      "Has the speaker finished saying what they want, rather than stopping mid-request?",
  },
}

function isKind(value: unknown): value is RequestKind {
  return typeof value === "string" && value in KIND_CRITERIA
}

type JevAnswers = Record<
  string,
  { noul?: unknown; choice?: unknown; confidence?: unknown } | undefined
>

function parseAnswers(body: unknown) {
  const answers = (body as { answers?: JevAnswers } | null)?.answers
  const addressed = answers?.addressed?.noul
  const kind = answers?.kind?.choice
  const kindConfidence = answers?.kind?.confidence
  const complete = answers?.complete?.noul
  if (
    typeof addressed !== "number" ||
    !isKind(kind) ||
    typeof kindConfidence !== "number" ||
    typeof complete !== "number"
  ) {
    return null
  }
  return { addressed, kind, kindConfidence, complete }
}

function verdictFor(check: VoiceRequestCheck): AddressVerdict {
  if ("error" in check) return "reject"
  if (check.addressed < ADDRESSED_MIN || check.kind === "mention") {
    return "reject"
  }
  return check.complete >= COMPLETE_MIN ? "accept" : "incomplete"
}

// Fails closed: an error, a timeout, or an unexpected answer rejects.
export async function checkAddress(
  input: AddressInput
): Promise<{ verdict: AddressVerdict; check: VoiceRequestCheck }> {
  const started = Date.now()
  const base = { model: JEV_MODEL }
  let check: VoiceRequestCheck
  try {
    const res = await fetch(JEV_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.AI_GATEWAY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: JEV_MODEL,
        state: jevState(input),
        questions: QUESTIONS,
      }),
      signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
    })
    const answers = res.ok ? parseAnswers(await res.json()) : null
    check = answers
      ? { ...base, latencyMs: Date.now() - started, ...answers }
      : {
          ...base,
          latencyMs: Date.now() - started,
          error: res.ok ? "unexpected answer" : `HTTP ${res.status}`,
        }
  } catch (err) {
    check = {
      ...base,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.name : "request failed",
    }
  }
  return { verdict: verdictFor(check), check }
}
