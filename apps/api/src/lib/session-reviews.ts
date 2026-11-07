import { and, db, desc, eq, isNull, LOR_USER_ID, schema, sql } from "@repo/db"
import type { AgentSession } from "@repo/db/schema"
import { activeGithubInstallation } from "@repo/lor/github"
import { reviewStartsThreads } from "@repo/lor/pr-reviews"
import { channelEventContent } from "@repo/messaging"
import { threadRoom } from "@repo/realtime-types/rooms"
import { getEmitter } from "@/lib/bot-messages"
import { logger } from "@/lib/logger"
import { postSessionEvent } from "@/lib/session-events"

// GitHub reviews of a code session's pull request: the webhook finds the
// session by its own branch, posts a card for each review and tells open
// cards to refetch. reference/planned/pr-reviews.md.

const CANDIDATES_MAX = 5

export type PullRequestRef = {
  installationId: number | undefined
  repoFullName: string
  // The pull request's head branch, and the repo it lives in (a fork's
  // same-named branch is someone else's).
  headRef: string
  headRepoFullName: string | null
}

// The newest unarchived session whose own new branch is the head, in a
// workspace this GitHub installation belongs to. Forks share their source's
// branch, so the newest one gets it. Sessions on a shared base branch never
// match.
export async function sessionForPullRequest(
  pr: PullRequestRef
): Promise<AgentSession | null> {
  if (
    pr.installationId === undefined ||
    pr.headRepoFullName?.toLowerCase() !== pr.repoFullName.toLowerCase()
  ) {
    return null
  }
  const candidates = await db
    .select()
    .from(schema.agentSession)
    .where(
      and(
        sql`lower(${schema.agentSession.repoFullName}) = ${pr.repoFullName.toLowerCase()}`,
        eq(schema.agentSession.newBranch, pr.headRef),
        isNull(schema.agentSession.archivedAt)
      )
    )
    .orderBy(desc(schema.agentSession.createdAt))
    .limit(CANDIDATES_MAX)
  for (const session of candidates) {
    const installation = await activeGithubInstallation(session.workspaceId)
    if (installation === String(pr.installationId)) return session
  }
  return null
}

export function broadcastReviewUpdated(session: AgentSession) {
  void getEmitter()
    .then((io) =>
      io
        .to(threadRoom(session.threadRootId))
        .emit("session:review:updated", { threadRootId: session.threadRootId })
    )
    .catch((err) =>
      logger.warn({ err, sessionId: session.id }, "Review broadcast failed")
    )
}

const POSTED_STATES = new Set(["approved", "changes_requested", "commented"])

export async function announceReview(input: {
  session: AgentSession
  installationId: number
  pullRequest: { number: number; url: string }
  review: {
    id: number
    state: string
    body: string | null
    login: string
    bot: boolean
  }
}): Promise<void> {
  const { session, review } = input
  const repoFullName = session.repoFullName
  const state = review.state.toLowerCase()
  if (!repoFullName || !POSTED_STATES.has(state)) return
  // A reply in a thread is a bodyless review of its own: no card for it.
  if (
    state === "commented" &&
    !review.body?.trim() &&
    !(await reviewStartsThreads(
      String(input.installationId),
      repoFullName,
      input.pullRequest.number,
      review.id
    ))
  ) {
    return
  }
  // GitHub redelivers webhooks: one card per review.
  const posted = await db
    .select({ id: schema.message.id })
    .from(schema.message)
    .where(
      and(
        eq(schema.message.threadRootId, session.threadRootId),
        eq(schema.message.eventType, "session_reviewed"),
        sql`${schema.message.eventPayload}->>'reviewId' = ${String(review.id)}`
      )
    )
    .limit(1)
  if (posted.length > 0) return
  const lor = await db
    .select({ name: schema.user.name, image: schema.user.image })
    .from(schema.user)
    .where(eq(schema.user.id, LOR_USER_ID))
    .then((rows) => rows[0])
  const eventPayload = {
    sessionId: session.id,
    repoFullName,
    pullRequestNumber: input.pullRequest.number,
    pullRequestUrl: input.pullRequest.url,
    reviewId: review.id,
    reviewer: review.login.replace(/\[bot\]$/, ""),
    reviewerBot: review.bot,
    state: state as "approved" | "changes_requested" | "commented",
  }
  await postSessionEvent(
    session,
    { id: LOR_USER_ID, name: lor?.name ?? "Lor", image: lor?.image ?? null },
    { eventType: "session_reviewed", eventPayload },
    channelEventContent({ eventType: "session_reviewed", ...eventPayload })
  )
}
