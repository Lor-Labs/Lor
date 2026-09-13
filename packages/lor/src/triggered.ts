import { tool } from "ai"
import { z } from "zod"

// The Act effect: a trigger hands its instructions + the inbound payload to a
// headless agent run, and Lor decides the disposition — post to the
// channel, start a plan, or do nothing. These are the disposition tools; the
// worker supplies the executors via context (it owns message fanout and run
// enqueueing). See reference/automation-primitives.md §2.

const MAX_POST_CHARS = 8000
const MAX_TITLE_CHARS = 80
const MAX_GOAL_CHARS = 4000

export type TriggeredPostMessage = (
  content: string
) => Promise<{ messageId: string }>

export type TriggeredCreatePlan = (input: {
  title: string
  goal: string
}) => Promise<{ planId: string }>

export type TriggeredCompleteLoop = (input: {
  closingNote: string
}) => Promise<void>

// What respond() needs to bind a triggered run: the prompt inputs plus the
// worker-provided disposition executors.
export type RunTriggeredContext = {
  // Event source label, e.g. "Attio · Call recording ready" or a webhook name.
  label: string
  // The trigger's Act instructions — in context only when the trigger fires.
  instructions: string
  // What earlier runs on this trigger concluded/did, plus channel activity
  // since. Null on the first run.
  briefing?: string | null
  postMessage: TriggeredPostMessage
  createPlan: TriggeredCreatePlan
  // Loop runs only: switches the prompt section to the scheduled-loop
  // framing. See reference/loops.md.
  loop?: {
    name: string
    // Human-readable schedule (describeLoopSchedule), not the raw cron.
    scheduleDescription: string
    endCondition: string | null
  }
  // Loop runs only: binds the complete_loop tool.
  completeLoop?: TriggeredCompleteLoop
}

const postContext = z.object({
  postMessage: z.custom<TriggeredPostMessage>(),
})

const createPlanContext = z.object({
  createPlan: z.custom<TriggeredCreatePlan>(),
})

const completeLoopContext = z.object({
  completeLoop: z.custom<TriggeredCompleteLoop>(),
})

export const triggeredTools = {
  post_channel_message: tool({
    description:
      "Post a markdown message to this channel as yourself. Your final answer text is NOT shown in the channel — this tool is the only way to tell the team anything. Post only when the team should actually see something; never post just to report that you did nothing.",
    inputSchema: z.object({
      content: z.string().min(1).max(MAX_POST_CHARS),
    }),
    contextSchema: postContext,
    execute: async ({ content }, { context }) => {
      try {
        const { messageId } = await context.postMessage(content)
        return { ok: true as const, messageId }
      } catch {
        return { ok: false as const, error: "Failed to post the message" }
      }
    },
  }),

  create_plan: tool({
    description:
      "Create a tracked plan in this channel for multi-step work worth a live card the team can watch and steer (a fresh plan run starts immediately with your goal as its brief). This is an escalation — use it when the event genuinely needs investigation or deliverables, not for anything a single posted message covers. `goal` is the full brief for the run that executes the plan: include the relevant details from the event payload, since the plan run won't see it otherwise.",
    inputSchema: z.object({
      title: z.string().min(1).max(MAX_TITLE_CHARS),
      goal: z.string().min(1).max(MAX_GOAL_CHARS),
    }),
    contextSchema: createPlanContext,
    execute: async ({ title, goal }, { context }) => {
      try {
        const { planId } = await context.createPlan({ title, goal })
        return { ok: true as const, planId }
      } catch {
        return { ok: false as const, error: "Failed to create the plan" }
      }
    },
  }),
}

// Bound only on loop runs (respond() spreads it in when the executor is
// present); kept out of triggeredTools so Act runs never see it.
export const completeLoopTool = {
  complete_loop: tool({
    description:
      "Permanently complete this loop so it never runs again — only when its end condition is genuinely, verifiably met (confirm with your tools first; when unsure, let the loop keep running). Usually post_channel_message a final wrap-up too, since completing is silent. The closing note is the loop's permanent record: what was achieved and how you verified the end condition.",
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

// Shared closing-note framing: the final text is the handoff to the next run
// in the chain (Act trigger or loop — both serialize per scope).
const CLOSING_NOTE_LINES = [
  "## Your closing note (handoff)",
  "Nobody reads your final answer directly — but the next run will. Runs here are strictly serialized, so you are writing to your successor. End with a short note covering:",
  "- what you concluded (the diagnosis, not a recap of the input),",
  "- what you actually did, with references someone can check (PR/issue numbers, plan titles, URLs),",
  "- what the next run should watch for or verify before repeating your work.",
  "Write it as terse notes, not prose. If you deliberately did nothing, say why in one line — that is valuable to your successor too.",
]

export function triggeredPromptSection(t: {
  label: string
  instructions: string
  briefing?: string | null
}): string {
  const sections = [
    "## Triggered run",
    `You were invoked automatically by a workspace automation ("${t.label}") — no human asked this and nobody is watching the run. Only tool calls have any effect on this channel.`,
    "",
    "The team configured this trigger with these instructions — they are your brief and take precedence for this run:",
    t.instructions.trim() ||
      "(none — use your judgment about what this event needs)",
    "",
    "Disposition rules:",
    "- Decide what this event warrants: post_channel_message to tell the team something, create_plan for multi-step work worth tracking, other tools to act directly — or nothing at all.",
    "- Doing nothing is a normal outcome (instructions often apply to only some events). To do nothing, take no action tools and say so in your closing note.",
    "- Don't ask clarifying questions — nobody will answer. When the instructions don't cover the situation, make the conservative call.",
    "",
    ...CLOSING_NOTE_LINES,
  ]
  if (t.briefing?.trim()) {
    sections.push("", t.briefing.trim())
  }
  return sections.join("\n")
}

// The loop variant: same headless rules, but framed as one beat of a
// recurring concern, with the end condition checked before the work.
export function loopPromptSection(t: {
  instructions: string
  briefing?: string | null
  loop: {
    name: string
    scheduleDescription: string
    endCondition: string | null
  }
}): string {
  const sections = [
    "## Scheduled loop run",
    `You were invoked on a schedule by the loop "${t.loop.name}" (runs ${t.loop.scheduleDescription}) — no human asked this and nobody is watching the run. Only tool calls have any effect on this channel.`,
    "",
    "The team configured this loop with these instructions — they are your brief and take precedence for this run:",
    t.instructions.trim() ||
      "(none — use your judgment about what this run needs)",
    "",
    ...(t.loop.endCondition?.trim()
      ? [
          "## End condition",
          `This loop runs until: ${t.loop.endCondition.trim()}`,
          "Check this FIRST each run. If it is genuinely met (verify with your tools, don't assume), call complete_loop — and usually post a final wrap-up message — instead of doing the work again. If it isn't met, proceed with the instructions.",
          "",
        ]
      : []),
    "Disposition rules:",
    "- Decide what this run warrants: post_channel_message to tell the team something, create_plan for multi-step work worth tracking, other tools to act directly — or nothing at all.",
    "- Doing nothing is a normal outcome (some scheduled checks find nothing new). Never post just to say nothing changed unless the instructions ask for it; say so in your closing note instead.",
    "- Don't ask clarifying questions — nobody will answer. When the instructions don't cover the situation, make the conservative call.",
    "",
    ...CLOSING_NOTE_LINES,
  ]
  if (t.briefing?.trim()) {
    sections.push("", t.briefing.trim())
  }
  return sections.join("\n")
}
