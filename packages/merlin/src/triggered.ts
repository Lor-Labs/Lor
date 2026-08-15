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
      "Post a markdown message to this channel as yourself. In this triggered run your final answer text is DISCARDED — this tool is the only way to tell the team anything. Post only when the team should actually see something; never post just to report that you did nothing.",
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
}): string {
  return [
    "## Triggered run",
    `You were invoked automatically by a workspace automation ("${t.label}") — no human asked this and nobody is watching the run. Your final answer text is discarded; only tool calls have any effect. The user message is the inbound event payload.`,
    "",
    "The team configured this trigger with these instructions — they are your brief and take precedence for this run:",
    t.instructions.trim() ||
      "(none — use your judgment about what this event needs)",
    "",
    "Disposition rules:",
    "- Decide what this event warrants: post_channel_message to tell the team something, create_task for multi-step work worth tracking, other tools to act directly — or nothing at all.",
    "- Doing nothing is a normal outcome (instructions often apply to only some events). To do nothing, simply end with a one-line reason; don't post it to the channel.",
    "- Don't ask clarifying questions — nobody will answer. When the instructions don't cover the situation, make the conservative call.",
  ].join("\n")
}
