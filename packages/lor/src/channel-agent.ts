import { and, asc, db, eq, inArray, schema } from "@repo/db"
import type { AgentInboxLane } from "@repo/db/schema"
import { tool } from "ai"
import { z } from "zod"
import type { ApprovalDecision, RunCounters, RunStepRecord } from "./run"
import { formatSpeakerLine, sanitizeInlineLabel } from "./transcript"

// The channel's always-on agent (reference/always-on-agents.md): one
// agent and one chat per channel. Its turns start from the channel's inbox,
// run on its own loop (agent-loop.ts), keep its own text private, and reach
// the channel chat only through send_message.

// A runaway guard on one batch, not a window: the agent can read the chat
// itself for anything older.
const INBOX_BATCH_MAX = 200

const MAX_MESSAGE_CHARS = 8000

export type SendMessageExecutor = (input: {
  content: string
}) => Promise<{ messageId: string }>

// Code sessions the agent runs as helpers (reference/always-on-agents.md §6).
// The worker implements them; each returns what the model reads.
export type AgentSessionTools = {
  start: (input: {
    repo?: string
    baseBranch?: string
    title: string
    task: string
  }) => Promise<unknown>
  check: (input: { sessionId: string }) => Promise<unknown>
  message: (input: { sessionId: string; message: string }) => Promise<unknown>
  stop: (input: { sessionId: string }) => Promise<unknown>
}

// Set on every run of a channel's agent. The worker binds the hooks, since
// it owns the run's lease and billing.
export type RunAgentContext = {
  channelName: string | null
  sendMessage: SendMessageExecutor
  // "compact" summarizes the conversation instead of running a turn.
  mode: "turn" | "compact"
  // Adds one model call to the run's counters and spend, under its lease.
  recordUsage: (
    usage: RunStepRecord,
    kind: "step" | "compaction"
  ) => Promise<RunCounters & { costUsd?: number }>
  // The decisions on a paused turn's approvals, claimed for this run.
  loadDecisions?: (pausedRunId: string) => Promise<ApprovalDecision[]>
  sessions?: AgentSessionTools
}

const sendMessageContext = z.object({
  sendMessage: z.custom<SendMessageExecutor>(),
})

export const sendMessageTool = {
  send_message: tool({
    description:
      "Post a message in this channel's chat, where the team reads it. This is the only way anything you write reaches people: your other text stays in your private working notes. Use it to answer whoever addressed you, to report a result, or to ask someone for a decision. Write for the whole channel and mention a person as <@id> when the message is for them. Do not call it when you have nothing worth saying: ending your turn without sending is fine.",
    inputSchema: z.object({
      content: z
        .string()
        .min(1)
        .max(MAX_MESSAGE_CHARS)
        .describe("the message, in Markdown"),
    }),
    contextSchema: sendMessageContext,
    execute: async ({ content }, { context }) => {
      const { messageId } = await context.sendMessage({ content })
      return { ok: true as const, messageId }
    },
  }),
}

const sessionContext = z.object({
  sessions: z.custom<AgentSessionTools>(),
})

const sessionId = z.string().uuid().describe("the session's id")

export const agentSessionTools = {
  start_session: tool({
    description:
      "Start a code session: a coding agent working on one branch of one repository, with its own computer, while you go on. Give it a short title and a complete task: what to change and why, the issue or messages it came from, and what done looks like. It can read the team's tools but cannot write to them or post in the chat; it reports back to you. When its turn ends you are woken with its report. Call without `repo` to list the repositories you can use. A piece of work across repositories is one session per repository.",
    inputSchema: z.object({
      repo: z
        .string()
        .optional()
        .describe("owner/name; leave out to list the repositories"),
      baseBranch: z
        .string()
        .optional()
        .describe(
          "the branch to start from; the repository's default if left out"
        ),
      title: z.string().min(1).max(120).describe("a short title for people"),
      task: z.string().min(1).max(20_000),
    }),
    contextSchema: sessionContext,
    execute: async (input, { context }) => context.sessions.start(input),
  }),
  check_session: tool({
    description:
      "Check a session you started: whether it is working, done, waiting for a person's approval or failed, its branch, and its last reply.",
    inputSchema: z.object({ sessionId }),
    contextSchema: sessionContext,
    execute: async (input, { context }) => context.sessions.check(input),
  }),
  message_session: tool({
    description:
      "Send a session you started a follow-up: an answer to its question, a correction or the next step. It runs when the session is idle; while it is working, wait for its report.",
    inputSchema: z.object({
      sessionId,
      message: z.string().min(1).max(20_000),
    }),
    contextSchema: sessionContext,
    execute: async (input, { context }) => context.sessions.message(input),
  }),
  stop_session: tool({
    description:
      "Stop the turn a session you started is running. Its branch and files stay.",
    inputSchema: z.object({ sessionId }),
    contextSchema: sessionContext,
    execute: async (input, { context }) => context.sessions.stop(input),
  }),
}

// Stable per channel, so it is safe in the system prompt.
export function channelAgentPromptSection(agent: RunAgentContext): string {
  const channel = agent.channelName ? `#${agent.channelName}` : "this channel"
  return `## You are ${channel}'s agent

You are the always-on agent for ${channel}: one teammate the whole channel shares. People and you talk in the channel's chat.

- Each turn starts from your inbox, after the time. "Since you last looked" lists what people said in the chat that was not for you: read it as context and do not answer it line by line. "What woke you" is what you are asked to handle now.
- Nothing you write here reaches anyone. This conversation is your private working notes. To speak, call send_message: it posts in the channel's chat for everyone.
- Answer the person who addressed you with one send_message. Mention them as <@id> only when the message needs their attention.
- You may stay quiet. When nothing needs saying, end the turn without send_message.
- Never promise to come back later unless a tool schedules it for you.
- You have no computer of your own yet: you can't run code, use a shell or make files yourself. Work on code goes to code sessions: start_session hands a task to a coding agent on one repository, and you are woken with its report when its turn ends. Tell people in the chat what you started and, when it reports, what came of it. People review the branch and open pull requests; you and the sessions never do.
- When you are done, end the turn. Any closing note to yourself is one short line.
- Your conversation is kept across turns, and summarized when it grows long. read_agent_history reads your earlier turns word for word, and read_thread reads the chat. Use them before guessing at something you no longer see.`
}

// An item that is not a chat message, such as a session's report.
export async function addInboxNote(input: {
  workspaceId: string
  channelId: string
  source: "session"
  sourceId: string
  note: string
  lane: AgentInboxLane
}): Promise<boolean> {
  const rows = await db
    .insert(schema.agentInbox)
    .values({
      workspaceId: input.workspaceId,
      channelId: input.channelId,
      source: input.source,
      sourceId: input.sourceId,
      note: input.note,
      lane: input.lane,
    })
    .onConflictDoNothing()
    .returning({ id: schema.agentInbox.id })
  return rows.length > 0
}

export async function addInboxMessage(input: {
  workspaceId: string
  channelId: string
  messageId: string
  lane: AgentInboxLane
}): Promise<boolean> {
  const rows = await db
    .insert(schema.agentInbox)
    .values({
      workspaceId: input.workspaceId,
      channelId: input.channelId,
      source: "message",
      sourceId: input.messageId,
      messageId: input.messageId,
      lane: input.lane,
    })
    .onConflictDoNothing()
    .returning({ id: schema.agentInbox.id })
  return rows.length > 0
}

export type InboxBatch = {
  itemIds: string[]
  woke: number
  unread: number
  text: string
  // The first chat message that woke the agent; null when only a note did.
  triggerMessageId: string | null
}

// Everything pending for the channel, as the text of one wake line. Null when
// nothing in the wake lane is pending: unread items alone never start a turn.
export async function loadInboxBatch(
  channelId: string
): Promise<InboxBatch | null> {
  const rows = await db
    .select({
      id: schema.agentInbox.id,
      lane: schema.agentInbox.lane,
      note: schema.agentInbox.note,
      messageId: schema.message.id,
      content: schema.message.content,
      attachments: schema.message.attachments,
      authorName: schema.user.name,
    })
    .from(schema.agentInbox)
    .leftJoin(
      schema.message,
      eq(schema.agentInbox.messageId, schema.message.id)
    )
    .leftJoin(schema.user, eq(schema.message.authorId, schema.user.id))
    .where(
      and(
        eq(schema.agentInbox.channelId, channelId),
        eq(schema.agentInbox.status, "pending")
      )
    )
    .orderBy(asc(schema.agentInbox.createdAt))
  const firstWake = rows.find((row) => row.lane === "wake")
  if (!firstWake) return null

  // Over the guard, the oldest unread items are left out and said so. What
  // woke the agent is never cut.
  const overflow = Math.max(0, rows.length - INBOX_BATCH_MAX)
  const waiting = rows.filter((row) => row.lane === "wait")
  const omitted = Math.min(overflow, waiting.length)
  const unread = waiting.slice(omitted)
  const woke = rows.filter((row) => row.lane === "wake")

  const line = (row: (typeof rows)[number]) => {
    if (row.note !== null || !row.messageId) return row.note ?? ""
    const files = (row.attachments ?? []).map(
      (file) =>
        `\n[file: ${sanitizeInlineLabel(file.filename)} — ${file.contentType}, ${file.size} bytes — ${file.url}]`
    )
    // The message id lets the agent read around the message. People's
    // mention ids come from the roster, never from text in a message.
    return formatSpeakerLine(
      row.authorName ?? "Someone",
      `${row.content ?? ""}${files.join("")}\n(message ${row.messageId})`
    )
  }
  const sections = [
    unread.length > 0 || omitted > 0
      ? `Since you last looked:${
          omitted > 0
            ? `\n(${omitted} earlier message${omitted === 1 ? " is" : "s are"} not shown here. Read the chat if you need them.)`
            : ""
        }\n${unread.map(line).join("\n")}`
      : null,
    `What woke you:\n${woke.map(line).join("\n")}`,
  ].filter((section): section is string => section !== null)

  return {
    itemIds: rows.map((row) => row.id),
    woke: woke.length,
    unread: unread.length + omitted,
    text: sections.join("\n\n"),
    triggerMessageId:
      woke.find((row) => row.messageId)?.messageId ?? firstWake.messageId,
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export async function markInboxRead(
  tx: Tx | typeof db,
  itemIds: string[],
  runId: string
): Promise<void> {
  if (itemIds.length === 0) return
  await tx
    .update(schema.agentInbox)
    .set({ status: "read", readAt: new Date(), runId })
    .where(
      and(
        inArray(schema.agentInbox.id, itemIds),
        eq(schema.agentInbox.status, "pending")
      )
    )
}

export async function hasPendingWake(channelId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.agentInbox.id })
    .from(schema.agentInbox)
    .where(
      and(
        eq(schema.agentInbox.channelId, channelId),
        eq(schema.agentInbox.status, "pending"),
        eq(schema.agentInbox.lane, "wake")
      )
    )
    .limit(1)
  return Boolean(row)
}
