import { tool } from "ai"
import { z } from "zod"

// The Act effect: a trigger hands its instructions + the inbound payload to a
// headless agent run, and Merlin decides the disposition — post to the
// channel, create a task, or do nothing. These are the disposition tools; the
// worker supplies the executors via context (it owns message fanout and run
// enqueueing). See reference/automation-primitives.md §2.

const MAX_POST_CHARS = 8000
const MAX_TITLE_CHARS = 80
const MAX_GOAL_CHARS = 4000

export type TriggeredPostMessage = (
  content: string
) => Promise<{ messageId: string }>

export type TriggeredCreateTask = (input: {
  title: string
  goal: string
}) => Promise<{ taskId: string }>

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
  createTask: TriggeredCreateTask
}

const postContext = z.object({
  postMessage: z.custom<TriggeredPostMessage>(),
})

const createTaskContext = z.object({
  createTask: z.custom<TriggeredCreateTask>(),
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

  create_task: tool({
    description:
      "Create a tracked task in this channel for multi-step work worth a live card the team can watch and steer (a fresh task run starts immediately with your goal as its brief). This is an escalation — use it when the event genuinely needs investigation or deliverables, not for anything a single posted message covers. `goal` is the full brief for the run that executes the task: include the relevant details from the event payload, since the task won't see it otherwise.",
    inputSchema: z.object({
      title: z.string().min(1).max(MAX_TITLE_CHARS),
      goal: z.string().min(1).max(MAX_GOAL_CHARS),
    }),
    contextSchema: createTaskContext,
    execute: async ({ title, goal }, { context }) => {
      try {
        const { taskId } = await context.createTask({ title, goal })
        return { ok: true as const, taskId }
      } catch {
        return { ok: false as const, error: "Failed to create the task" }
      }
    },
  }),
}

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
    "- Decide what this event warrants: post_channel_message to tell the team something, create_task for multi-step work worth tracking, other tools to act directly — or nothing at all.",
    "- Doing nothing is a normal outcome (instructions often apply to only some events). To do nothing, take no action tools and say so in your closing note.",
    "- Don't ask clarifying questions — nobody will answer. When the instructions don't cover the situation, make the conservative call.",
    "",
    // The final text used to be discarded outright, which both wasted the
    // model's own conclusion and invited it to phone in the ending. It is now
    // the handoff note the next run on this trigger reads.
    "## Your closing note (handoff)",
    "Nobody reads your final answer directly — but the next run on this trigger will, and this trigger will fire again. Runs here are strictly serialized, so you are writing to your successor. End with a short note covering:",
    "- what you concluded (the diagnosis, not a recap of the payload),",
    "- what you actually did, with references someone can check (PR/issue numbers, task titles, URLs),",
    "- what the next run should watch for or verify before repeating your work.",
    "Write it as terse notes, not prose. If you deliberately did nothing, say why in one line — that is valuable to your successor too.",
  ]
  if (t.briefing?.trim()) {
    sections.push("", t.briefing.trim())
  }
  return sections.join("\n")
}
