import { and, asc, db, eq, MERLIN_USER_ID, ne, or, schema, sql } from "@repo/db"
import {
  ALL_MERLIN_CAPABILITIES,
  type MerlinCapability,
  type MerlinToolCall,
} from "@repo/db/schema"
import { env } from "@repo/env/server"
import {
  generateObject,
  generateText,
  isStepCount,
  type ModelMessage,
  pruneMessages,
  streamText,
  tool,
} from "ai"
import { z } from "zod"
import {
  type BrainWriteEvent,
  brainReadTools,
  brainWriteTools,
  pageExists,
  searchBrain,
} from "./brain"
import { resolveChannelCapabilities } from "./capabilities"
import {
  classifyToken,
  extractCitationTokens,
  prefixedTokenId,
  type Resolution,
  rewriteCitations,
} from "./citations"
import { codeTools } from "./code"
import { datadogMcpTools, resolveWorkspaceDatadog } from "./datadog"
import { embedText } from "./embeddings"
import { githubTools, resolveWorkspaceGithub } from "./github"
import { linearTools, linearWriteTools, resolveWorkspaceLinear } from "./linear"
import { logger } from "./logger"
import {
  MERLIN_FALLBACK_MODEL,
  MERLIN_MODEL,
  MERLIN_SMALL_FALLBACK_MODEL,
  MERLIN_SMALL_MODEL,
} from "./models"
import { resolveSourceCitation, searchSources, sourceTools } from "./sources"
import type { OnUsage } from "./usage"

const MAX_STEPS = 30
// Total tokens (all steps summed) before the loop is forced to answer; the
// backstop against deep runs re-billing a large context every step.
const RESPOND_TOKEN_BUDGET = 300_000
// Per-step input size that triggers pruning old tool results from the context.
const COMPACT_INPUT_TOKENS = 60_000
const RESPOND_TIMEOUT_MS = 10 * 60_000
const WRITEBACK_TIMEOUT_MS = 5 * 60_000
// search runs each backend independently, so the cap is per result kind
// (messages vs. sources), not shared — one corpus can't starve the other.
const SEARCH_PER_KIND_DEFAULT = 6
const SEARCH_PER_KIND_MAX = 15
const PREFETCH_LIMIT = 3
const SNIPPET_MAX = 500
const THREAD_MAX = 100
// Max teammates listed in the mention roster injected into the answer prompt.
const ROSTER_LIMIT = 100

// The base prompt + per-connector lines are assembled by buildSystemPrompt so a
// channel only sees instructions for tools it actually has bound.
const SYSTEM_PROMPT_HEAD = `You are Merlin, the knowledge keeper for this team's Lor workspace. You answer questions about the team's work, decisions, history, and people.

You have two kinds of memory:
- Your brain: a filesystem of notes about this workspace that you read from and maintain yourself. Browse it with ls / tree, read pages with read, and save or organize knowledge with write / mkdir / move / link. Consult it first — it's your distilled knowledge (it may be sparse early on). Pages list their linked pages (relates_to, caused_by, …); follow a link with read to traverse.
- Everything else the team has produced: one search tool covers both the full chat message history (all channels) and the summarized activity of connected integrations (GitHub, Linear, …). Each hit is tagged with its type — a message comes back with its full text (read_thread pulls the rest of its thread; cite it [[msg:…]]); an integration source comes back as a summary you can expand with fetch_source (cite it [[src:…]] by id, not by pasting the url).`

const GITHUB_PROMPT_LINE = `- The team's GitHub: search_github finds pull requests and issues by keyword across the connected repos, and fetch_github pulls one's full body and discussion. Reference a PR or issue with a normal Markdown link to the result's url (these are live results, not [[src:]] citations).`

const LINEAR_PROMPT_LINE = `- The team's Linear: search_linear finds issues by keyword and fetch_linear pulls one's full description and comments. Reference a Linear issue with a normal Markdown link to its url (live results, not [[src:]] citations).`

const LINEAR_WRITE_PROMPT_LINE = `- When asked to file or follow up in Linear: create_linear_issue opens an issue. A Linear team is required — it's picked automatically when the workspace has one team, but if there are several you must say which (by key or name); the tool lists them if you don't. You can also assign the issue by passing a person's name or email (matched to a Linear member). comment_linear adds a comment to an existing issue.`

const DATADOG_PROMPT_LINE = `- The team's Datadog: search_datadog_logs searches indexed logs (query syntax like service:checkout status:error) and analyze_datadog_logs runs counts/aggregations over them. Default to the last hour unless the question implies a range, keep result limits small, and reference Datadog links with normal Markdown links (live results, not [[src:]] citations).`

const SYSTEM_PROMPT_TAIL = `You can also see images people share in the channel — they're included inline in the conversation below.

How to answer:
- For questions about THIS team/workspace, check your brain first, then use search for anything it doesn't cover. Ground your answer in what you find; note who said it and roughly when. Cite your sources inline in double brackets: a brain page by its exact path, e.g. [[/decisions/auth]]; a specific message by its id, e.g. [[msg:0b9c…]]; or a connected-tool source by its id, e.g. [[src:0b9c…]]. If nothing turns up, say you don't have it in memory yet — never invent specifics or cite pages, messages, or sources you didn't read.
- For general questions (how-to, definitions, quick help), just answer directly; no lookup needed.

Use your tools silently — don't narrate that you're searching. Gather what you need, then give one clear answer. Be concise. Use Markdown. Speak in the first person; never claim to be human.`

function buildSystemPrompt(connectorLines: string[]): string {
  return `${[SYSTEM_PROMPT_HEAD, ...connectorLines].join("\n")}\n\n${SYSTEM_PROMPT_TAIL}`
}

// Answer phase only; background write-back handles routine note-keeping.
// Only appended when the roster below is non-empty; teaches Merlin the exact
// mention token so its @mentions notify + highlight like a person's.
const MENTION_GUIDANCE = `Mentioning teammates: each person under "People you can mention" below has a mention token like <@0b9c1d2e-...>. To @-mention someone — notifying and highlighting them exactly as a teammate tagging them would — write their token verbatim, copied character-for-character from the list. Typing their name as plain text, even with an "@" (e.g. @Jane), does NOT create a mention and does NOT notify them; only the exact token does. So whenever you address or refer to one of these people, use their token in place of their name. Mention people naturally where it fits — you needn't tag everyone, just those you're actually speaking to or about.`

const ANSWER_WRITE_GUIDANCE = `Saving to your brain: only write (or mkdir / move / link) when the user explicitly asks you to remember, save, note, or organize something. When you do, make the change and briefly confirm what you saved and where (e.g. "Saved to /decisions/auth"). For ordinary questions, don't write — just answer; durable knowledge from this conversation is captured automatically afterward.`

const GATE_QUESTION = `Decide whether the exchange above is worth saving to the team's long-term memory. The bar is high — memory is for knowledge a teammate would genuinely benefit from weeks from now.

Answer true ONLY if the exchange states a specific, durable, workspace-specific fact of one of these kinds:
- a settled decision (not a proposal still under discussion),
- how one of the team's systems or processes actually works,
- who owns or is responsible for something,
- a resolved problem and its fix, or
- a lasting convention the team follows.

Answer false — the default — for everything else: small talk, greetings, transient status, questions that state no new fact (whether asked or answered), opinions, speculation, undecided proposals, general or how-to knowledge, and anything vague, one-off, or already obvious. When in doubt, answer false; saving nothing is the right outcome far more often than not.`

const WRITEBACK_INSTRUCTION = `You've just answered. Now step back and act as the keeper of this workspace's long-term memory.

Your bar for saving is high. Only save specific, durable, workspace-specific knowledge a teammate would genuinely benefit from weeks from now: a settled decision, how one of the team's systems or processes actually works, who owns or is responsible for something, a resolved problem and its fix, or a lasting convention. Save nothing for small talk, transient status, questions that state no new fact, opinions, speculation, undecided proposals, general or how-to knowledge, or anything vague or one-off. When in doubt, save nothing — a sparse, trustworthy brain is worth far more than a cluttered one.

- If (and only if) something clears that bar: first browse your brain (ls / tree / read) to find where it belongs and whether a page on this already exists (you may have already saved something while answering — don't duplicate it). Strongly prefer updating or extending an existing page over creating a new one; only create a page for a genuinely new topic. Write the smallest change that captures the fact (write creates parent folders automatically), and use link only when the relationship to another page is clear. Keep pages tight, factual, and self-contained.
- Otherwise, do nothing. This is the common case.

Page format — begin every page with a short frontmatter block, then the body:
---
summary: one line on what this page is
aliases: [terms or synonyms someone might search for this by]
---
(the markdown body)

Decide for yourself. Don't reply to the user; just maintain memory. End with one short line of what you saved, or "nothing to save".`

export type ConversationImage = {
  url: string
  filename: string
  mediaType: string
  size: number
}

export type ConversationTurn = {
  authorName: string
  content: string
  images?: ConversationImage[]
}

const VISION_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
])
const MAX_IMAGES = 8
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

// Download images because Anthropic cannot fetch private/local S3 URLs.
async function fetchImageBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return new Uint8Array(await res.arrayBuffer())
  } catch {
    return null
  }
}

export type RespondContext = {
  workspaceId: string
  conversation: ConversationTurn[]
  channelId?: string
}

export type ToolEvent = MerlinToolCall

export type RespondCallbacks = {
  onDelta: (delta: string) => void | Promise<void>
  // Summarized extended-thinking deltas, streamed before/between the answer.
  onReasoning?: (delta: string) => void | Promise<void>
  onMemoryWritten?: (e: { path: string; action: "created" | "updated" }) => void
  onToolEvent?: (e: ToolEvent) => void
  onUsage?: OnUsage
}

export { MERLIN_MODEL } from "./models"
export type { OnUsage, UsageEvent } from "./usage"

export type RespondResult = {
  text: string
  messages: ModelMessage[]
}

export type WriteBackContext = {
  workspaceId: string
  priorMessages: ModelMessage[]
  gateText: string
}

export type WriteBackCallbacks = {
  onMemoryWritten?: (e: { path: string; action: "created" | "updated" }) => void
}

// How a person appears everywhere in the app (message author header, mention
// pill, composer): prefer the handle, fall back to the real name. Merlin reads
// and mentions people by this same label so its prose and pills stay consistent.
export function userDisplayName(u: {
  name: string
  username?: string | null
  displayUsername?: string | null
}): string {
  return u.displayUsername ?? u.username ?? u.name
}

// Display names are user-controlled, so neutralize anything that could break
// the roster structure or forge a mention when interpolated into the prompt:
// drop line breaks (no injected roster lines/instructions) and angle brackets
// (no fake <@id> tokens). The real <@id> we append is the only valid mention.
function sanitizeRosterLabel(label: string): string {
  return label
    .replace(/[\r\n<>]+/g, " ")
    .trim()
    .slice(0, 80)
}

async function searchMessages(
  workspaceId: string,
  query: string,
  limit: number
) {
  const tsv = sql`to_tsvector('english', coalesce(${schema.message.content}, ''))`
  // websearch_to_tsquery ANDs its terms, so a natural-language query returns
  // nothing unless a single message contains every content word. Rewrite the
  // AND (&) operators to OR (|) so it degrades gracefully — a message matching
  // some terms still surfaces, ranked below fuller matches by ts_rank. The
  // websearch parser still handles stopword removal, stemming, and sanitizing
  // the raw user text for us.
  const tsq = sql`replace(websearch_to_tsquery('english', ${query})::text, '&', '|')::tsquery`

  const rows = await db
    .select({
      messageId: schema.message.id,
      channelId: schema.message.channelId,
      content: schema.message.content,
      createdAt: schema.message.createdAt,
      authorName: schema.user.name,
      authorUsername: schema.user.username,
      authorDisplayUsername: schema.user.displayUsername,
    })
    .from(schema.message)
    .innerJoin(schema.channel, eq(schema.message.channelId, schema.channel.id))
    .innerJoin(schema.user, eq(schema.message.authorId, schema.user.id))
    .where(
      and(
        eq(schema.channel.workspaceId, workspaceId),
        // Connector notifications are pointers — their canonical content lives
        // in `source`; surfacing them here would duplicate source results.
        eq(schema.message.excludedFromMemory, false),
        sql`${tsv} @@ ${tsq}`
      )
    )
    .orderBy(sql`ts_rank(${tsv}, ${tsq}) desc`)
    .limit(limit)

  return rows.map((r) => ({
    messageId: r.messageId,
    channelId: r.channelId,
    author: userDisplayName({
      name: r.authorName,
      username: r.authorUsername,
      displayUsername: r.authorDisplayUsername,
    }),
    when: r.createdAt.toISOString(),
    text: (r.content ?? "").slice(0, SNIPPET_MAX),
  }))
}

async function readThread(workspaceId: string, messageId: string) {
  // Tenant guard for user-visible message ids.
  const msg = await db
    .select({
      id: schema.message.id,
      threadRootId: schema.message.threadRootId,
    })
    .from(schema.message)
    .innerJoin(schema.channel, eq(schema.message.channelId, schema.channel.id))
    .where(
      and(
        eq(schema.message.id, messageId),
        eq(schema.channel.workspaceId, workspaceId)
      )
    )
    .limit(1)
    .then((r) => r[0])
  if (!msg) return []

  const rootId = msg.threadRootId ?? msg.id
  const rows = await db
    .select({
      id: schema.message.id,
      content: schema.message.content,
      createdAt: schema.message.createdAt,
      authorName: schema.user.name,
      authorUsername: schema.user.username,
      authorDisplayUsername: schema.user.displayUsername,
    })
    .from(schema.message)
    .innerJoin(schema.channel, eq(schema.message.channelId, schema.channel.id))
    .innerJoin(schema.user, eq(schema.message.authorId, schema.user.id))
    .where(
      and(
        eq(schema.channel.workspaceId, workspaceId),
        or(
          eq(schema.message.id, rootId),
          eq(schema.message.threadRootId, rootId)
        )
      )
    )
    .orderBy(asc(schema.message.createdAt))
    .limit(THREAD_MAX)

  return rows.map((r) => ({
    messageId: r.id,
    author: userDisplayName({
      name: r.authorName,
      username: r.authorUsername,
      displayUsername: r.authorDisplayUsername,
    }),
    when: r.createdAt.toISOString(),
    text: r.content ?? "",
  }))
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function messageExists(
  workspaceId: string,
  messageId: string
): Promise<boolean> {
  if (!UUID_REGEX.test(messageId)) return false
  const row = await db
    .select({ id: schema.message.id })
    .from(schema.message)
    .innerJoin(schema.channel, eq(schema.message.channelId, schema.channel.id))
    .where(
      and(
        eq(schema.message.id, messageId),
        eq(schema.channel.workspaceId, workspaceId)
      )
    )
    .limit(1)
    .then((r) => r[0])
  return !!row
}

const workspaceContext = z.object({ workspaceId: z.string() })

// Both backends rank independently and each is capped, so a bag of keywords
// can't flood one side and a phrase degrades gracefully on the other — the
// model just writes one natural query and lets each corpus return its best.
async function searchSourceSummaries(
  workspaceId: string,
  query: string,
  limit: number
) {
  return searchSources(workspaceId, await embedText(query), limit)
}

const searchTools = {
  search: tool({
    description:
      "Search the team's knowledge in one place: its chat message history (exact/keyword match) and the summarized activity of connected integrations like GitHub and Linear (semantic match). Pass a short natural-language query or phrase. Results are tagged with `type`: a `message` comes back with its full text — cite it as [[msg:<id>]]; a `source` comes back as a summary with `hasMore: true` — call fetch_source with its id for the full body, and cite it as [[src:<id>]] (don't paste its url). Pass `types` to search only one kind. Call repeatedly with different queries to investigate.",
    inputSchema: z.object({
      query: z.string().describe("a short natural-language query or phrase"),
      types: z
        .array(z.enum(["messages", "sources"]))
        .optional()
        .describe("limit to these kinds of result (default: both)"),
      limit: z
        .number()
        .optional()
        .describe("max results of each kind, 1–15 (default 6)"),
    }),
    contextSchema: workspaceContext,
    execute: async ({ query, types, limit }, { context }) => {
      const n = Math.floor(
        Math.min(
          Math.max(limit ?? SEARCH_PER_KIND_DEFAULT, 1),
          SEARCH_PER_KIND_MAX
        )
      )
      // An empty/absent types array means both kinds; a non-empty one filters.
      const want = (t: "messages" | "sources") =>
        !types || types.length === 0 || types.includes(t)
      // Each backend is isolated: one failing (e.g. the embedding call) still
      // returns the other half rather than failing the whole search.
      const [messages, sources] = await Promise.all([
        want("messages")
          ? searchMessages(context.workspaceId, query, n).catch(() => [])
          : [],
        want("sources")
          ? searchSourceSummaries(context.workspaceId, query, n).catch(() => [])
          : [],
      ])
      return [
        ...messages.map((m) => ({ type: "message" as const, ...m })),
        ...sources.map((s) => ({
          type: "source" as const,
          hasMore: true,
          ...s,
        })),
      ]
    },
    strict: true,
  }),
}

const chatTools = {
  read_thread: tool({
    description:
      "Read the full thread (root message + all replies) a message belongs to. Use after search_messages to get full context around a hit.",
    inputSchema: z.object({
      messageId: z.string().describe("a message id from search_messages"),
    }),
    contextSchema: workspaceContext,
    execute: async ({ messageId }, { context }) => {
      try {
        return await readThread(context.workspaceId, messageId)
      } catch {
        return { error: "read failed" }
      }
    },
    strict: true,
  }),
}

// Context for the always-bound tools; connector tool contexts are added per
// call in respond() based on what the channel has bound.
function coreToolsContext(
  workspaceId: string,
  onWrite?: (e: BrainWriteEvent) => void
) {
  const workspace = { workspaceId }
  return {
    search: workspace,
    read_thread: workspace,
    fetch_source: workspace,
    ls: workspace,
    read: workspace,
    tree: workspace,
    write: { workspaceId, onWrite },
    mkdir: workspace,
    move: workspace,
    link: workspace,
  }
}

function toolLabel(toolName: string, input: unknown): string {
  const field = (k: string): string | undefined => {
    if (input && typeof input === "object" && k in input) {
      const v = (input as Record<string, unknown>)[k]
      if (typeof v === "string" && v.trim()) return v.trim().slice(0, 60)
    }
    return undefined
  }
  const query = field("query")
  const path = field("path")
  const repo = field("repo")
  const ref = field("ref")
  switch (toolName) {
    case "investigate_code":
      return repo ? `Investigating ${repo}` : "Investigating the codebase"
    case "search_github":
      return query ? `Searching GitHub for “${query}”` : "Searching GitHub"
    case "fetch_github":
      return ref ? `Reading ${ref}` : "Reading a pull request/issue"
    case "search_linear":
      return query ? `Searching Linear for “${query}”` : "Searching Linear"
    case "fetch_linear":
      return "Reading a Linear issue"
    case "create_linear_issue": {
      const title = field("title")
      return title
        ? `Creating Linear issue “${title}”`
        : "Creating a Linear issue"
    }
    case "comment_linear":
      return "Commenting on a Linear issue"
    case "search_datadog_logs":
      return query
        ? `Searching Datadog logs for “${query}”`
        : "Searching Datadog logs"
    case "analyze_datadog_logs":
      return "Analyzing Datadog logs"
    case "search":
      return query ? `Searching for “${query}”` : "Searching"
    case "read_thread":
      return "Reading a thread"
    case "fetch_source":
      return "Fetching a source"
    case "ls":
    case "tree":
      return "Looking through memory"
    case "read":
      return path ? `Reading memory ${path}` : "Reading memory"
    case "write":
      return path ? `Saving ${path}` : "Saving to memory"
    case "mkdir":
      return path ? `Creating folder ${path}` : "Creating a folder"
    case "move":
      return "Reorganizing memory"
    case "link":
      return "Linking pages"
    default:
      return `Working (${toolName})`
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}
function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined
}

function toolDetail(
  toolName: string,
  output: unknown
): Pick<MerlinToolCall, "detail" | "status"> {
  const rec = asRecord(output)
  if (rec && "error" in rec) {
    return {
      status: "error",
      detail: { summary: asString(rec.error) ?? "failed" },
    }
  }
  const toItems = (
    arr: unknown
  ): NonNullable<MerlinToolCall["detail"]>["items"] => {
    if (!Array.isArray(arr) || arr.length === 0) return undefined
    return arr.slice(0, 8).map((it) => {
      const r = asRecord(it)
      return {
        title:
          asString(r?.title) ?? asString(r?.text)?.slice(0, 80) ?? "untitled",
        url: asString(r?.url),
      }
    })
  }
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`
  switch (toolName) {
    case "search": {
      const items = Array.isArray(output) ? output : []
      const msgs = items.filter((it) => asRecord(it)?.type === "message").length
      const srcs = items.length - msgs
      const groups = [
        msgs > 0 ? plural(msgs, "message") : null,
        srcs > 0 ? plural(srcs, "source") : null,
      ].filter((g): g is string => g !== null)
      return {
        status: "ok",
        detail: {
          summary: items.length === 0 ? "No results" : groups.join(", "),
          items: toItems(output),
        },
      }
    }
    case "fetch_source": {
      const title = asString(rec?.title)
      return {
        status: "ok",
        detail: {
          summary:
            rec?.live === true ? "Fetched live content" : "Used stored summary",
          items: title ? [{ title, url: asString(rec?.url) }] : undefined,
        },
      }
    }
    case "search_github": {
      const results = Array.isArray(rec?.results) ? rec.results : []
      const note = asString(rec?.note)
      const base =
        results.length === 0 ? "No results" : plural(results.length, "result")
      return {
        status: "ok",
        detail: {
          summary: note ? `${base} · ${note}` : base,
          items: results.slice(0, 8).map((it) => {
            const r = asRecord(it)
            const itemRef = asString(r?.ref)
            const title = asString(r?.title) ?? "untitled"
            return {
              title: itemRef ? `${itemRef} ${title}` : title,
              url: asString(r?.url),
            }
          }),
        },
      }
    }
    case "fetch_github": {
      const title = asString(rec?.title)
      return {
        status: "ok",
        detail: {
          summary:
            rec?.type === "pull_request"
              ? "Fetched a pull request"
              : "Fetched an issue",
          items: title ? [{ title, url: asString(rec?.url) }] : undefined,
        },
      }
    }
    case "investigate_code": {
      const findings = asString(rec?.findings)
      return {
        status: "ok",
        detail: {
          summary: findings?.slice(0, 16000) ?? "Explored the codebase",
        },
      }
    }
    case "search_linear": {
      const results = Array.isArray(rec?.results) ? rec.results : []
      return {
        status: "ok",
        detail: {
          summary:
            results.length === 0
              ? "No results"
              : plural(results.length, "result"),
          items: results.slice(0, 8).map((it) => {
            const r = asRecord(it)
            const identifier = asString(r?.identifier)
            const title = asString(r?.title) ?? "untitled"
            return {
              title: identifier ? `${identifier} ${title}` : title,
              url: asString(r?.url),
            }
          }),
        },
      }
    }
    case "fetch_linear": {
      const identifier = asString(rec?.identifier)
      const title = asString(rec?.title)
      const label = identifier && title ? `${identifier} ${title}` : title
      return {
        status: "ok",
        detail: {
          summary: "Fetched a Linear issue",
          items: label
            ? [{ title: label, url: asString(rec?.url) }]
            : undefined,
        },
      }
    }
    case "create_linear_issue": {
      const identifier = asString(rec?.identifier)
      const title = asString(rec?.title)
      const description = asString(rec?.description)
      const assignee = asString(rec?.assignee)
      const label = identifier && title ? `${identifier} ${title}` : title
      const created = identifier ? `Created ${identifier}` : "Created an issue"
      const heading = assignee
        ? `${created} · assigned to ${assignee}`
        : created
      return {
        status: "ok",
        detail: {
          summary: description ? `${heading}\n\n${description}` : heading,
          items: label
            ? [{ title: label, url: asString(rec?.url) }]
            : undefined,
        },
      }
    }
    case "comment_linear": {
      const body = asString(rec?.body)
      const url = asString(rec?.url)
      return {
        status: "ok",
        detail: {
          summary: body ?? "Comment added",
          items: url ? [{ title: "View comment", url }] : undefined,
        },
      }
    }
    case "search_datadog_logs":
    case "analyze_datadog_logs": {
      // MCP tool result: { content: [{ type: "text", text }], isError? }.
      const parts = Array.isArray(rec?.content) ? rec.content : []
      const firstText = parts
        .map((p) => asString(asRecord(p)?.text))
        .find((t) => t !== undefined)
      if (rec?.isError === true) {
        return {
          status: "error",
          detail: { summary: firstText?.slice(0, 200) ?? "failed" },
        }
      }
      return {
        status: "ok",
        detail: {
          summary:
            toolName === "search_datadog_logs"
              ? "Searched Datadog logs"
              : "Analyzed Datadog logs",
        },
      }
    }
    case "write": {
      const path = asString(rec?.path)
      const body = asString(rec?.body)
      const verb = rec?.action === "updated" ? "Updated" : "Saved"
      const heading = path ? `${verb} ${path}` : verb
      return {
        status: "ok",
        detail: { summary: body ? `${heading}\n\n${body}` : heading },
      }
    }
    case "mkdir": {
      const path = asString(rec?.path)
      return {
        status: "ok",
        detail: {
          summary: path ? `Created folder ${path}` : "Created a folder",
        },
      }
    }
    case "move": {
      const from = asString(rec?.from)
      const to = asString(rec?.to)
      return {
        status: "ok",
        detail: {
          summary: from && to ? `Moved ${from} → ${to}` : "Moved a page",
        },
      }
    }
    case "link": {
      const from = asString(rec?.from)
      const to = asString(rec?.to)
      const type = asString(rec?.type)
      const summary =
        from && to
          ? `Linked ${from} ${type ? `(${type}) ` : ""}→ ${to}`
          : "Linked pages"
      return { status: "ok", detail: { summary } }
    }
    default:
      return { status: "ok" }
  }
}

export async function respond(
  ctx: RespondContext,
  {
    onDelta,
    onReasoning,
    onMemoryWritten,
    onToolEvent,
    onUsage,
  }: RespondCallbacks
): Promise<RespondResult> {
  const respondStart = performance.now()
  const question = ctx.conversation[ctx.conversation.length - 1]?.content ?? ""
  let brainContext = ""
  if (question.trim()) {
    const prefetchStart = performance.now()
    try {
      const hits = await searchBrain(
        ctx.workspaceId,
        await embedText(question),
        PREFETCH_LIMIT
      )
      if (hits.length > 0) {
        brainContext = `\n\nRelevant notes from your brain:\n\n${hits
          .map((h) => {
            const links = h.links.length
              ? `\nLinked: ${h.links
                  .map(
                    (l) =>
                      `${l.type} ${l.direction === "out" ? "→" : "←"} ${l.path}`
                  )
                  .join("; ")}`
              : ""
            return `## ${h.path}\n${h.body}${links}`
          })
          .join("\n\n")}`
      }
    } catch {}
    logger.info(
      { ms: Math.round(performance.now() - prefetchStart) },
      "Merlin brain prefetch timing"
    )
  }

  // Roster of teammates Merlin can @-mention. Rendered with their exact
  // <@id> token so Merlin's mentions fan out and highlight like a person's.
  const roster = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      username: schema.user.username,
      displayUsername: schema.user.displayUsername,
    })
    .from(schema.workspaceMember)
    .innerJoin(schema.user, eq(schema.workspaceMember.userId, schema.user.id))
    .where(
      and(
        eq(schema.workspaceMember.workspaceId, ctx.workspaceId),
        ne(schema.user.id, MERLIN_USER_ID),
        // Keep anyone with a usable label, matching userDisplayName's fallback
        // (displayUsername → username → name) so username-only profiles survive.
        sql`btrim(coalesce(${schema.user.displayUsername}, ${schema.user.username}, ${schema.user.name})) <> ''`
      )
    )
    .orderBy(asc(schema.user.name))
    .limit(ROSTER_LIMIT)
    .catch(() => [])
  const rosterText =
    roster.length > 0
      ? `\n\nPeople you can mention (write the token exactly to @-mention them):\n${roster
          .map((m) => `${sanitizeRosterLabel(userDisplayName(m))} <@${m.id}>`)
          .join("\n")}`
      : ""

  type UserPart =
    | { type: "text"; text: string }
    | { type: "image"; image: Uint8Array; mediaType: string }

  const eligible = ctx.conversation.flatMap((t, turnIndex) =>
    (t.images ?? [])
      .filter(
        (img) =>
          VISION_MEDIA_TYPES.has(img.mediaType) && img.size <= MAX_IMAGE_BYTES
      )
      .map((img) => ({ ...img, turnIndex }))
  )
  const kept = eligible.slice(-MAX_IMAGES)
  const bytesByKey = new Map<string, Uint8Array>()
  await Promise.all(
    kept.map(async (img) => {
      const bytes = await fetchImageBytes(img.url)
      if (bytes) bytesByKey.set(`${img.turnIndex}:${img.url}`, bytes)
    })
  )

  const parts: UserPart[] = [
    { type: "text", text: "Recent conversation in this channel:" },
  ]
  ctx.conversation.forEach((t, turnIndex) => {
    parts.push({ type: "text", text: `\n${t.authorName}: ${t.content}` })
    for (const img of t.images ?? []) {
      const bytes = bytesByKey.get(`${turnIndex}:${img.url}`)
      if (bytes) {
        parts.push({ type: "text", text: `\n[image: ${img.filename}]` })
        parts.push({ type: "image", image: bytes, mediaType: img.mediaType })
      } else {
        parts.push({ type: "text", text: `\n[attachment: ${img.filename}]` })
      }
    }
  })
  if (brainContext) parts.push({ type: "text", text: brainContext })
  if (rosterText) parts.push({ type: "text", text: rosterText })
  parts.push({
    type: "text",
    text: "\n\n---\nAnswer the most recent message, grounded in the brain notes, images, and conversation above. Use your tools (brain ls/read, search) for anything they don't cover.",
  })

  const userMessage: ModelMessage = { role: "user", content: parts }

  // resolveChannelCapabilities already maps truly unprovisioned channels to the
  // permissive set; an actual throw here is an unexpected failure, so fail
  // closed to core-only (no gated tools) rather than granting everything.
  const caps = ctx.channelId
    ? await resolveChannelCapabilities(ctx.channelId).catch(
        () => [] as MerlinCapability[]
      )
    : ALL_MERLIN_CAPABILITIES
  const needsGithub = caps.includes("github") || caps.includes("code")
  const needsLinear = caps.includes("linear") || caps.includes("linear_write")
  // Independent lookups run concurrently; the Datadog MCP handshake is the
  // slow one and is itself time-bounded inside datadogMcpTools.
  const [github, linear, datadogMcp] = await Promise.all([
    needsGithub
      ? resolveWorkspaceGithub(ctx.workspaceId).catch(() => null)
      : null,
    needsLinear
      ? resolveWorkspaceLinear(ctx.workspaceId).catch(() => null)
      : null,
    caps.includes("datadog")
      ? resolveWorkspaceDatadog(ctx.workspaceId)
          .then((d) => (d ? datadogMcpTools(d.externalId) : null))
          .catch(() => null)
      : null,
  ])

  const tools = {
    ...searchTools,
    ...chatTools,
    ...sourceTools,
    ...brainReadTools,
    ...brainWriteTools,
    ...(github && caps.includes("github") ? githubTools : {}),
    ...(env.RAILWAY_API_TOKEN && github && caps.includes("code")
      ? codeTools
      : {}),
    ...(linear && caps.includes("linear") ? linearTools : {}),
    ...(linear && caps.includes("linear_write") ? linearWriteTools : {}),
    ...(datadogMcp ? datadogMcp.tools : {}),
  }

  const toolsContext = {
    ...coreToolsContext(ctx.workspaceId, onMemoryWritten),
    ...(github
      ? {
          search_github: github,
          fetch_github: github,
          investigate_code: {
            workspaceId: ctx.workspaceId,
            installationId: github.installationId,
            repos: github.repos,
            onUsage,
            onToolEvent,
          },
        }
      : {}),
    ...(linear
      ? {
          search_linear: linear,
          fetch_linear: linear,
          create_linear_issue: linear,
          comment_linear: linear,
        }
      : {}),
  }

  // Only describe the connectors actually bound for this channel.
  const connectorPromptLines = [
    github && caps.includes("github") ? GITHUB_PROMPT_LINE : null,
    linear && caps.includes("linear") ? LINEAR_PROMPT_LINE : null,
    linear && caps.includes("linear_write") ? LINEAR_WRITE_PROMPT_LINE : null,
    datadogMcp ? DATADOG_PROMPT_LINE : null,
  ].filter((line): line is string => line !== null)
  const instructions = `${buildSystemPrompt(connectorPromptLines)}\n\n${ANSWER_WRITE_GUIDANCE}${roster.length > 0 ? `\n\n${MENTION_GUIDANCE}` : ""}`

  logger.info(
    { ms: Math.round(performance.now() - respondStart) },
    "Merlin pre-stream setup timing"
  )

  // The finally closes the Datadog MCP session after the whole tool loop, even
  // if streamText or step preparation throws before streaming completes.
  try {
    const streamStart = performance.now()
    let firstPartLogged = false
    const result = streamText({
      model: MERLIN_MODEL,
      instructions,
      messages: [userMessage],
      tools,
      toolsContext,
      stopWhen: isStepCount(MAX_STEPS),
      timeout: { totalMs: RESPOND_TIMEOUT_MS },
      prepareStep: ({ stepNumber, steps, messages }) => {
        // The step cap and token budget can land on tool use; disabling tools
        // on the last step forces the loop to end with a text answer.
        const spent = steps.reduce((n, s) => n + (s.usage.totalTokens ?? 0), 0)
        if (stepNumber === MAX_STEPS - 1 || spent >= RESPOND_TOKEN_BUDGET) {
          return { toolChoice: "none" }
        }
        // Compact old tool calls/results once the context gets heavy. Reasoning
        // is kept: Anthropic requires thinking blocks preserved across tool use.
        const lastInput = steps.at(-1)?.usage.inputTokens ?? 0
        if (lastInput > COMPACT_INPUT_TOKENS) {
          return {
            messages: pruneMessages({
              messages,
              toolCalls: "before-last-4-messages",
            }),
          }
        }
        return {}
      },
      // Reasoning config is namespaced per provider; whichever provider serves
      // the request uses its own entry. "summarized" is required to stream the
      // reasoning deltas. gateway.caching places Anthropic cache markers.
      providerOptions: {
        anthropic: {
          thinking: { type: "adaptive", effort: "high", display: "summarized" },
        },
        openai: { reasoningEffort: "high", reasoningSummary: "detailed" },
        gateway: { caching: "auto", models: [MERLIN_FALLBACK_MODEL] },
      },
    })

    // stream exposes tool call/status + reasoning events; textStream does not.
    let text = ""
    for await (const part of result.stream) {
      if (!firstPartLogged) {
        firstPartLogged = true
        logger.info(
          {
            ms: Math.round(performance.now() - streamStart),
            partType: part.type,
          },
          "Merlin time to first stream part"
        )
      }
      if (part.type === "text-delta") {
        text += part.text
        await onDelta(part.text)
      } else if (part.type === "reasoning-delta") {
        await onReasoning?.(part.text)
      } else if (part.type === "tool-call") {
        onToolEvent?.({
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          label: toolLabel(part.toolName, part.input),
          at: text.length,
        })
      } else if (part.type === "tool-result") {
        const resolved = toolDetail(part.toolName, part.output)
        if (resolved.status === "error") {
          logger.warn(
            { tool: part.toolName, error: resolved.detail?.summary },
            "Merlin tool returned an error"
          )
        }
        onToolEvent?.({
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          label: toolLabel(part.toolName, part.input),
          at: text.length,
          ...resolved,
        })
      } else if (part.type === "error") {
        throw part.error
      }
    }

    const responseMessages = await result.responseMessages

    return { text, messages: [userMessage, ...responseMessages] }
  } finally {
    await datadogMcp?.close()
  }
}

export async function writeBack(
  ctx: WriteBackContext,
  { onMemoryWritten }: WriteBackCallbacks
): Promise<void> {
  const gate = await generateObject({
    model: MERLIN_SMALL_MODEL,
    // reason first so the model commits to a justification before the verdict.
    schema: z.object({ reason: z.string(), worthSaving: z.boolean() }),
    prompt: `${ctx.gateText}\n\n---\n${GATE_QUESTION}`,
    providerOptions: {
      gateway: { models: [MERLIN_SMALL_FALLBACK_MODEL] },
    },
  })
  logger.info(
    { workspaceId: ctx.workspaceId, ...gate.object },
    "Write-back salience gate"
  )
  if (!gate.object.worthSaving) return

  await generateText({
    model: MERLIN_MODEL,
    instructions: buildSystemPrompt([]),
    messages: [
      ...ctx.priorMessages,
      { role: "user", content: WRITEBACK_INSTRUCTION },
    ],
    tools: {
      ...searchTools,
      ...chatTools,
      ...sourceTools,
      ...brainReadTools,
      ...brainWriteTools,
    },
    toolsContext: coreToolsContext(ctx.workspaceId, onMemoryWritten),
    stopWhen: isStepCount(MAX_STEPS),
    timeout: { totalMs: WRITEBACK_TIMEOUT_MS },
    providerOptions: {
      gateway: { caching: "auto", models: [MERLIN_FALLBACK_MODEL] },
    },
  })
}

// Workspace-scoped, best-effort citation verification.
export async function groundCitations(
  workspaceId: string,
  text: string
): Promise<{ text: string; valid: number; invalid: number }> {
  const tokens = extractCitationTokens(text)
  if (tokens.size === 0) return { text, valid: 0, invalid: 0 }

  const resolutions = new Map<string, Resolution>()
  await Promise.all(
    [...tokens].map(async (t) => {
      const kind = classifyToken(t)
      if (kind === "src") {
        const source = await resolveSourceCitation(
          workspaceId,
          prefixedTokenId(t)
        ).catch(() => null)
        resolutions.set(t, { kind: "src", source })
      } else if (kind === "msg") {
        const exists = await messageExists(
          workspaceId,
          prefixedTokenId(t)
        ).catch(() => false)
        resolutions.set(t, { kind: "msg", exists })
      } else {
        const exists = await pageExists(workspaceId, t).catch(() => false)
        resolutions.set(t, { kind: "page", exists })
      }
    })
  )

  const fallback = (t: string): Resolution => {
    const kind = classifyToken(t)
    return kind === "src"
      ? { kind: "src", source: null }
      : { kind, exists: false }
  }
  return rewriteCitations(text, (t) => resolutions.get(t) ?? fallback(t))
}
