import {
  betterstackErrorKey,
  CONNECTOR_TOOLS,
  type ConnectorToolName,
  githubItemKey,
  githubRepoKey,
  type ItemRef,
  itemFromUrl,
  linearIssueKey,
  normalizeUrl,
  notionPageKey,
  STANDALONE_TOOLS,
  type StandaloneToolName,
} from "@repo/connectors"
import { and, asc, db, desc, eq, ne, or, schema, sql } from "@repo/db"
import {
  EMPTY_LOR_RUN_SCOPE,
  resolveLorRunScope,
} from "@repo/db/queries/channel-access"
import type { TouchAction, TouchKind } from "@repo/db/schema"
import { pageNodeId } from "./brain"
import {
  classifyToken,
  extractCitationTokens,
  prefixedTokenId,
  splitCallToken,
} from "./citations"
import {
  channelFilter,
  dateFilter,
  privateAudienceFilter,
  type SearchFilters,
} from "./retrieval"

// What a session's run touched, recorded after the run persists: tool calls,
// citations in the reply, and the chat it started from. No model call.
// reference/planned/session-memory.md Step 5.

type Rec = Record<string, unknown>
type Item = { kind: TouchKind; value: string }
type Touch = Item & { action: TouchAction }
// Brain pages are keyed by node id, resolved from the path after the run.
type BrainPathTouch = { brainPath: string; action: TouchAction }

const isRec = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v)

function str(r: unknown, key: string): string | null {
  if (!isRec(r)) return null
  const v = r[key]
  if (typeof v === "number") return String(v)
  return typeof v === "string" && v.trim() ? v.trim() : null
}

const item = (kind: TouchKind, value: string | null): Item | null =>
  value ? { kind, value } : null

const notionPage = (id: string | null) =>
  item("notion_page", id ? notionPageKey(id) : null)

function betterstackError(input: Rec): Item | null {
  const applicationId = str(input, "application_id")
  const pattern = str(input, "pattern")
  return applicationId && pattern
    ? item("betterstack_error", betterstackErrorKey(applicationId, pattern))
    : null
}

// A connector item when the URL names one, else the plain URL.
function urlItem(raw: string): ItemRef | null {
  return itemFromUrl(raw) ?? item("url", normalizeUrl(raw))
}

const linearFromOutput = (_input: Rec, output: Rec) => [
  item("linear_issue", linearIssueKey(str(output, "identifier") ?? "")),
]

// The single item each catalog tool call was about; read or wrote comes from
// the tool's reviewed readOnlyHint. Keyed by the catalog's literal tool names,
// so a new connector tool does not compile until it has an entry. null = the
// tool touches no single item (searches, lists, logs).
const CATALOG_SPECS: Record<
  ConnectorToolName | StandaloneToolName,
  ((input: Rec, output: Rec) => (Item | null)[]) | null
> = {
  search_github: null,
  fetch_github: (input, output) => {
    const [repo, number] = (
      str(output, "ref") ??
      str(input, "ref") ??
      ""
    ).split("#")
    if (!repo || !number) return []
    const kind = output.type === "issue" ? "github_issue" : "github_pr"
    return [item(kind, githubItemKey(repo, number))]
  },
  investigate_code: (input) => {
    const repo = str(input, "repo")
    return [item("github_repo", repo ? githubRepoKey(repo) : null)]
  },
  propose_code_change: (input, output) => {
    const repo = str(output, "repo") ?? str(input, "repo")
    const number = str(output.pullRequest, "number")
    return [
      item("github_pr", repo && number ? githubItemKey(repo, number) : null),
    ]
  },
  search_linear: null,
  list_linear_issues: null,
  fetch_linear: linearFromOutput,
  create_linear_issue: linearFromOutput,
  // Comments count as writes to the issue. A UUID input has no key.
  comment_linear: (input) => [
    item("linear_issue", linearIssueKey(str(input, "issueId") ?? "")),
  ],
  update_linear_issue: (input, output) => [
    item(
      "linear_issue",
      linearIssueKey(str(output, "identifier") ?? str(input, "id") ?? "")
    ),
  ],
  search_datadog_logs: null,
  analyze_datadog_logs: null,
  search_attio: null,
  query_attio: null,
  fetch_attio_record: (input) => [item("attio_record", str(input, "recordId"))],
  fetch_attio_activity: (input) => [
    item("attio_record", str(input, "recordId")),
  ],
  create_attio_record: (_input, output) => [
    item("attio_record", str(output, "id")),
  ],
  update_attio_record: (input) => [
    item("attio_record", str(input, "recordId")),
  ],
  create_attio_list_entry: (input, output) => [
    item("attio_record", str(input, "recordId")),
    item("attio_list_entry", str(output, "id")),
  ],
  update_attio_list_entry: (input) => [
    item("attio_list_entry", str(input, "entryId")),
  ],
  create_attio_note: (input) => [item("attio_record", str(input, "recordId"))],
  create_attio_task: (_input, output) => [
    item("attio_task", str(output, "id")),
  ],
  update_attio_task: (input) => [item("attio_task", str(input, "taskId"))],
  search_notion: null,
  list_notion_users: null,
  query_notion_data_source: null,
  fetch_notion_page: (input) => [notionPage(str(input, "pageId"))],
  create_notion_page: (_input, output) => [notionPage(str(output, "id"))],
  append_notion_content: (input) => [notionPage(str(input, "pageId"))],
  edit_notion_content: (input) => [notionPage(str(input, "pageId"))],
  update_notion_properties: (input) => [notionPage(str(input, "pageId"))],
  // A discussion reply carries no page key.
  add_notion_comment: (input) =>
    isRec(input.target) && input.target.type === "page"
      ? [notionPage(str(input.target, "id"))]
      : [],
  list_cloudwatch_log_groups: null,
  search_cloudwatch_logs: null,
  list_cloudwatch_metrics: null,
  get_cloudwatch_metrics: null,
  // Better Stack: incidents and errors only (decision 15), keyed from inputs
  // because its MCP results are untyped text.
  list_betterstack_applications: null,
  list_betterstack_errors: null,
  fetch_betterstack_error: (input) => [betterstackError(input)],
  list_betterstack_sources: null,
  fetch_betterstack_source: null,
  list_betterstack_source_fields: null,
  get_betterstack_query_help: null,
  get_betterstack_errors_query_help: null,
  plan_betterstack_query_windows: null,
  query_betterstack: null,
  list_betterstack_incidents: null,
  fetch_betterstack_incident: (input) => [
    item("betterstack_incident", str(input, "id")),
  ],
  list_betterstack_monitors: null,
  fetch_betterstack_monitor: null,
  resolve_betterstack_incident: (input) => [
    item("betterstack_incident", str(input, "id")),
  ],
  update_betterstack_error_state: (input) => [betterstackError(input)],
  search_web: null,
  fetch_web: (input, output) => [
    urlItem(str(output, "url") ?? str(input, "url") ?? ""),
  ],
}

const READ_ONLY = new Map<string, boolean>([
  ...Object.values(CONNECTOR_TOOLS).flatMap((tools) =>
    tools.map((t): [string, boolean] => [t.name, t.readOnlyHint])
  ),
  ...STANDALONE_TOOLS.map((t): [string, boolean] => [t.name, t.readOnlyHint]),
])

// Lor's own tools. Unlisted tools (plans, reactions, MCP and custom tools)
// touch nothing.
const CORE_SPECS: Record<
  string,
  (input: Rec, output: Rec) => (Touch | BrainPathTouch | null)[]
> = {
  read_thread: (input) => [touchOf("message", str(input, "messageId"), "read")],
  read_call: (input) => [touchOf("call", str(input, "sessionId"), "read")],
  fetch_source: (input) => [touchOf("source", str(input, "id"), "read")],
  memory_read: (input) => [brainPathOf(str(input, "path"), "read")],
  memory_write: (_input, output) => [brainPathOf(str(output, "path"), "wrote")],
  memory_edit: (_input, output) => [brainPathOf(str(output, "path"), "wrote")],
  share_file: (_input, output) =>
    Array.isArray(output.files)
      ? output.files.map((f) =>
          touchOf("artifact", str(f, "artifactId"), "wrote")
        )
      : [],
}

function touchOf(
  kind: TouchKind,
  value: string | null,
  action: TouchAction
): Touch | null {
  return value ? { kind, value, action } : null
}

function brainPathOf(
  path: string | null,
  action: TouchAction
): BrainPathTouch | null {
  return path ? { brainPath: path, action } : null
}

const isCatalogTool = (name: string): name is keyof typeof CATALOG_SPECS =>
  Object.hasOwn(CATALOG_SPECS, name)

// A failed call touched nothing. Write guard receipts (`outcome: "completed"`,
// output too large to keep) did happen, so their input keys still count.
function succeeded(output: Rec): boolean {
  return typeof output.error !== "string" || output.outcome === "completed"
}

function touchesForCall(call: ToolCall): (Touch | BrainPathTouch | null)[] {
  if (!succeeded(call.output)) return []
  if (isCatalogTool(call.toolName)) {
    const spec = CATALOG_SPECS[call.toolName]
    if (!spec) return []
    const action = READ_ONLY.get(call.toolName) === false ? "wrote" : "read"
    return spec(call.input, call.output).map((i) =>
      i ? { ...i, action } : null
    )
  }
  return CORE_SPECS[call.toolName]?.(call.input, call.output) ?? []
}

type ToolCall = { toolName: string; input: Rec; output: Rec }

// Stored step messages pair tool-call parts with tool-result parts by id.
// Error results are skipped; text and content results carry no typed fields.
function toolCallsOf(messages: unknown[]): ToolCall[] {
  const pending = new Map<string, { toolName: string; input: Rec }>()
  const calls: ToolCall[] = []
  for (const message of messages) {
    if (!isRec(message) || !Array.isArray(message.content)) continue
    for (const part of message.content) {
      if (!isRec(part) || typeof part.toolCallId !== "string") continue
      if (part.type === "tool-call" && typeof part.toolName === "string") {
        pending.set(part.toolCallId, {
          toolName: part.toolName,
          input: isRec(part.input) ? part.input : {},
        })
      } else if (part.type === "tool-result") {
        const call = pending.get(part.toolCallId)
        const output = isRec(part.output) ? part.output : null
        if (!call || !output || String(output.type).startsWith("error")) {
          continue
        }
        calls.push({
          ...call,
          output:
            output.type === "json" && isRec(output.value) ? output.value : {},
        })
      }
    }
  }
  return calls
}

// Everything the run's tools returned, as text: a link in the reply counts
// only if it came from here, so a made-up link records nothing. Covers MCP
// and custom tools, whose results have no typed fields.
function toolResultText(messages: unknown[]): string {
  const parts: string[] = []
  for (const message of messages) {
    if (!isRec(message) || !Array.isArray(message.content)) continue
    for (const part of message.content) {
      if (!isRec(part) || part.type !== "tool-result" || !isRec(part.output)) {
        continue
      }
      if (String(part.output.type).startsWith("error")) continue
      parts.push(JSON.stringify(part.output))
    }
  }
  return parts.join("\n")
}

const MARKDOWN_LINK = /\]\((https?:\/\/[^\s)]+)\)|<(https?:\/\/[^\s>]+)>/g
const BARE_URL = /https?:\/\/[^\s<>()[\]"']+/g

function linkTouches(reply: string, seen: string): (Touch | null)[] {
  return [...reply.matchAll(MARKDOWN_LINK)].map((m) => {
    const url = m[1] ?? m[2] ?? ""
    if (!seen.includes(url)) return null
    const found = urlItem(url)
    return found ? { ...found, action: "cited" } : null
  })
}

// Links people pasted into the turn's prompts.
function mentionTouches(prompts: string[]): (Touch | null)[] {
  return prompts.flatMap((text) =>
    [...text.matchAll(BARE_URL)].map((m) => {
      const found = urlItem(m[0].replace(/[.,;:!?]+$/, ""))
      return found ? { ...found, action: "mentioned" } : null
    })
  )
}

function citationTouches(text: string): (Touch | BrainPathTouch | null)[] {
  return [...extractCitationTokens(text)].map((token) => {
    switch (classifyToken(token)) {
      case "msg":
        return touchOf("message", prefixedTokenId(token), "cited")
      case "src":
        return touchOf("source", prefixedTokenId(token), "cited")
      case "call":
        return touchOf("call", splitCallToken(token).sessionId, "cited")
      case "page":
        return brainPathOf(token.split("|")[0]?.trim() ?? null, "cited")
    }
  })
}

export async function recordRunTouches(args: {
  workspaceId: string
  channelId: string
  threadRootId: string
  runId: string | null
  // The persisted (grounded) reply, so only verified citations count.
  replyText: string
  // The turn's prompts, for links people pasted.
  promptTexts: string[]
}): Promise<void> {
  const session = await db
    .select({ id: schema.agentSession.id })
    .from(schema.agentSession)
    .where(eq(schema.agentSession.threadRootId, args.threadRootId))
    .limit(1)
    .then((r) => r[0])
  if (!session) return

  const [steps, context] = await Promise.all([
    args.runId
      ? db
          .select({ messages: schema.agentRunStep.messages })
          .from(schema.agentRunStep)
          .where(eq(schema.agentRunStep.runId, args.runId))
          .orderBy(asc(schema.agentRunStep.step))
      : [],
    db
      .select({ messageId: schema.agentSessionContext.messageId })
      .from(schema.agentSessionContext)
      .where(eq(schema.agentSessionContext.sessionId, session.id)),
  ])

  const seen = steps.map((s) => toolResultText(s.messages)).join("\n")
  const found = [
    ...steps.flatMap((s) => toolCallsOf(s.messages).flatMap(touchesForCall)),
    ...citationTouches(args.replyText),
    ...linkTouches(args.replyText, seen),
    ...mentionTouches(args.promptTexts),
    ...context.map((c) => touchOf("message", c.messageId, "started_from")),
  ]
  const scope = found.some((t) => t && "brainPath" in t)
    ? await resolveLorRunScope(args.channelId)
    : EMPTY_LOR_RUN_SCOPE
  const resolved = await Promise.all(
    found.map(async (t): Promise<Touch | null> => {
      if (!t || !("brainPath" in t)) return t
      const id = await pageNodeId(
        args.workspaceId,
        t.brainPath,
        scope.memoryScopeChannelId
      )
      return touchOf("brain_page", id, t.action)
    })
  )

  const unique = new Map<string, Touch>()
  for (const t of resolved) {
    if (t) unique.set(`${t.kind}|${t.value}|${t.action}`, t)
  }
  if (unique.size === 0) return
  await db
    .insert(schema.touch)
    .values(
      [...unique.values()].map((t) => ({
        workspaceId: args.workspaceId,
        sessionId: session.id,
        runId: args.runId,
        ...t,
      }))
    )
    .onConflictDoNothing()
}

// Strongest first when ranking sessions that touched the same item.
const ACTION_RANK: Record<TouchAction, number> = {
  wrote: 0,
  cited: 1,
  read: 2,
  started_from: 3,
  mentioned: 4,
}
const LOOKUP_ROWS_MAX = 200
const QUERY_ITEMS_MAX = 20

export type SessionHit = {
  // The session's anchor message: read_thread reads the session from it.
  messageId: string
  title: string
  channel: string | null
  when: string
  action: TouchAction
  item: string
}

// Sessions that touched any of the items, one hit per session (its strongest
// action, then recency), under the same audience filter as message search.
export async function sessionsTouching(args: {
  workspaceId: string
  items: ItemRef[]
  privateContainerChannelId: string | null
  excludeThreadRootId: string | null
  limit: number
  // `search` filters: the session's channel, and when the touch happened.
  filters?: SearchFilters
}): Promise<SessionHit[]> {
  if (args.items.length === 0) return []
  const filters = args.filters ?? {}
  const rows = await db
    .select({
      threadRootId: schema.agentSession.threadRootId,
      title: schema.agentSession.title,
      channel: schema.channel.name,
      action: schema.touch.action,
      value: schema.touch.value,
      createdAt: schema.touch.createdAt,
    })
    .from(schema.touch)
    .innerJoin(
      schema.agentSession,
      eq(schema.agentSession.id, schema.touch.sessionId)
    )
    .innerJoin(
      schema.channel,
      eq(schema.channel.id, schema.agentSession.channelId)
    )
    .where(
      and(
        eq(schema.touch.workspaceId, args.workspaceId),
        or(
          ...args.items.map((i) =>
            and(eq(schema.touch.kind, i.kind), eq(schema.touch.value, i.value))
          )
        ),
        privateAudienceFilter(args.privateContainerChannelId),
        args.excludeThreadRootId
          ? ne(schema.agentSession.threadRootId, args.excludeThreadRootId)
          : sql`true`,
        channelFilter(filters.channel),
        dateFilter(schema.touch.createdAt, filters)
      )
    )
    .orderBy(desc(schema.touch.createdAt))
    .limit(LOOKUP_ROWS_MAX)

  const best = new Map<string, (typeof rows)[number]>()
  for (const row of rows) {
    const prev = best.get(row.threadRootId)
    if (!prev || ACTION_RANK[row.action] < ACTION_RANK[prev.action]) {
      best.set(row.threadRootId, row)
    }
  }
  return [...best.values()]
    .sort(
      (a, b) =>
        ACTION_RANK[a.action] - ACTION_RANK[b.action] ||
        b.createdAt.getTime() - a.createdAt.getTime()
    )
    .slice(0, args.limit)
    .map((row) => ({
      messageId: row.threadRootId,
      title: row.title,
      channel: row.channel,
      when: row.createdAt.toISOString(),
      action: row.action,
      item: row.value,
    }))
}

const ISSUE_KEY = /\b[A-Za-z][A-Za-z0-9]*-\d+\b/g
const GITHUB_REF = /\b([\w.-]+\/[\w.-]+)#(\d+)\b/g

// Item keys named in free text: links, issue keys and owner/repo#n refs.
// Lookup only: a false match like UTF-8 finds no touches, so it costs nothing.
export function itemsInText(text: string): ItemRef[] {
  const items = new Map<string, ItemRef>()
  const add = (i: ItemRef | null) => {
    if (i) items.set(`${i.kind}|${i.value}`, i)
  }
  for (const m of text.matchAll(BARE_URL)) {
    add(urlItem(m[0].replace(/[.,;:!?]+$/, "")))
  }
  for (const m of text.matchAll(ISSUE_KEY)) {
    add(item("linear_issue", linearIssueKey(m[0].toUpperCase())))
  }
  for (const m of text.matchAll(GITHUB_REF)) {
    if (!m[1] || !m[2]) continue
    // owner/repo#n can be either; the lookup tries both.
    add(item("github_pr", githubItemKey(m[1], m[2])))
    add(item("github_issue", githubItemKey(m[1], m[2])))
  }
  return [...items.values()].slice(0, QUERY_ITEMS_MAX)
}

type AnyToolExecute = (
  input: unknown,
  options: unknown
) => Promise<unknown> | unknown

const HINTS_MAX = 3

// Reverse hints: a connector read lists earlier sessions that touched the same
// item, so Lor learns about past work without deciding to search. Titles,
// dates and actions only, on a result Lor asked for; nothing is preloaded.
export function withTouchHints<T extends Record<string, unknown>>(
  tools: T,
  scope: {
    workspaceId: string
    privateContainerChannelId: string | null
    threadRootId: string | null
  }
): T {
  return Object.fromEntries(
    Object.entries(tools).map(([name, t]) => {
      const original = (t as { execute?: AnyToolExecute }).execute
      if (
        typeof original !== "function" ||
        !isCatalogTool(name) ||
        !CATALOG_SPECS[name] ||
        READ_ONLY.get(name) !== true
      ) {
        return [name, t]
      }
      const execute: AnyToolExecute = async (input, options) => {
        const output = await original(input, options)
        if (!isRec(output)) return output
        const items = touchesForCall({
          toolName: name,
          input: isRec(input) ? input : {},
          output,
        }).flatMap((x) => (x && !("brainPath" in x) ? [x] : []))
        if (items.length === 0) return output
        const earlier = await sessionsTouching({
          workspaceId: scope.workspaceId,
          items,
          privateContainerChannelId: scope.privateContainerChannelId,
          excludeThreadRootId: scope.threadRootId,
          limit: HINTS_MAX,
        }).catch(() => [])
        return earlier.length > 0
          ? { ...output, earlierSessions: earlier }
          : output
      }
      return [name, { ...(t as object), execute }]
    })
  ) as T
}
