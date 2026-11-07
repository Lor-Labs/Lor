import { activeGithubInstallation } from "./github"
import {
  fetchBranchPullRequest,
  type GithubReviewAuthor,
} from "./providers/github"

export { reviewStartsThreads } from "./providers/github"

// A code session's pull request review, read live from GitHub for the review
// card and the Details panel's Review list (reference/planned/pr-reviews.md).
// Only a session's own new branch has one: sessions on a shared branch like
// dev would all show that branch's pull request.

export type ReviewAuthor = {
  login: string
  avatarUrl: string | null
  bot: boolean
}

export type ReviewState =
  | "approved"
  | "changes_requested"
  | "commented"
  | "dismissed"
  | "pending"

export type SessionPullRequestReview = {
  pullRequest: {
    number: number
    url: string
    title: string
    state: "open" | "closed" | "merged"
    draft: boolean
  }
  reviews: {
    id: number
    author: ReviewAuthor
    state: ReviewState
    body: string
    url: string
    submittedAt: string | null
  }[]
  threads: {
    id: string
    path: string
    // Null once the code it was on is gone (outdated).
    line: number | null
    resolved: boolean
    outdated: boolean
    // The review its first comment belongs to.
    reviewId: number | null
    url: string
    comments: {
      id: number
      author: ReviewAuthor
      body: string
      // A review bot's own instructions for an AI agent (CodeRabbit's "Prompt
      // for AI Agents", Greptile's "Prompt To Fix With AI"), for Fix with Lor.
      agentPrompt: string | null
      url: string
      createdAt: string
    }[]
  }[]
}

function authorOf(author: GithubReviewAuthor): ReviewAuthor {
  return author
    ? {
        login: author.login,
        avatarUrl: author.avatarUrl || null,
        bot: author.__typename === "Bot",
      }
    : { login: "ghost", avatarUrl: null, bot: false }
}

const INNERMOST_DETAILS =
  /<details\b[^>]*>\s*(?:<summary>([\s\S]*?)<\/summary>)?((?:(?!<details\b)[\s\S])*?)<\/details>/i
const LEFTOVER_TAGS =
  /<\/?(?:sub|sup|b|strong|i|em|p|div|span|br|img|a|blockquote|summary|details|table|thead|tbody|tr|td|th)\b[^>]*>/gi
const MAX_DETAILS = 50

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^`{3,}[^\n]*\n/, "")
    .replace(/\n?`{3,}\s*$/, "")
    .trim()
}

// Review bots fold their extras into <details> blocks and leave HTML
// comments and badges; the card shows the finding and keeps the agent
// prompt. An unknown format comes through as its own Markdown.
export function cleanReviewBody(raw: string): {
  body: string
  agentPrompt: string | null
} {
  let body = raw.replace(/<!--[\s\S]*?-->/g, "")
  let agentPrompt: string | null = null
  for (let i = 0; i < MAX_DETAILS; i++) {
    const match = INNERMOST_DETAILS.exec(body)
    if (!match) break
    const summary = (match[1] ?? "").replace(/<[^>]+>/g, "")
    if (!agentPrompt && /prompt/i.test(summary)) {
      agentPrompt = stripFences(match[2] ?? "") || null
    }
    body =
      body.slice(0, match.index) + body.slice(match.index + match[0].length)
  }
  body = body
    .replace(LEFTOVER_TAGS, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return { body, agentPrompt }
}

const REVIEW_STATES: Record<string, ReviewState> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
  PENDING: "pending",
}

// Null: not a code session on its own branch, GitHub isn't connected, or the
// branch has no pull request yet. Throws when GitHub fails.
export async function sessionPullRequestReview(session: {
  workspaceId: string
  repoFullName: string | null
  newBranch: string | null
}): Promise<SessionPullRequestReview | null> {
  if (!(session.repoFullName && session.newBranch)) return null
  const installationId = await activeGithubInstallation(session.workspaceId)
  if (!installationId) return null
  const pr = await fetchBranchPullRequest(
    installationId,
    session.repoFullName,
    session.newBranch
  )
  if (!pr) return null
  return {
    pullRequest: {
      number: pr.number,
      url: pr.url,
      title: pr.title,
      state:
        pr.state === "MERGED"
          ? "merged"
          : pr.state === "CLOSED"
            ? "closed"
            : "open",
      draft: pr.isDraft,
    },
    reviews: pr.reviews
      .filter((review) => review.state !== "PENDING")
      .map((review) => ({
        id: review.databaseId,
        author: authorOf(review.author),
        state: REVIEW_STATES[review.state] ?? "commented",
        body: cleanReviewBody(review.body).body,
        url: review.url,
        submittedAt: review.submittedAt,
      })),
    threads: pr.threads.flatMap((thread) => {
      const first = thread.comments[0]
      if (!first) return []
      return [
        {
          id: thread.id,
          path: thread.path,
          line: thread.line ?? thread.originalLine,
          resolved: thread.isResolved,
          outdated: thread.isOutdated,
          reviewId: first.pullRequestReview?.databaseId ?? null,
          url: first.url,
          comments: thread.comments.map((comment) => ({
            id: comment.databaseId,
            author: authorOf(comment.author),
            ...cleanReviewBody(comment.body),
            url: comment.url,
            createdAt: comment.createdAt,
          })),
        },
      ]
    }),
  }
}
