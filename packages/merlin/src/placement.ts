import { z } from "zod"
import { generateSmallObject } from "./structured"
import { formatSpeakerLine } from "./transcript"

const PLACEMENT_TIMEOUT_MS = 15_000

export type PlacementTurn = { authorName: string; content: string }
export type ReplyPlacement = "channel" | "thread" | "task"

const PLACEMENT_PROMPT = `You decide how Merlin — an AI teammate — should handle the latest request in a team chat channel. Based on the recent conversation, choose one:

- "channel": answer visibly in the main channel. Use when the reply is broadly useful or interesting to the whole team — a decision, an announcement, shared knowledge, or a short factual answer others would want to see.
- "thread": answer in a thread off the latest message. Use for a narrow clarification, a personal or back-and-forth exchange, a long/detailed answer that would clutter the channel, or anything of low general interest.
- "task": treat it as delegated work, not a question. Use ONLY when the latest message clearly assigns Merlin a substantial job with a deliverable outcome — produce or transform files, analyze data and deliver results, write a document or report, complete multi-step work. A question about the team's work is never a task, even a hard one. Requests to change code or open a pull request are also never a task — Merlin's code tools handle those in the conversation. Likewise, requests for recurring or scheduled work ("check X every hour", "post a digest every Friday", "set up/recreate that loop") are never a task — Merlin's loop tools handle those in the conversation.

Earlier channel messages are background only. They may have been answered in separate threads whose replies are not shown. Do not treat their requests as pending work or include their deliverables in the task title. Classify and title only the current request; use background only to resolve references in that request.

Between "channel" and "thread", lean toward "thread" when unsure — keep the main channel uncluttered. Choose "task" only on a clear delegation.

When you choose "task", also set "taskTitle": a short imperative title for the work, 3–8 words, like an issue title (e.g. "Prepare CPA-ready financial package"). Omit it otherwise.`

export type PlacementDecision = {
  placement: ReplyPlacement
  taskTitle: string | null
}

export async function decideReplyPlacement(
  conversation: PlacementTurn[],
  currentRequest?: PlacementTurn
): Promise<PlacementDecision> {
  const request = currentRequest ?? conversation.at(-1)
  const background = currentRequest
    ? conversation.filter(
        (turn) =>
          turn.authorName !== currentRequest.authorName ||
          turn.content !== currentRequest.content
      )
    : conversation.slice(0, -1)
  const transcript = background
    .map((t) => formatSpeakerLine(t.authorName, t.content))
    .join("\n")

  const result = await generateSmallObject({
    schema: z.object({
      placement: z.enum(["channel", "thread", "task"]),
      taskTitle: z.string().optional(),
    }),
    prompt: `${PLACEMENT_PROMPT}\n\nEarlier channel background (not pending requests):\n${transcript}\n\nCurrent request:\n${request ? formatSpeakerLine(request.authorName, request.content) : "(none)"}`,
    // Inline realtime path; callers default to channel on abort.
    abortSignal: AbortSignal.timeout(PLACEMENT_TIMEOUT_MS),
  })

  return {
    placement: result.object.placement,
    taskTitle: result.object.taskTitle?.trim() || null,
  }
}
