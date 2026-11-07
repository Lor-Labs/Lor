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
    // A review bot's prompt for the whole review (CodeRabbit's covers its
    // nitpicks and comments outside the diff, which have no thread).
    agentPrompt: string | null
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
      // Bots only: a person's hidden <details> never reaches Lor unseen.
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

// Bounded so a tag that never closes can't make the scan quadratic.
const LEFTOVER_TAGS =
  /<\/?(?:sub|sup|b|strong|i|em|p|div|span|br|img|a|blockquote|summary|details|table|thead|tbody|tr|td|th)\b[^>]{0,2000}>/gi
const MAX_DETAILS = 50

// Comment bodies are anyone's text (up to GitHub's 65,536 characters), so
// these scans are linear: no backtracking regex over the whole body.
function stripHtmlComments(text: string): string {
  let out = ""
  let from = 0
  for (;;) {
    const open = text.indexOf("<!--", from)
    if (open === -1) return out + text.slice(from)
    out += text.slice(from, open)
    const close = text.indexOf("-->", open + 4)
    if (close === -1) return out
    from = close + 3
  }
}

function stripFences(text: string): string {
  const lines = text.trim().split("\n")
  if (/^`{3,}/.test(lines[0] ?? "")) lines.shift()
  const last = (lines.at(-1) ?? "").trim()
  if (last.length >= 3 && [...last].every((char) => char === "`")) lines.pop()
  return lines.join("\n").trim()
}

// The innermost <details> block: the first closing tag and the last opening
// tag before it.
function innermostDetails(text: string) {
  const lower = text.toLowerCase()
  const close = lower.indexOf("</details>")
  if (close === -1) return null
  const open = lower.lastIndexOf("<details", close)
  if (open === -1) return null
  const openEnd = lower.indexOf(">", open)
  if (openEnd === -1 || openEnd > close) return null
  let inner = text.slice(openEnd + 1, close)
  let summary = ""
  const innerLower = inner.toLowerCase()
  const summaryOpen = innerLower.indexOf("<summary>")
  const summaryClose = innerLower.indexOf("</summary>")
  if (summaryOpen !== -1 && summaryClose > summaryOpen) {
    summary = inner.slice(summaryOpen + "<summary>".length, summaryClose)
    inner = inner.slice(summaryClose + "</summary>".length)
  }
  return { start: open, end: close + "</details>".length, summary, inner }
}

// Review bots fold their extras into <details> blocks and leave HTML
// comments and badges; the card shows the finding and keeps the agent
// prompt. An unknown format comes through as its own Markdown.
export function cleanReviewBody(raw: string): {
  body: string
  agentPrompt: string | null
} {
  let body = stripHtmlComments(raw.replace(/\r\n?/g, "\n"))
  let agentPrompt: string | null = null
  for (let i = 0; i < MAX_DETAILS; i++) {
    const block = innermostDetails(body)
    if (!block) break
    const summary = block.summary.replace(LEFTOVER_TAGS, "")
    if (!agentPrompt && /prompt/i.test(summary)) {
      agentPrompt = stripFences(block.inner) || null
    }
    body = body.slice(0, block.start) + body.slice(block.end)
  }
  body = body
    .replace(LEFTOVER_TAGS, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return { body, agentPrompt }
}

// A person's comment shows as written; only a bot's prompt goes to Lor.
function commentText(raw: string, author: ReviewAuthor) {
  const cleaned = cleanReviewBody(raw)
  return {
    body: cleaned.body,
    agentPrompt: author.bot ? cleaned.agentPrompt : null,
  }
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
      .map((review) => {
        const author = authorOf(review.author)
        return {
          id: review.databaseId,
          author,
          state: REVIEW_STATES[review.state] ?? "commented",
          ...commentText(review.body, author),
          url: review.url,
          submittedAt: review.submittedAt,
        }
      }),
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
          comments: thread.comments.map((comment) => {
            const author = authorOf(comment.author)
            return {
              id: comment.databaseId,
              author,
              ...commentText(comment.body, author),
              url: comment.url,
              createdAt: comment.createdAt,
            }
          }),
        },
      ]
    }),
  }
}
