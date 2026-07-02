import { anthropic } from "@ai-sdk/anthropic"
import { generateObject } from "ai"
import { z } from "zod"

const PLACEMENT_MODEL = "claude-haiku-4-5"
const PLACEMENT_TIMEOUT_MS = 15_000

export type PlacementTurn = { authorName: string; content: string }
export type ReplyPlacement = "channel" | "thread"

const PLACEMENT_PROMPT = `You decide where Merlin — an AI teammate — should post its reply in a team chat channel. Based on the recent conversation, choose one:

- "channel": post visibly in the main channel. Use when the reply is broadly useful or interesting to the whole team — a decision, an announcement, shared knowledge, or a short factual answer others would want to see.
- "thread": tuck the reply into a thread off the latest message. Use for a narrow clarification, a personal or back-and-forth exchange, a long/detailed answer that would clutter the channel, or anything of low general interest.

Lean toward "thread" when unsure — keep the main channel uncluttered.`

export async function decideReplyPlacement(
  conversation: PlacementTurn[]
): Promise<ReplyPlacement> {
  const transcript = conversation
    .map((t) => `${t.authorName}: ${t.content}`)
    .join("\n")

  const result = await generateObject({
    model: anthropic(PLACEMENT_MODEL),
    schema: z.object({ placement: z.enum(["channel", "thread"]) }),
    prompt: `${PLACEMENT_PROMPT}\n\nRecent conversation:\n${transcript}`,
    // Inline realtime path; callers default to channel on abort.
    // (generateObject omits the v7 `timeout` option, so AbortSignal it is.)
    abortSignal: AbortSignal.timeout(PLACEMENT_TIMEOUT_MS),
  })

  return result.object.placement
}
