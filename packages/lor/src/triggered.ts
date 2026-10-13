import { tool } from "ai"
import { z } from "zod"

// Headless-born sessions: loops and connector triggers (the Act effect). Each
// Act event starts its own session; a loop is one recurring session.
// See reference/workspace-model.md, decision 1.

export type TriggeredCompleteLoop = (input: {
  closingNote: string
}) => Promise<void>

// Every run in an Act session. The trigger's instructions are stable per
// trigger, so they are safe in the system prompt; the event and the briefing
// ride the session's first turn.
export type RunTriggerContext = {
  instructions: string
}

// Every run in a loop's session (reference/workspace-model.md, decision 1):
// the loop's standing brief frames it, and complete_loop binds when the loop
// has an end condition. Stable per loop, so it is safe in the system prompt.
export type RunLoopContext = {
  name: string
  // Human-readable schedule (describeLoopSchedule), not the raw cron.
  scheduleDescription: string
  instructions: string
  endCondition: string | null
  completeLoop?: TriggeredCompleteLoop
}

const completeLoopContext = z.object({
  completeLoop: z.custom<TriggeredCompleteLoop>(),
})

// Bound only on loop runs (respond() spreads it in when the executor is
// present), so Act runs never see it.
export const completeLoopTool = {
  complete_loop: tool({
    description:
      "Permanently complete this loop so it never runs again — only when its end condition is genuinely, verifiably met (confirm with your tools first; when unsure, let the loop keep running). Say so in your reply too. The closing note is the loop's permanent record: what was achieved and how you verified the end condition.",
    inputSchema: z.object({
      closingNote: z.string().min(1).max(2000),
    }),
    contextSchema: completeLoopContext,
    execute: async ({ closingNote }, { context }) => {
      try {
        await context.completeLoop({ closingNote })
        return { ok: true as const }
      } catch {
        return { ok: false as const, error: "Failed to complete the loop" }
      }
    },
  }),
}

export function triggerSessionPromptSection(t: RunTriggerContext): string {
  return [
    "## This session was started by an automation",
    "A workspace automation started this session when its event arrived. The event is the first turn, under the event source's name. Teammates can also talk to you here later; answer them normally.",
    "",
    "The team set up this automation with these instructions — they are your brief for the event:",
    t.instructions.trim() ||
      "(none — use your judgment about what this event needs)",
    "",
    "On the event:",
    "- Nobody asked in real time and nobody may be watching. Don't ask clarifying questions; when the instructions don't cover the situation, make the conservative call.",
    "- Doing nothing is a normal outcome (instructions often apply to only some events). If the event needs nothing, say so in one short line.",
    "- To bring a teammate in, mention them: that adds them to this session and notifies them.",
    "- Your reply is what the people following this session read, and the next event's run gets it as a briefing. Lead with what you concluded, then what you did with references someone can check (PR/issue numbers, URLs), then anything the next run should verify before repeating your work.",
  ].join("\n")
}

// A loop's session: one recurring conversation. Each scheduled run is a turn
// that starts with a "Loop schedule" line; the transcript carries what
// earlier runs found, so there is no separate briefing.
export function loopSessionPromptSection(loop: RunLoopContext): string {
  return [
    "## This is a loop's session",
    `This session belongs to the loop "${loop.name}", which runs ${loop.scheduleDescription}. Each scheduled run is a turn that starts with a "Loop schedule" line. When that is the newest message, do the loop's work now. Teammates can also talk to you here between runs; answer them normally.`,
    "",
    "The team set up this loop with these standing instructions — they are your brief for every scheduled run:",
    loop.instructions.trim() ||
      "(none — use your judgment about what each run needs)",
    "",
    ...(loop.endCondition?.trim()
      ? [
          "## End condition",
          `This loop runs until: ${loop.endCondition.trim()}`,
          "On each scheduled run, check this FIRST. If it is genuinely met (verify with your tools, don't assume), call complete_loop instead of doing the work again. If it isn't met, proceed with the instructions.",
          "",
        ]
      : []),
    "On scheduled runs:",
    "- Nobody asked in real time and nobody may be watching. Don't ask clarifying questions; when the instructions don't cover the situation, make the conservative call.",
    "- Your reply is what the people following this session read, and what your next run sees. Lead with what matters. If nothing needs attention, say so in one short line.",
  ].join("\n")
}
