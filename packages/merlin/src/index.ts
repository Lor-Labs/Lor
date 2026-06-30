import { anthropic } from "@ai-sdk/anthropic"
import { and, asc, db, eq, or, schema, sql } from "@repo/db"
import {
  ALL_MERLIN_CAPABILITIES,
  type MerlinCapability,
  type MerlinToolCall,
} from "@repo/db/schema"
import { env } from "@repo/env/server"
import {
  generateObject,
  generateText,
  type ModelMessage,
  stepCountIs,
  streamText,
  tool,
} from "ai"
import { z } from "zod"
import {
  buildBrainReadTools,
  buildBrainWriteTools,
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
import { buildCodeTools } from "./code"
import { embedText } from "./embeddings"
import { buildGithubTools, resolveWorkspaceGithub } from "./github"
import {
  buildLinearTools,
  buildLinearWriteTools,
  resolveWorkspaceLinear,
} from "./linear"
import { logger } from "./logger"
import { buildSourceTools, resolveSourceCitation } from "./sources"
import type { OnUsage } from "./usage"

export const MERLIN_MODEL = "claude-sonnet-4-6"
const MERLIN_GATE_MODEL = "claude-haiku-4-5"

const MAX_STEPS = 12
const SEARCH_DEFAULT_LIMIT = 8
const PREFETCH_LIMIT = 3
const SNIPPET_MAX = 500
const THREAD_MAX = 100

const SYSTEM_PROMPT = `You are Merlin, the knowledge keeper for this team's Lor workspace. You answer questions about the team's work, decisions, history, and people.

You have two kinds of memory:
- Your brain: a filesystem of notes about this workspace that you read from and maintain yourself. Browse it with ls / tree, read pages with read, and save or organize knowledge with write / mkdir / move / link. Consult it first — it's your distilled knowledge (it may be sparse early on). Pages list their linked pages (relates_to, caused_by, …); follow a link with read to traverse.
- The team's message history: search it with search_messages (keyword, all channels) and read_thread for full context.
- The team's GitHub (when connected): search_github finds pull requests and issues by keyword across the connected repos, and fetch_github pulls one's full body and discussion. Reference a PR or issue with a normal Markdown link to the result's url (these are live results, not [[src:]] citations). (search_sources / fetch_source cover other connected integrations' summarized activity — cite those by id in double brackets, e.g. [[src:0b9c…]], not by pasting the url.)

You can also see images people share in the channel — they're included inline in the conversation below.

How to answer:
- For questions about THIS team/workspace, check your brain first, then search the message history for anything it doesn't cover. Ground your answer in what you find; note who said it and roughly when. Cite your sources inline in double brackets: a brain page by its exact path, e.g. [[/decisions/auth]]; a specific message by its id from search_messages / read_thread, e.g. [[msg:0b9c…]]; or a connected-tool source by its id from search_sources / fetch_source, e.g. [[src:0b9c…]]. If nothing turns up, say you don't have it in memory yet — never invent specifics or cite pages, messages, or sources you didn't read.
- For general questions (how-to, definitions, quick help), just answer directly; no lookup needed.

Use your tools silently — don't narrate that you're searching. Gather what you need, then give one clear answer. Be concise. Use Markdown. Speak in the first person; never claim to be human.`

// Answer phase only; background write-back handles routine note-keeping.
const ANSWER_WRITE_GUIDANCE = `Saving to your brain: only write (or mkdir / move / link) when the user explicitly asks you to remember, save, note, or organize something. When you do, make the change and briefly confirm what you saved and where (e.g. "Saved to /decisions/auth"). For ordinary questions, don't write — just answer; durable knowledge from this conversation is captured automatically afterward.`

const GATE_QUESTION = `Does the exchange above contain durable team knowledge worth saving to long-term memory — a decision, how something works, who owns or is responsible for what, a resolved problem, or a lasting fact? Answer false for small talk, transient status, or general/how-to questions.`

const WRITEBACK_INSTRUCTION = `You've just answered. Now step back and act as the keeper of this workspace's long-term memory.

Looking only at what was just discussed and what you found: is there durable knowledge here worth saving — a decision, how something works, who owns or is responsible for what, a resolved problem, or a convention/fact that will matter weeks from now?

- If yes: first browse your brain (ls / tree / read) to find where it belongs and whether a page on this already exists (you may have already saved something while answering — don't duplicate it). Strongly prefer updating or extending an existing page over creating a near-duplicate. Then write the page (write creates parent folders automatically), and use link if it clearly relates to another page. Keep pages tight, factual, and self-contained.
- If there's nothing durable here — small talk, transient status, or a general question — do nothing.

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
  onMemoryWritten?: (e: { path: string; action: "created" | "updated" }) => void
  onToolEvent?: (e: ToolEvent) => void
  onUsage?: OnUsage
}

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

async function searchMessages(
  workspaceId: string,
  query: string,
  limit: number
) {
  const tsv = sql`to_tsvector('english', coalesce(${schema.message.content}, ''))`
  const tsq = sql`websearch_to_tsquery('english', ${query})`

  const rows = await db
    .select({
      messageId: schema.message.id,
      channelId: schema.message.channelId,
      content: schema.message.content,
      createdAt: schema.message.createdAt,
      authorName: schema.user.name,
    })
    .from(schema.message)
    .innerJoin(schema.channel, eq(schema.message.channelId, schema.channel.id))
    .innerJoin(schema.user, eq(schema.message.authorId, schema.user.id))
    .where(
      and(eq(schema.channel.workspaceId, workspaceId), sql`${tsv} @@ ${tsq}`)
    )
    .orderBy(sql`ts_rank(${tsv}, ${tsq}) desc`)
    .limit(limit)

  return rows.map((r) => ({
    messageId: r.messageId,
    channelId: r.channelId,
    author: r.authorName,
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
    author: r.authorName,
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

function buildChatTools(workspaceId: string) {
  return {
    search_messages: tool({
      description:
        "Search the team's message history (all channels) by keyword. Returns matching messages with author, date, channel, and id. Call repeatedly with different keywords to investigate.",
      inputSchema: z.object({
        query: z.string().describe("keywords to search for"),
        limit: z.number().optional().describe("max results, 1–20 (default 8)"),
      }),
      execute: async ({ query, limit }) => {
        try {
          const n = Math.floor(
            Math.min(Math.max(limit ?? SEARCH_DEFAULT_LIMIT, 1), 20)
          )
          return await searchMessages(workspaceId, query, n)
        } catch {
          return { error: "search failed" }
        }
      },
      strict: true,
    }),
    read_thread: tool({
      description:
        "Read the full thread (root message + all replies) a message belongs to. Use after search_messages to get full context around a hit.",
      inputSchema: z.object({
        messageId: z.string().describe("a message id from search_messages"),
      }),
      execute: async ({ messageId }) => {
        try {
          return await readThread(workspaceId, messageId)
        } catch {
          return { error: "read failed" }
        }
      },
      strict: true,
    }),
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
    case "search_messages":
      return query ? `Searching messages for “${query}”` : "Searching messages"
    case "read_thread":
      return "Reading a thread"
    case "search_sources":
      return query
        ? `Searching connected sources for “${query}”`
        : "Searching connected sources"
    case "fetch_source":
      return "Fetching a source"
    case "ls":
    case "tree":
      return "Looking through memory"
    case "read":
      return path ? `Reading memory ${path}` : "Reading memory"
    case "write":
    case "mkdir":
    case "move":
    case "link":
      return "Updating memory"
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
  const count = Array.isArray(output) ? output.length : 0
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`
  switch (toolName) {
    case "search_sources":
      return {
        status: "ok",
        detail: {
          summary: count === 0 ? "No results" : plural(count, "result"),
          items: toItems(output),
        },
      }
    case "search_messages":
      return {
        status: "ok",
        detail: {
          summary: count === 0 ? "No matches" : plural(count, "message"),
          items: toItems(output),
        },
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
    default:
      return { status: "ok" }
  }
}

export async function respond(
  ctx: RespondContext,
  { onDelta, onMemoryWritten, onToolEvent, onUsage }: RespondCallbacks
): Promise<RespondResult> {
  const question = ctx.conversation[ctx.conversation.length - 1]?.content ?? ""
  let brainContext = ""
  if (question.trim()) {
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
  }

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
  parts.push({
    type: "text",
    text: "\n\n---\nAnswer the most recent message, grounded in the brain notes, images, and conversation above. Use your tools (brain ls/read, message search) for anything they don't cover.",
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
  const github = needsGithub
    ? await resolveWorkspaceGithub(ctx.workspaceId).catch(() => null)
    : null
  const needsLinear = caps.includes("linear") || caps.includes("linear_write")
  const linear = needsLinear
    ? await resolveWorkspaceLinear(ctx.workspaceId).catch(() => null)
    : null

  const tools = {
    ...buildChatTools(ctx.workspaceId),
    ...buildSourceTools(ctx.workspaceId),
    ...buildBrainReadTools(ctx.workspaceId),
    ...buildBrainWriteTools(ctx.workspaceId, onMemoryWritten),
    ...(github && caps.includes("github") ? buildGithubTools(github) : {}),
    ...(env.RAILWAY_API_TOKEN && github && caps.includes("code")
      ? buildCodeTools(ctx.workspaceId, {
          installationId: github.installationId,
          onUsage,
          onToolEvent,
          repos: github.repos,
        })
      : {}),
    ...(linear && caps.includes("linear") ? buildLinearTools(linear) : {}),
    ...(linear && caps.includes("linear_write")
      ? buildLinearWriteTools(linear)
      : {}),
  }

  const result = streamText({
    model: anthropic(MERLIN_MODEL),
    system: `${SYSTEM_PROMPT}\n\n${ANSWER_WRITE_GUIDANCE}`,
    messages: [userMessage],
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
  })

  // fullStream exposes tool call/status events; textStream does not.
  let text = ""
  for await (const part of result.fullStream) {
    if (part.type === "text-delta") {
      text += part.text
      await onDelta(part.text)
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

  const response = await result.response

  // Step cap can end on tool use; force one final no-tools text pass.
  if (!text.trim()) {
    const retry = streamText({
      model: anthropic(MERLIN_MODEL),
      system: `${SYSTEM_PROMPT}\n\n${ANSWER_WRITE_GUIDANCE}`,
      messages: [userMessage, ...response.messages],
      tools,
      toolChoice: "none",
    })
    for await (const delta of retry.textStream) {
      text += delta
      await onDelta(delta)
    }
    const retryResponse = await retry.response
    return {
      text,
      messages: [userMessage, ...response.messages, ...retryResponse.messages],
    }
  }

  return { text, messages: [userMessage, ...response.messages] }
}

export async function writeBack(
  ctx: WriteBackContext,
  { onMemoryWritten }: WriteBackCallbacks
): Promise<void> {
  const gate = await generateObject({
    model: anthropic(MERLIN_GATE_MODEL),
    schema: z.object({ worthSaving: z.boolean() }),
    prompt: `${ctx.gateText}\n\n---\n${GATE_QUESTION}`,
  })
  if (!gate.object.worthSaving) return

  await generateText({
    model: anthropic(MERLIN_MODEL),
    system: SYSTEM_PROMPT,
    messages: [
      ...ctx.priorMessages,
      { role: "user", content: WRITEBACK_INSTRUCTION },
    ],
    tools: {
      ...buildChatTools(ctx.workspaceId),
      ...buildSourceTools(ctx.workspaceId),
      ...buildBrainReadTools(ctx.workspaceId),
      ...buildBrainWriteTools(ctx.workspaceId, onMemoryWritten),
    },
    stopWhen: stepCountIs(MAX_STEPS),
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
