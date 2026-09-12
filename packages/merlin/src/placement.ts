import { z } from "zod"
import { generateSmallObject } from "./structured"
import { formatSpeakerLine } from "./transcript"

const PLACEMENT_TIMEOUT_MS = 15_000

export type PlacementTurn = { authorName: string; content: string }
export type ReplyPlacement = "channel" | "thread"

const PLACEMENT_PROMPT = `You decide where Merlin — an AI teammate — should answer the latest request in a team chat channel. Based on the recent conversation, choose one:

- "channel": answer visibly in the main channel. Use when the reply is broadly useful or interesting to the whole team — a decision, an announcement, shared knowledge, or a short factual answer others would want to see.
- "thread": answer in a thread off the latest message. Use for a narrow clarification, a personal or back-and-forth exchange, a long/detailed answer that would clutter the channel, anything of low general interest — and ALWAYS for delegated work (produce or transform files, analyze data and deliver results, write a document or report, change code, multi-step jobs): the work happens in the thread so the channel stays readable.

Earlier channel messages are background only. They may have been answered in separate threads whose replies are not shown. Do not treat their requests as pending work. Classify only the current request; use background only to resolve references in that request.

Lean toward "thread" when unsure — keep the main channel uncluttered.`

export type PlacementDecision = {
  placement: ReplyPlacement
}

export async function decideReplyPlacement(
  conversation: PlacementTurn[],
  currentRequest?: PlacementTurn
): Promise<PlacementDecision> {
  const request = currentRequest ?? conversation.at(-1)
  let requestIndex = conversation.length - 1
  if (currentRequest) {
    requestIndex = -1
    for (let index = conversation.length - 1; index >= 0; index--) {
      const turn = conversation[index]
      if (
        turn?.authorName === currentRequest.authorName &&
        turn.content === currentRequest.content
      ) {
        requestIndex = index
        break
      }
    }
  }
  const background = conversation.filter((_, index) => index !== requestIndex)
  const transcript = background
    .map((t) => formatSpeakerLine(t.authorName, t.content))
    .join("\n")

  const result = await generateSmallObject({
    schema: z.object({
      placement: z.enum(["channel", "thread"]),
    }),
    prompt: `${PLACEMENT_PROMPT}\n\nEarlier channel background (not pending requests):\n${transcript}\n\nCurrent request:\n${request ? formatSpeakerLine(request.authorName, request.content) : "(none)"}`,
    // Inline realtime path; callers default to channel on abort.
    abortSignal: AbortSignal.timeout(PLACEMENT_TIMEOUT_MS),
  })

  return { placement: result.object.placement }
}
