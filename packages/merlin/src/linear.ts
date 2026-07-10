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

const linearContext = z.object({ externalId: z.string() })

export const linearTools = {
  search_linear: tool({
    description:
      "Search the team's connected Linear for issues by keyword — \"what issue covers X\", recent work, bugs, who's working on something. Returns matching issues with an id, identifier (e.g. ENG-123), title, url, and last-updated date. Reference a result with a Markdown link to its url. For the full description + comments, call fetch_linear with its id.",
    inputSchema: z.object({
      query: z.string().describe("keywords to search for"),
      limit: z.number().optional().describe("max results, 1–20 (default 8)"),
    }),
    contextSchema: linearContext,
    execute: async ({ query, limit }, { context }) => {
      const client = await linearClientFor(context.externalId)
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
    contextSchema: linearContext,
    execute: async ({ id }, { context }) => {
      const client = await linearClientFor(context.externalId)
      if (!client) return { error: "couldn't authenticate with Linear" }
      const issue = await client.issue(id).catch(() => null)
      if (!issue) return { error: "couldn't fetch that issue" }
      const state = await Promise.resolve(issue.state).catch(() => null)
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

type LinearClient = NonNullable<Awaited<ReturnType<typeof linearClientFor>>>

// Resolve a free-text assignee (name, display name, or email) to a Linear user
// id. Prefers active members and disambiguates when several match, so Merlin can
// ask the user rather than guessing. Returns an error string on no/ambiguous
// match so the issue isn't created misassigned.
async function resolveAssignee(
  client: LinearClient,
  query: string
): Promise<
  { userId: string; name: string } | { error: string; members?: string[] }
> {
  const raw = query.trim()
  if (!raw) return { error: "no assignee given" }
  const want = raw.toLowerCase()
  // Filter server-side so a member beyond the first page still matches — a bare
  // users() only returns the first page (misses large workspaces).
  let matched: Awaited<ReturnType<typeof client.users>>["nodes"]
  try {
    matched = (
      await client.users({
        first: 250,
        filter: {
          or: [
            { name: { containsIgnoreCase: raw } },
            { displayName: { containsIgnoreCase: raw } },
            { email: { containsIgnoreCase: raw } },
          ],
        },
      })
    ).nodes
  } catch (err) {
    // A failed lookup must not masquerade as "no match" — surface the failure.
    return {
      error: `couldn't look up Linear members: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  if (matched.length === 0) {
    // Hand back the member list so the model can pick the right person and
    // retry instead of dead-ending on a handle Linear doesn't know.
    const all = await client
      .users({ first: 250 })
      .then((u) => u.nodes)
      .catch(() => null)
    const members = all
      ?.filter((u) => u.active)
      .map((u) => `${u.displayName || u.name} <${u.email}>`)
    return {
      error: `no Linear member matches "${query}" — pick from the workspace members and retry with their exact name or email`,
      members,
    }
  }
  const active = matched.filter((u) => u.active)
  const users = active.length > 0 ? active : matched
  const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase()
  const label = (u: (typeof users)[number]) => u.displayName || u.name

  // The server already narrowed to substring matches; prefer an exact hit.
  const exact = users.filter(
    (u) =>
      norm(u.email) === want ||
      norm(u.name) === want ||
      norm(u.displayName) === want
  )
  const matches = exact.length > 0 ? exact : users
  const first = matches[0]
  if (matches.length === 1 && first) {
    return { userId: first.id, name: label(first) }
  }
  const list = matches.slice(0, MAX_LISTED).map(label).join(", ")
  return { error: `which person? Matches for "${query}": ${list}` }
}

// A team is required to create an issue. Auto-use the only team when there's
// one; otherwise match the given key/name (exact, then partial) and ask which
// one when it's missing or ambiguous — listing the options so Merlin can retry.
function resolveTeam(
  teams: { id: string; key: string; name: string }[],
  query: string | undefined
): { teamId: string; team: string } | { error: string } {
  const ask = () => {
    const options = teams
      .slice(0, MAX_LISTED)
      .map((t) => `${t.key} (${t.name})`)
      .join(", ")
    // Distinguish an omitted team from a name that matched nothing/ambiguously.
    const lead = query?.trim() ? `no team matches "${query}"` : "which team?"
    return { error: `${lead} — pass the team key or name; options: ${options}` }
  }
  if (!query?.trim()) {
    const only = teams[0]
    return teams.length === 1 && only
      ? { teamId: only.id, team: only.key }
      : ask()
  }
  const want = query.trim().toLowerCase()
  const norm = (s: string) => s.trim().toLowerCase()
  const exact = teams.filter(
    (t) => norm(t.key) === want || norm(t.name) === want
  )
  const partial = teams.filter(
    (t) => norm(t.key).includes(want) || norm(t.name).includes(want)
  )
  const matches = exact.length > 0 ? exact : partial
  const first = matches[0]
  return matches.length === 1 && first
    ? { teamId: first.id, team: first.key }
    : ask()
}

export const linearWriteTools = {
  create_linear_issue: tool({
    description:
      "Create a new issue in the team's Linear. A Linear team is required: if the workspace has a single team it's used automatically, otherwise you MUST pass its key or name (e.g. \"ENG\") — if you omit it or it's ambiguous, the tool returns the list of teams so you can pick one and retry. Also takes a title, an optional Markdown description, and an optional assignee (a member's name, display name, or email; matched to a Linear member, so use their real name, not a Lor handle) — if the assignee doesn't match anyone, the tool returns the workspace's member list so you can pick the right person and retry. Returns the created issue's identifier, url, team, and assignee.",
    inputSchema: z.object({
      title: z.string().describe("the issue title"),
      description: z.string().optional().describe("the issue body (Markdown)"),
      team: z
        .string()
        .optional()
        .describe(
          "team key or name (e.g. ENG); required when the workspace has more than one Linear team"
        ),
      assignee: z
        .string()
        .optional()
        .describe("who to assign it to — a Linear member's name or email"),
    }),
    contextSchema: linearContext,
    execute: async ({ title, description, team, assignee }, { context }) => {
      const client = await linearClientFor(context.externalId)
      if (!client) return { error: "couldn't authenticate with Linear" }
      const teams = await client
        .teams()
        .then((t) => t.nodes)
        .catch(() => [])
      if (teams.length === 0) return { error: "no Linear teams found" }

      const resolvedTeam = resolveTeam(teams, team)
      if ("error" in resolvedTeam) return { error: resolvedTeam.error }

      // Resolve the assignee before creating so an unresolved/ambiguous name
      // stops here instead of creating a misassigned issue.
      let assigneeId: string | undefined
      let assigneeName: string | null = null
      if (assignee?.trim()) {
        const resolved = await resolveAssignee(client, assignee)
        if ("error" in resolved) return resolved
        assigneeId = resolved.userId
        assigneeName = resolved.name
      }

      const payload = await client
        .createIssue({
          teamId: resolvedTeam.teamId,
          title,
          description,
          assigneeId,
        })
        .catch(() => null)
      if (!payload?.success) {
        return { error: "couldn't create the issue" }
      }
      // The write succeeded; reading the created issue back is best-effort.
      const issue = await Promise.resolve(payload.issue).catch(() => null)
      return {
        identifier: issue?.identifier ?? null,
        url: issue?.url ?? null,
        title,
        description: description ?? null,
        team: resolvedTeam.team,
        assignee: assigneeName,
      }
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
    contextSchema: linearContext,
    execute: async ({ issueId, body }, { context }) => {
      const client = await linearClientFor(context.externalId)
      if (!client) return { error: "couldn't authenticate with Linear" }
      const payload = await client
        .createComment({ issueId, body })
        .catch(() => null)
      if (!payload?.success) return { error: "couldn't add the comment" }
      // The write succeeded; reading the comment back is best-effort.
      const comment = await Promise.resolve(payload.comment).catch(() => null)
      return { ok: true, body, url: comment?.url ?? null }
    },
    strict: true,
  }),
}
