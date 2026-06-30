import { and, db, eq, schema } from "@repo/db"
import { tool } from "ai"
import { z } from "zod"
import { linearClientFor } from "./providers/linear"

const SEARCH_DEFAULT = 8
const SEARCH_MAX = 20
const MAX_COMMENTS = 10
const MAX_LISTED = 30

export async function activeLinearConnection(
  workspaceId: string
): Promise<string | null> {
  const conn = await db
    .select({ externalId: schema.integrationConnection.externalId })
    .from(schema.integrationConnection)
    .where(
      and(
        eq(schema.integrationConnection.workspaceId, workspaceId),
        eq(schema.integrationConnection.provider, "linear"),
        eq(schema.integrationConnection.status, "active")
      )
    )
    .limit(1)
    .then((r) => r[0])
  return conn?.externalId ?? null
}

export async function resolveWorkspaceLinear(
  workspaceId: string
): Promise<{ externalId: string } | null> {
  const externalId = await activeLinearConnection(workspaceId)
  return externalId ? { externalId } : null
}

export function buildLinearTools({ externalId }: { externalId: string }) {
  return {
    search_linear: tool({
      description:
        "Search the team's connected Linear for issues by keyword — \"what issue covers X\", recent work, bugs, who's working on something. Returns matching issues with an id, identifier (e.g. ENG-123), title, url, and last-updated date. Reference a result with a Markdown link to its url. For the full description + comments, call fetch_linear with its id.",
      inputSchema: z.object({
        query: z.string().describe("keywords to search for"),
        limit: z.number().optional().describe("max results, 1–20 (default 8)"),
      }),
      execute: async ({ query, limit }) => {
        const client = await linearClientFor(externalId)
        if (!client) return { error: "couldn't authenticate with Linear" }
        const n = Math.floor(
          Math.min(Math.max(limit ?? SEARCH_DEFAULT, 1), SEARCH_MAX)
        )
        const payload = await client.searchIssues(query).catch(() => null)
        if (!payload) return { error: "Linear search failed" }
        return {
          results: payload.nodes.slice(0, n).map((i) => ({
            id: i.id,
            identifier: i.identifier,
            title: i.title,
            url: i.url,
            updatedAt: i.updatedAt.toISOString(),
          })),
        }
      },
      strict: true,
    }),
    fetch_linear: tool({
      description:
        "Fetch a Linear issue's full description and comments, beyond the search result. Pass an issue id from search_linear. Reference it with a Markdown link to its url.",
      inputSchema: z.object({
        id: z.string().describe("an issue id from search_linear"),
      }),
      execute: async ({ id }) => {
        const client = await linearClientFor(externalId)
        if (!client) return { error: "couldn't authenticate with Linear" }
        const issue = await client.issue(id).catch(() => null)
        if (!issue) return { error: "couldn't fetch that issue" }
        const state = await issue.state
        const comments = await issue
          .comments({ first: MAX_COMMENTS })
          .then((c) => c.nodes)
          .catch(() => [])
        return {
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          state: state?.name ?? null,
          url: issue.url,
          content: `${issue.description ?? "(no description)"}${comments
            .map((c) => `\n\n— ${c.body}`)
            .join("")}`,
        }
      },
      strict: true,
    }),
  }
}

export function buildLinearWriteTools({ externalId }: { externalId: string }) {
  return {
    create_linear_issue: tool({
      description:
        "Create a new issue in the team's Linear. Pass a title, an optional Markdown description, and the team key or name (e.g. \"ENG\") — required when the workspace has more than one team. Returns the created issue's identifier and url.",
      inputSchema: z.object({
        title: z.string().describe("the issue title"),
        description: z
          .string()
          .optional()
          .describe("the issue body (Markdown)"),
        team: z.string().optional().describe("team key or name, e.g. ENG"),
      }),
      execute: async ({ title, description, team }) => {
        const client = await linearClientFor(externalId)
        if (!client) return { error: "couldn't authenticate with Linear" }
        const teams = await client
          .teams()
          .then((t) => t.nodes)
          .catch(() => [])
        if (teams.length === 0) return { error: "no Linear teams found" }

        let target: (typeof teams)[number] | undefined
        if (team) {
          const want = team.trim().toLowerCase()
          target = teams.find(
            (t) => t.key.toLowerCase() === want || t.name.toLowerCase() === want
          )
        } else if (teams.length === 1) {
          target = teams[0]
        }
        if (!target) {
          const list = teams
            .slice(0, MAX_LISTED)
            .map((t) => `${t.key} (${t.name})`)
            .join(", ")
          return { error: `which team? Teams: ${list}` }
        }

        const payload = await client
          .createIssue({ teamId: target.id, title, description })
          .catch(() => null)
        const issue = payload ? await payload.issue : null
        if (!(payload?.success && issue)) {
          return { error: "couldn't create the issue" }
        }
        return { identifier: issue.identifier, url: issue.url, title }
      },
      strict: true,
    }),
    comment_linear: tool({
      description:
        "Add a comment to a Linear issue. Pass the issue id (from search_linear / fetch_linear) and the comment body (Markdown).",
      inputSchema: z.object({
        issueId: z.string().describe("the issue id"),
        body: z.string().describe("the comment text (Markdown)"),
      }),
      execute: async ({ issueId, body }) => {
        const client = await linearClientFor(externalId)
        if (!client) return { error: "couldn't authenticate with Linear" }
        const payload = await client
          .createComment({ issueId, body })
          .catch(() => null)
        if (!payload?.success) return { error: "couldn't add the comment" }
        return { ok: true }
      },
      strict: true,
    }),
  }
}
