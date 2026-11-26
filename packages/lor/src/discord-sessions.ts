import { and, db, eq, schema } from "@repo/db"
import { env } from "@repo/env/server"
import {
  agentFaceUrl,
  discordConfigured,
  discordLinkFor,
  discordThreadForRoot,
  editAgentDiscordMessage,
  postAgentToDiscord,
  startDiscordThread,
} from "./discord"
import { approvalCard, type SessionCardView, sessionCard } from "./discord-ui"

// A code session started from a Discord place (reference/agents-and-chats.md,
// decision 51) shows there as a card in the thread of the request: what it
// works on, how it is doing, whose it is, and links to it in Lor and, once
// pushed, on GitHub. Its approvals are asked in the same thread.

export type SessionCardState = SessionCardView["state"]

const HARNESS_PLAN: Record<string, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
}

// What a report says first, for the card.
const LATEST_MAX = 180
function firstLine(reply: string) {
  const line = reply
    .split(/\n\s*\n/)[0]
    ?.replace(/\s+/g, " ")
    .trim()
  if (!line) return null
  return line.length > LATEST_MAX ? `${line.slice(0, LATEST_MAX - 1)}…` : line
}

async function sessionFor(sessionId: string) {
  const [row] = await db
    .select({
      id: schema.agentSession.id,
      title: schema.agentSession.title,
      repoFullName: schema.agentSession.repoFullName,
      newBranch: schema.agentSession.newBranch,
      baseBranch: schema.agentSession.baseBranch,
      harness: schema.agentSession.harness,
      ownerName: schema.user.name,
      slug: schema.workspace.slug,
    })
    .from(schema.agentSession)
    .innerJoin(
      schema.workspace,
      eq(schema.workspace.id, schema.agentSession.workspaceId)
    )
    .leftJoin(schema.user, eq(schema.user.id, schema.agentSession.creatorId))
    .where(eq(schema.agentSession.id, sessionId))
  return row ?? null
}

type Session = NonNullable<Awaited<ReturnType<typeof sessionFor>>>
type Card = typeof schema.discordSessionCard.$inferSelect

const lorUrl = (session: Session) =>
  `${env.APP_BASE_URL}/${session.slug}/session/${session.id}`

function view(
  session: Session,
  card: Pick<Card, "state" | "latest" | "branchUrl" | "pullRequestUrl">,
  face: string | null
): SessionCardView {
  return {
    sessionId: session.id,
    title: session.title || "Code session",
    repo: session.repoFullName,
    branch: session.newBranch ?? session.baseBranch,
    state: (card.state as SessionCardState) ?? "working",
    latest: card.latest,
    owner: session.ownerName,
    harness: HARNESS_PLAN[session.harness] ?? null,
    face,
    lorUrl: lorUrl(session),
    branchUrl: card.branchUrl,
    pullRequestUrl: card.pullRequestUrl,
  }
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
      name: session.title || "Code session",
    }).catch(() => null)
    if (started) threadRootId = input.triggerMessageId
  }
  const face = await agentFaceUrl(input.channelId, input.agentId)
  const posted = await postAgentToDiscord({
    channelId: input.channelId,
    agentId: input.agentId,
    messageId: null,
    content: "",
    components: sessionCard(
      view(
        session,
        {
          state: "working",
          latest: null,
          branchUrl: null,
          pullRequestUrl: null,
        },
        face
      )
    ),
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

export async function sessionCardFor(sessionId: string) {
  const [card] = await db
    .select()
    .from(schema.discordSessionCard)
    .where(eq(schema.discordSessionCard.sessionId, sessionId))
  return card ?? null
}

// Changes a session's card: its state and the start of its last report, or
// what was pushed. A session with no card (not started from Discord) is
// left alone.
export async function updateSessionCard(
  sessionId: string,
  change: {
    state?: SessionCardState
    report?: string
    branchUrl?: string
    pullRequestUrl?: string
  }
) {
  if (!discordConfigured()) return
  const card = await sessionCardFor(sessionId)
  if (!card) return
  const next = {
    state: change.state ?? card.state,
    // Back at work, the last report no longer says where it is.
    latest:
      change.report !== undefined
        ? firstLine(change.report)
        : change.state === "working"
          ? null
          : card.latest,
    branchUrl: change.branchUrl ?? card.branchUrl,
    pullRequestUrl: change.pullRequestUrl ?? card.pullRequestUrl,
  }
  if (
    next.state === card.state &&
    next.latest === card.latest &&
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
  await editAgentDiscordMessage({
    channelId: card.channelId,
    agentId: card.agentId,
    discordMessageId: card.discordMessageId,
    discordThreadId: card.discordThreadId,
    components: sessionCard(
      view(session, next, await agentFaceUrl(card.channelId, card.agentId))
    ),
  })
}

// The Lor thread a card's Discord thread mirrors.
export async function cardThreadRoot(card: Card) {
  if (!card.discordThreadId) return null
  const [root] = await db
    .select({ id: schema.discordThread.threadRootId })
    .from(schema.discordThread)
    .where(eq(schema.discordThread.discordThreadId, card.discordThreadId))
  return root?.id ?? null
}

// A session run's approvals, asked in the card's thread: Approve and Reject
// for a tool call, and a link to Lor for what needs more than a yes or no
// (a plan to read, questions to answer).
export async function postSessionApprovals(sessionId: string, runId: string) {
  if (!discordConfigured()) return
  const card = await sessionCardFor(sessionId)
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
  const threadRootId = await cardThreadRoot(card)
  for (const approval of pending) {
    const inLor =
      approval.kind === "claude_code" &&
      (approval.toolName === "ExitPlanMode" ||
        approval.toolName === "askUserQuestions")
    await postAgentToDiscord({
      channelId: card.channelId,
      agentId: card.agentId,
      messageId: null,
      content: "",
      components: approvalCard({
        approvalId: approval.id,
        what: inLor
          ? `${session.title} needs an answer in Lor.`
          : `${session.title} wants to:`,
        description: approval.description,
        // A Claude Code prompt is its owner's alone, as at their terminal.
        decider:
          approval.kind === "claude_code"
            ? (session.ownerName ?? "the session's owner")
            : null,
        lorUrl: lorUrl(session),
        inLor,
      }),
      threadRootId,
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
