import { and, asc, db, eq, inArray, schema } from "@repo/db"
import type { AgentInboxLane } from "@repo/db/schema"
import { tool } from "ai"
import { z } from "zod"
import { formatSpeakerLine, sanitizeInlineLabel } from "./transcript"

// The channel's always-on agent (reference/always-on-agents.md): one
// agent and one chat per channel. Its turns start from the channel's inbox,
// its own text stays private, and it speaks in the channel chat only through
// send_message.

export const AGENT_SESSION_TITLE = "Channel agent"

// A runaway guard on one batch, not a window: the agent can read the chat
// itself for anything older.
const INBOX_BATCH_MAX = 200

const MAX_MESSAGE_CHARS = 8000

export type SendMessageExecutor = (input: {
  content: string
}) => Promise<{ messageId: string }>

// Set on every run in a channel agent's conversation.
export type RunAgentContext = {
  channelName: string | null
  sendMessage: SendMessageExecutor
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

// Stable per channel, so it is safe in the system prompt.
export function channelAgentPromptSection(agent: RunAgentContext): string {
  const channel = agent.channelName ? `#${agent.channelName}` : "this channel"
  return `## You are ${channel}'s agent

You are the always-on agent for ${channel}: one teammate the whole channel shares. People and you talk in the channel's chat.

- Each turn starts from your inbox. "Since you last looked" lists what people said in the chat that was not for you: read it as context and do not answer it line by line. "What woke you" is what you are asked to handle now.
- Nothing you write here reaches anyone. This conversation is your private working notes. To speak, call send_message: it posts in the channel's chat for everyone.
- Answer the person who addressed you with one send_message. Mention them as <@id> only when the message needs their attention.
- You may stay quiet. When nothing needs saying, end the turn without send_message.
- Never promise to come back later unless a tool schedules it for you.`
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
      messageId: schema.message.id,
      content: schema.message.content,
      attachments: schema.message.attachments,
      authorName: schema.user.name,
    })
    .from(schema.agentInbox)
    .innerJoin(
      schema.message,
      eq(schema.agentInbox.messageId, schema.message.id)
    )
    .innerJoin(schema.user, eq(schema.message.authorId, schema.user.id))
    .where(
      and(
        eq(schema.agentInbox.channelId, channelId),
        eq(schema.agentInbox.status, "pending")
      )
    )
    .orderBy(asc(schema.agentInbox.createdAt))
  if (!rows.some((row) => row.lane === "wake")) return null

  // Over the guard, the oldest unread items are left out and said so. What
  // woke the agent is never cut.
  const overflow = Math.max(0, rows.length - INBOX_BATCH_MAX)
  const waiting = rows.filter((row) => row.lane === "wait")
  const omitted = Math.min(overflow, waiting.length)
  const unread = waiting.slice(omitted)
  const woke = rows.filter((row) => row.lane === "wake")

  const line = (row: (typeof rows)[number]) => {
    const files = (row.attachments ?? []).map(
      (file) =>
        `\n[file: ${sanitizeInlineLabel(file.filename)} — ${file.contentType}, ${file.size} bytes — ${file.url}]`
    )
    // The message id lets the agent read around the message. People's
    // mention ids come from the roster, never from text in a message.
    return formatSpeakerLine(
      row.authorName,
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
  }
}

export async function markInboxRead(
  itemIds: string[],
  wakeMessageId: string
): Promise<void> {
  if (itemIds.length === 0) return
  await db
    .update(schema.agentInbox)
    .set({ status: "read", readAt: new Date(), wakeMessageId })
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
