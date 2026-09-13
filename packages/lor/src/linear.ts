import { PaginationNulls, PaginationSortOrder } from "@linear/sdk"
import { and, db, eq, schema } from "@repo/db"
import { tool } from "ai"
import { z } from "zod"
import { linearClientFor } from "./providers/linear"

const SEARCH_DEFAULT = 8
const SEARCH_MAX = 20
const LIST_DEFAULT = 10
const LIST_MAX = 20
const MAX_COMMENTS = 10
const MAX_LISTED = 30
const LINEAR_PAGE_SIZE = 250

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
const linearStateType = z.enum([
  "triage",
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
  "duplicate",
])
const linearIssueOrder = z.enum(["createdAt", "updatedAt", "completedAt"])

type LinearClient = NonNullable<Awaited<ReturnType<typeof linearClientFor>>>
type LinearIssue = NonNullable<Awaited<ReturnType<LinearClient["issue"]>>>
type IssueUpdate = Parameters<LinearClient["updateIssue"]>[1]
type IssuesArgs = NonNullable<Parameters<LinearClient["issues"]>[0]>
type IssueFilter = NonNullable<IssuesArgs["filter"]>

const compactName = (value: { displayName?: string | null; name: string }) =>
  value.displayName || value.name

async function compactLinearIssues(
  client: LinearClient,
  issues: LinearIssue[]
) {
  const unique = (ids: Array<string | undefined>) => [
    ...new Set(ids.filter((id): id is string => Boolean(id))),
  ]
  const stateIds = unique(issues.map((issue) => issue.stateId))
  const teamIds = unique(issues.map((issue) => issue.teamId))
  const assigneeIds = unique(issues.map((issue) => issue.assigneeId))
  const projectIds = unique(issues.map((issue) => issue.projectId))
  const labelIds = unique(issues.flatMap((issue) => issue.labelIds))

  // The SDK's issue connection only embeds relation IDs. Resolve each relation
  // kind in one batched query instead of doing several lazy fetches per issue.
  const [states, teams, assignees, projects, labels] = await Promise.all([
    stateIds.length > 0
      ? client
          .workflowStates({
            first: stateIds.length,
            filter: { id: { in: stateIds } },
          })
          .then((result) => result.nodes)
          .catch(() => [])
      : [],
    teamIds.length > 0
      ? client
          .teams({ first: teamIds.length, filter: { id: { in: teamIds } } })
          .then((result) => result.nodes)
          .catch(() => [])
      : [],
    assigneeIds.length > 0
      ? client
          .users({
            first: assigneeIds.length,
            filter: { id: { in: assigneeIds } },
          })
          .then((result) => result.nodes)
          .catch(() => [])
      : [],
    projectIds.length > 0
      ? client
          .projects({
            first: projectIds.length,
            filter: { id: { in: projectIds } },
          })
          .then((result) => result.nodes)
          .catch(() => [])
      : [],
    labelIds.length > 0
      ? client
          .issueLabels({
            first: Math.min(labelIds.length, LINEAR_PAGE_SIZE),
            filter: { id: { in: labelIds } },
          })
          .then((result) => result.nodes)
          .catch(() => [])
      : [],
  ])
  const byId = <T extends { id: string }>(values: T[]) =>
    new Map(values.map((value) => [value.id, value]))
  const stateById = byId(states)
  const teamById = byId(teams)
  const assigneeById = byId(assignees)
  const projectById = byId(projects)
  const labelById = byId(labels)

  return issues.map((issue) => {
    const workflowState = issue.stateId
      ? stateById.get(issue.stateId)
      : undefined
    const team = issue.teamId ? teamById.get(issue.teamId) : undefined
    const assignee = issue.assigneeId
      ? assigneeById.get(issue.assigneeId)
      : undefined
    const project = issue.projectId
      ? projectById.get(issue.projectId)
      : undefined
    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      url: issue.url,
      state: workflowState?.type ?? null,
      status: workflowState?.name ?? null,
      priority: issue.priorityLabel,
      assignee: assignee ? compactName(assignee) : null,
      team: team?.name ?? null,
      project: project?.name ?? null,
      labels: issue.labelIds.flatMap((id) => {
        const label = labelById.get(id)
        return label ? [label.name] : []
      }),
      createdAt: issue.createdAt.toISOString(),
      updatedAt: issue.updatedAt.toISOString(),
      startedAt: issue.startedAt?.toISOString() ?? null,
      completedAt: issue.completedAt?.toISOString() ?? null,
      dueDate: issue.dueDate ?? null,
    }
  })
}

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
  list_linear_issues: tool({
    description:
      "List the team's Linear issues with structured filters and newest-first ordering. Use this for recent work, what is in progress, what shipped, or work by team/person/project/label; use search_linear instead for keyword relevance. State uses Linear's native lifecycle types: triage, backlog, unstarted, started, completed, canceled, or duplicate. Results include the exact workspace-specific status label but omit descriptions; call fetch_linear for details and comments.",
    inputSchema: z.object({
      state: linearStateType
        .optional()
        .describe("Linear lifecycle state type to include"),
      assignee: z
        .string()
        .optional()
        .describe("assignee ID, name, display name, or email"),
      team: z.string().optional().describe("team ID, key, or name"),
      project: z.string().optional().describe("project ID, slug, or name"),
      label: z.string().optional().describe("issue label ID or name"),
      updatedSince: z
        .string()
        .optional()
        .describe("ISO-8601 date/time or duration, e.g. -P7D"),
      completedSince: z
        .string()
        .optional()
        .describe("ISO-8601 date/time or duration, e.g. -P7D"),
      orderBy: linearIssueOrder
        .optional()
        .describe("newest-first order (default updatedAt)"),
      limit: z.number().optional().describe("max results, 1–20 (default 10)"),
      cursor: z
        .string()
        .optional()
        .describe("next-page cursor from a prior list"),
    }),
    contextSchema: linearContext,
    execute: async (input, { context }) => {
      const client = await linearClientFor(context.externalId)
      if (!client) return { error: "couldn't authenticate with Linear" }
      const n = Math.floor(
        Math.min(Math.max(input.limit ?? LIST_DEFAULT, 1), LIST_MAX)
      )
      const filters: IssueFilter[] = []
      if (input.state) {
        filters.push({ state: { type: { eq: input.state } } })
      }
      if (input.assignee) {
        filters.push({
          assignee: {
            or: [
              { id: { eq: input.assignee } },
              { name: { eqIgnoreCase: input.assignee } },
              { displayName: { eqIgnoreCase: input.assignee } },
              { email: { eqIgnoreCase: input.assignee } },
            ],
          },
        })
      }
      if (input.team) {
        filters.push({
          team: {
            or: [
              { id: { eq: input.team } },
              { key: { eqIgnoreCase: input.team } },
              { name: { eqIgnoreCase: input.team } },
            ],
          },
        })
      }
      if (input.project) {
        filters.push({
          project: {
            or: [
              { id: { eq: input.project } },
              { slugId: { eqIgnoreCase: input.project } },
              { name: { eqIgnoreCase: input.project } },
            ],
          },
        })
      }
      if (input.label) {
        filters.push({
          labels: {
            some: {
              or: [
                { id: { eq: input.label } },
                { name: { eqIgnoreCase: input.label } },
              ],
            },
          },
        })
      }
      if (input.updatedSince) {
        filters.push({ updatedAt: { gte: input.updatedSince } })
      }
      if (input.completedSince) {
        filters.push({ completedAt: { gte: input.completedSince } })
      }

      const order = {
        order: PaginationSortOrder.Descending,
        nulls: PaginationNulls.Last,
      }
      const orderBy = input.orderBy ?? "updatedAt"
      const sort =
        orderBy === "completedAt"
          ? [{ completedAt: order }]
          : orderBy === "createdAt"
            ? [{ createdAt: order }]
            : [{ updatedAt: order }]
      const payload = await client
        .issues({
          first: n,
          after: input.cursor,
          includeArchived: false,
          filter: filters.length > 0 ? { and: filters } : undefined,
          sort,
        })
        .catch(() => null)
      if (!payload) return { error: "Linear issue list failed" }
      const issues = await compactLinearIssues(client, payload.nodes)
      return {
        issues,
        nextCursor: payload.pageInfo.hasNextPage
          ? (payload.pageInfo.endCursor ?? undefined)
          : undefined,
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

const PRIORITY_NAMES = ["none", "urgent", "high", "medium", "low"] as const
const UNASSIGN = new Set(["none", "nobody", "unassigned", "unassign"])

// Resolve a free-text assignee (name, display name, or email) to a Linear user
// id. Prefers active members and disambiguates when several match, so Lor can
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
        first: LINEAR_PAGE_SIZE,
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
      .users({ first: LINEAR_PAGE_SIZE })
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
// one when it's missing or ambiguous — listing the options so Lor can retry.
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

// Match a workflow state by name against the issue's team, listing the options
// on a miss/ambiguity so Lor can pick one and retry.
async function resolveState(
  issue: LinearIssue,
  query: string
): Promise<{ stateId: string; state: string } | { error: string }> {
  const team = await Promise.resolve(issue.team).catch(() => null)
  const states = team
    ? await team
        .states({ first: 50 })
        .then((s) => s.nodes)
        .catch(() => [])
    : []
  if (states.length === 0) {
    return { error: "couldn't load the issue's workflow states" }
  }
  const want = query.trim().toLowerCase()
  const norm = (s: string) => s.trim().toLowerCase()
  const exact = states.filter((s) => norm(s.name) === want)
  const partial = states.filter((s) => norm(s.name).includes(want))
  const matches = exact.length > 0 ? exact : partial
  const first = matches[0]
  if (matches.length === 1 && first) {
    return { stateId: first.id, state: first.name }
  }
  const options = states
    .slice(0, MAX_LISTED)
    .map((s) => s.name)
    .join(", ")
  const lead =
    matches.length === 0
      ? `no workflow state matches "${query}"`
      : `which state? Matches for "${query}"`
  return { error: `${lead} — options: ${options}` }
}

// Additions match by name against every label in the workspace; removals only
// against labels already on the issue.
async function resolveLabels(
  client: LinearClient,
  issue: LinearIssue,
  add: string[],
  remove: string[]
): Promise<
  | { addedLabelIds: string[]; removedLabelIds: string[]; changes: string[] }
  | { error: string }
> {
  const norm = (s: string) => s.trim().toLowerCase()
  const pick = (labels: { id: string; name: string }[], name: string) => {
    const want = norm(name)
    const exact = labels.filter((l) => norm(l.name) === want)
    const partial = labels.filter((l) => norm(l.name).includes(want))
    const matches = exact.length > 0 ? exact : partial
    const first = matches[0]
    return matches.length === 1 && first ? first : null
  }
  const addedLabelIds: string[] = []
  const removedLabelIds: string[] = []
  const changes: string[] = []
  if (add.length > 0) {
    const all = await client
      .issueLabels({ first: LINEAR_PAGE_SIZE })
      .then((l) => l.nodes)
      .catch(() => null)
    if (!all) return { error: "couldn't load Linear labels" }
    for (const name of add) {
      const label = pick(all, name)
      if (!label) {
        const options = all
          .slice(0, MAX_LISTED)
          .map((l) => l.name)
          .join(", ")
        return {
          error: `no single label matches "${name}" — options: ${options}`,
        }
      }
      addedLabelIds.push(label.id)
      changes.push(`added label ${label.name}`)
    }
  }
  if (remove.length > 0) {
    const current = await issue
      .labels()
      .then((l) => l.nodes)
      .catch(() => null)
    if (!current) return { error: "couldn't load the issue's labels" }
    for (const name of remove) {
      const label = pick(current, name)
      if (!label) {
        const options = current.map((l) => l.name).join(", ") || "(no labels)"
        return {
          error: `"${name}" doesn't match a label on the issue — it has: ${options}`,
        }
      }
      removedLabelIds.push(label.id)
      changes.push(`removed label ${label.name}`)
    }
  }
  return { addedLabelIds, removedLabelIds, changes }
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
  update_linear_issue: tool({
    description:
      'Update an existing Linear issue: reassign or unassign it, move it to another workflow state (e.g. "In Progress", "Done"), retitle it, replace its description, set its priority, add/remove labels, or set/clear its due date. Pass the issue id (from search_linear / fetch_linear) or its identifier (e.g. ENG-123), plus only the fields to change. Unknown assignee/state/label names return the available options so you can pick one and retry.',
    inputSchema: z.object({
      id: z.string().describe("the issue id or identifier (e.g. ENG-123)"),
      title: z.string().optional().describe("new title"),
      description: z
        .string()
        .optional()
        .describe("new body (Markdown; replaces the current body)"),
      assignee: z
        .string()
        .optional()
        .describe('a Linear member\'s name or email, or "none" to unassign'),
      state: z
        .string()
        .optional()
        .describe("a workflow state name, e.g. Todo, In Progress, Done"),
      priority: z
        .number()
        .optional()
        .describe("0 = none, 1 = urgent, 2 = high, 3 = medium, 4 = low"),
      addLabels: z.array(z.string()).optional().describe("label names to add"),
      removeLabels: z
        .array(z.string())
        .optional()
        .describe("label names to remove"),
      dueDate: z
        .string()
        .optional()
        .describe('due date as YYYY-MM-DD, or "none" to clear'),
    }),
    contextSchema: linearContext,
    execute: async (input, { context }) => {
      const client = await linearClientFor(context.externalId)
      if (!client) return { error: "couldn't authenticate with Linear" }
      const issue = await client.issue(input.id).catch(() => null)
      if (!issue) {
        return {
          error: `couldn't find issue "${input.id}" — pass an id from search_linear or an identifier like ENG-123`,
        }
      }

      const update: IssueUpdate = {}
      const changes: string[] = []

      if (input.title?.trim()) {
        update.title = input.title
        changes.push(`retitled to “${input.title}”`)
      }
      if (input.description !== undefined) {
        update.description = input.description
        changes.push("description replaced")
      }
      if (input.assignee?.trim()) {
        if (UNASSIGN.has(input.assignee.trim().toLowerCase())) {
          update.assigneeId = null
          changes.push("unassigned")
        } else {
          const resolved = await resolveAssignee(client, input.assignee)
          if ("error" in resolved) return resolved
          update.assigneeId = resolved.userId
          changes.push(`assigned to ${resolved.name}`)
        }
      }
      if (input.state?.trim()) {
        const resolved = await resolveState(issue, input.state)
        if ("error" in resolved) return resolved
        update.stateId = resolved.stateId
        changes.push(`moved to ${resolved.state}`)
      }
      if (input.priority !== undefined) {
        const p = Math.floor(input.priority)
        const name = PRIORITY_NAMES[p]
        if (!name) return { error: "priority must be 0 (none) through 4 (low)" }
        update.priority = p
        changes.push(`priority ${name}`)
      }
      if (input.addLabels?.length || input.removeLabels?.length) {
        const resolved = await resolveLabels(
          client,
          issue,
          input.addLabels ?? [],
          input.removeLabels ?? []
        )
        if ("error" in resolved) return resolved
        if (resolved.addedLabelIds.length > 0) {
          update.addedLabelIds = resolved.addedLabelIds
        }
        if (resolved.removedLabelIds.length > 0) {
          update.removedLabelIds = resolved.removedLabelIds
        }
        changes.push(...resolved.changes)
      }
      if (input.dueDate?.trim()) {
        const raw = input.dueDate.trim()
        if (raw.toLowerCase() === "none") {
          update.dueDate = null
          changes.push("due date cleared")
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
          update.dueDate = raw
          changes.push(`due ${raw}`)
        } else {
          return { error: 'dueDate must be YYYY-MM-DD or "none"' }
        }
      }

      if (changes.length === 0) {
        return { error: "pass at least one field to change" }
      }

      const payload = await client
        .updateIssue(issue.id, update)
        .catch(() => null)
      if (!payload?.success) return { error: "couldn't update the issue" }
      // The write succeeded; reading the issue back is best-effort.
      const updated = await Promise.resolve(payload.issue).catch(() => null)
      return {
        identifier: updated?.identifier ?? issue.identifier,
        title: updated?.title ?? issue.title,
        url: updated?.url ?? issue.url,
        changes,
      }
    },
    strict: true,
  }),
}
