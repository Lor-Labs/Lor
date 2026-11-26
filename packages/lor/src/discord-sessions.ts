import { and, db, eq, schema } from "@repo/db"
import { env } from "@repo/env/server"
import {
  type DiscordButton,
  discordConfigured,
  discordLinkFor,
  discordThreadForRoot,
  editAgentDiscordMessage,
  postAgentToDiscord,
  startDiscordThread,
} from "./discord"

// A code session started from a Discord place (reference/agents-and-chats.md,
// decision 51) shows there as a card in the thread of the request: what it
// works on, how it is doing, and links to it in Lor and, once pushed, on
// GitHub. Its approvals are asked in the same thread with buttons.

export type SessionCardState =
  | "working"
  | "approval"
  | "finished"
  | "failed"
  | "stopped"

const STATE_LINE: Record<SessionCardState, string> = {
  working: "Working on it. Replies here go to it through the agent.",
  approval: "Waiting for an approval below.",
  finished: "Finished its turn. Reply here to send it more.",
  failed: "Failed. Open it in Lor to see why.",
  stopped: "Stopped.",
}

async function sessionFor(sessionId: string) {
  const [row] = await db
    .select({
      id: schema.agentSession.id,
      title: schema.agentSession.title,
      repoFullName: schema.agentSession.repoFullName,
      newBranch: schema.agentSession.newBranch,
      baseBranch: schema.agentSession.baseBranch,
      slug: schema.workspace.slug,
    })
    .from(schema.agentSession)
    .innerJoin(
      schema.workspace,
      eq(schema.workspace.id, schema.agentSession.workspaceId)
    )
    .where(eq(schema.agentSession.id, sessionId))
  return row ?? null
}

type Card = typeof schema.discordSessionCard.$inferSelect

function render(
  session: NonNullable<Awaited<ReturnType<typeof sessionFor>>>,
  card: Pick<Card, "state" | "branchUrl" | "pullRequestUrl">
) {
  const branch = session.newBranch ?? session.baseBranch
  const content = [
    `**Code session:** ${session.title ?? "Untitled"}`,
    [session.repoFullName, branch ? `branch \`${branch}\`` : null]
      .filter(Boolean)
      .join(" · "),
    STATE_LINE[card.state as SessionCardState] ?? STATE_LINE.working,
  ].join("\n")
  const buttons: DiscordButton[] = [
    {
      label: "Open in Lor",
      url: `${env.APP_BASE_URL}/${session.slug}/session/${session.id}`,
    },
  ]
  if (card.pullRequestUrl) {
    buttons.push({ label: "Pull request", url: card.pullRequestUrl })
  } else if (card.branchUrl) {
    buttons.push({ label: "View branch", url: card.branchUrl })
  }
  return { content, buttons }
}

// Posts a session's card in the place it was asked for: in the turn's
// thread, or in a new Discord thread on the message that asked. Returns the
// Lor thread root the agent goes on answering in, or null when the card went
// to the channel (or nowhere: not a place).
export async function postSessionCard(input: {
  sessionId: string
  channelId: string
  agentId: string
  threadRootId: string | null
  triggerMessageId: string | null
}): Promise<{ threadRootId: string | null } | null> {
  if (!discordConfigured()) return null
  const link = await discordLinkFor(input.channelId)
  const session = await sessionFor(input.sessionId)
  if (!link || !session) return null
  let threadRootId = input.threadRootId
  if (!threadRootId && input.triggerMessageId) {
    const started = await startDiscordThread({
      channelId: input.channelId,
      threadRootId: input.triggerMessageId,
      name: session.title ?? "Code session",
    }).catch(() => null)
    if (started) threadRootId = input.triggerMessageId
  }
  const { content, buttons } = render(session, {
    state: "working",
    branchUrl: null,
    pullRequestUrl: null,
  })
  const posted = await postAgentToDiscord({
    channelId: input.channelId,
    agentId: input.agentId,
    messageId: null,
    content,
    buttons,
    threadRootId,
  })
  if (!posted) return null
  await db
    .insert(schema.discordSessionCard)
    .values({
      sessionId: input.sessionId,
      channelId: input.channelId,
      agentId: input.agentId,
      discordMessageId: posted.discordMessageId,
      discordThreadId: threadRootId
        ? await discordThreadForRoot(threadRootId)
        : null,
    })
    .onConflictDoNothing()
  return { threadRootId }
}

async function cardFor(sessionId: string) {
  const [card] = await db
    .select()
    .from(schema.discordSessionCard)
    .where(eq(schema.discordSessionCard.sessionId, sessionId))
  return card ?? null
}

// Changes a session's card: its state, or what was pushed. A session with no
// card (not started from Discord) is left alone.
export async function updateSessionCard(
  sessionId: string,
  change: {
    state?: SessionCardState
    branchUrl?: string
    pullRequestUrl?: string
  }
) {
  if (!discordConfigured()) return
  const card = await cardFor(sessionId)
  if (!card) return
  const next = {
    state: change.state ?? card.state,
    branchUrl: change.branchUrl ?? card.branchUrl,
    pullRequestUrl: change.pullRequestUrl ?? card.pullRequestUrl,
  }
  if (
    next.state === card.state &&
    next.branchUrl === card.branchUrl &&
    next.pullRequestUrl === card.pullRequestUrl
  )
    return
  const session = await sessionFor(sessionId)
  if (!session) return
  await db
    .update(schema.discordSessionCard)
    .set(next)
    .where(eq(schema.discordSessionCard.sessionId, sessionId))
  const { content, buttons } = render(session, next)
  await editAgentDiscordMessage({
    channelId: card.channelId,
    agentId: card.agentId,
    discordMessageId: card.discordMessageId,
    discordThreadId: card.discordThreadId,
    content,
    buttons,
  })
}

// A session run's approvals, asked in the card's thread: Approve and Reject
// buttons for a tool call, and a link to Lor for what needs more than a
// yes or no (a plan to read, questions to answer).
export async function postSessionApprovals(sessionId: string, runId: string) {
  if (!discordConfigured()) return
  const card = await cardFor(sessionId)
  const session = card ? await sessionFor(sessionId) : null
  if (!card || !session) return
  const pending = await db
    .select({
      id: schema.approval.id,
      description: schema.approval.description,
      kind: schema.approval.kind,
      toolName: schema.approval.toolName,
    })
    .from(schema.approval)
    .where(
      and(
        eq(schema.approval.runId, runId),
        eq(schema.approval.status, "pending")
      )
    )
  const [root] = card.discordThreadId
    ? await db
        .select({ id: schema.discordThread.threadRootId })
        .from(schema.discordThread)
        .where(eq(schema.discordThread.discordThreadId, card.discordThreadId))
    : []
  const lorUrl = `${env.APP_BASE_URL}/${session.slug}/session/${session.id}`
  for (const approval of pending) {
    const inLor =
      approval.kind === "claude_code" &&
      (approval.toolName === "ExitPlanMode" ||
        approval.toolName === "askUserQuestions")
    await postAgentToDiscord({
      channelId: card.channelId,
      agentId: card.agentId,
      messageId: null,
      content: inLor
        ? `**${session.title ?? "The session"}** needs an answer in Lor: ${approval.description}`
        : `**${session.title ?? "The session"}** needs an approval: ${approval.description}`,
      threadRootId: root?.id ?? null,
      buttons: inLor
        ? [{ label: "Answer in Lor", url: lorUrl }]
        : [
            {
              customId: `lor-approval:${approval.id}:approved`,
              label: "Approve",
              style: "success",
            },
            {
              customId: `lor-approval:${approval.id}:rejected`,
              label: "Reject",
              style: "danger",
            },
          ],
    }).catch((err: unknown) =>
      console.warn("Discord session approval post failed", err)
    )
  }
}

// The session a run belongs to, when it is one started from Discord.
export async function sessionOfRunWithCard(runId: string) {
  const [row] = await db
    .select({ sessionId: schema.discordSessionCard.sessionId })
    .from(schema.agentRun)
    .innerJoin(
      schema.agentSession,
      eq(schema.agentSession.threadRootId, schema.agentRun.scopeKey)
    )
    .innerJoin(
      schema.discordSessionCard,
      eq(schema.discordSessionCard.sessionId, schema.agentSession.id)
    )
    .where(eq(schema.agentRun.id, runId))
  return row?.sessionId ?? null
}
