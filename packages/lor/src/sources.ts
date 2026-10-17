import { and, cosineDistance, db, eq, isNotNull, schema } from "@repo/db"
import { generateText, tool } from "ai"
import { z } from "zod"
import { embedDocumentWithUsage } from "./embeddings"
import { lorSmallModel, smallGatewayOptions } from "./models"
import { getSourceProvider } from "./providers"
import { privateAudienceFilter } from "./retrieval"
import type { OnUsage, UsageEvent } from "./usage"

// Reject malformed citation ids before querying.
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type SourceHit = {
  id: string
  kind: string
  title: string
  author: string | null
  url: string | null
  when: string | null
  summary: string
}

// Every source read: active row and connection, plus the remembering channel's
// audience (requires the connection and channel joins).
function visibleSource(
  workspaceId: string,
  privateContainerChannelId: string | null
) {
  return and(
    eq(schema.source.workspaceId, workspaceId),
    eq(schema.source.status, "active"),
    eq(schema.integrationConnection.status, "active"),
    privateAudienceFilter(privateContainerChannelId)
  )
}

export async function searchSources(
  workspaceId: string,
  queryEmbedding: number[],
  limit: number,
  privateContainerChannelId: string | null
): Promise<SourceHit[]> {
  const distance = cosineDistance(schema.source.embedding, queryEmbedding)
  const rows = await db
    .select({
      id: schema.source.id,
      kind: schema.source.kind,
      title: schema.source.title,
      author: schema.source.author,
      url: schema.source.url,
      occurredAt: schema.source.occurredAt,
      createdAt: schema.source.createdAt,
      summary: schema.source.summary,
    })
    .from(schema.source)
    .innerJoin(
      schema.integrationConnection,
      eq(schema.source.connectionId, schema.integrationConnection.id)
    )
    .innerJoin(schema.channel, eq(schema.source.channelId, schema.channel.id))
    .where(
      and(
        visibleSource(workspaceId, privateContainerChannelId),
        isNotNull(schema.source.embedding)
      )
    )
    .orderBy(distance)
    .limit(limit)

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    author: r.author,
    url: r.url,
    when: (r.occurredAt ?? r.createdAt).toISOString(),
    summary: r.summary,
  }))
}

const sourceContext = z.object({
  workspaceId: z.string(),
  privateContainerChannelId: z.string().nullable().optional(),
})

export const sourceTools = {
  fetch_source: tool({
    description:
      "Read a stored source summary and citation metadata. This tool does not contact the external service. Use an enabled connector fetch tool for live full content. Cite it as [[src:<id>]] with the same id you passed.",
    inputSchema: z.object({
      id: z.string().describe("a source id from search_sources"),
    }),
    contextSchema: sourceContext,
    execute: async ({ id }, { context }) => {
      try {
        // Live reads must use connector tools so profile and approval gates apply.
        return await fetchSourceContent(
          context.workspaceId,
          id,
          context.privateContainerChannelId ?? null,
          { live: false }
        )
      } catch {
        return { error: "fetch failed" }
      }
    },
    strict: true,
  }),
}

export async function fetchSourceContent(
  workspaceId: string,
  id: string,
  privateContainerChannelId: string | null,
  options: { live: boolean } = { live: true }
) {
  const row = await db
    .select({
      provider: schema.source.provider,
      kind: schema.source.kind,
      externalId: schema.source.externalId,
      url: schema.source.url,
      title: schema.source.title,
      summary: schema.source.summary,
      connectionExternalId: schema.integrationConnection.externalId,
    })
    .from(schema.source)
    .innerJoin(
      schema.integrationConnection,
      eq(schema.source.connectionId, schema.integrationConnection.id)
    )
    .innerJoin(schema.channel, eq(schema.source.channelId, schema.channel.id))
    .where(
      and(
        eq(schema.source.id, id),
        visibleSource(workspaceId, privateContainerChannelId)
      )
    )
    .limit(1)
    .then((r) => r[0])
  if (!row) return { error: "source not found" }

  const provider = options.live ? getSourceProvider(row.provider) : null
  const fetched = provider
    ? await provider
        .fetchContent(
          { kind: row.kind, externalId: row.externalId, url: row.url },
          { externalId: row.connectionExternalId }
        )
        .catch(() => null)
    : null

  return {
    title: row.title,
    url: row.url,
    kind: row.kind,
    content: fetched ?? row.summary,
    live: fetched !== null,
  }
}

// Grounding writes the title and url into the reply, so it applies the same
// audience as search.
export async function resolveSourceCitation(
  workspaceId: string,
  id: string,
  privateContainerChannelId: string | null
): Promise<{ url: string | null; title: string } | null> {
  if (!UUID_REGEX.test(id)) return null
  const row = await db
    .select({ url: schema.source.url, title: schema.source.title })
    .from(schema.source)
    .innerJoin(
      schema.integrationConnection,
      eq(schema.source.connectionId, schema.integrationConnection.id)
    )
    .innerJoin(schema.channel, eq(schema.source.channelId, schema.channel.id))
    .where(
      and(
        eq(schema.source.id, id),
        visibleSource(workspaceId, privateContainerChannelId)
      )
    )
    .limit(1)
    .then((r) => r[0])
  return row ? { url: row.url, title: row.title } : null
}

export type IngestSourceInput = Omit<
  typeof schema.source.$inferInsert,
  | "id"
  | "channelId"
  | "summary"
  | "embedding"
  | "status"
  | "createdAt"
  | "updatedAt"
> & {
  channelId: string
  content: string
  // Optional steering for the summarize pass (a trigger's Remember hint) —
  // e.g. "this receives call transcripts; capture attendees and decisions".
  hint?: string | null
}

const SUMMARY_FALLBACK_MAX = 1000

// A metering callback failure must never change ingestion outcomes (e.g.
// trip the summary fallback or discard a good embedding).
function emitUsage(onUsage: OnUsage | undefined, event: UsageEvent) {
  try {
    onUsage?.(event)
  } catch {
    // metering is best-effort
  }
}

async function summarize(
  input: IngestSourceInput,
  onUsage?: OnUsage
): Promise<string> {
  try {
    const result = await generateText({
      model: lorSmallModel,
      reasoning: "low",
      prompt: `Summarize this ${input.provider} ${input.kind} for a team's institutional memory in 2–4 sentences: what changed or was decided, who did it, and why it matters. Be factual and specific; no preamble.${input.hint ? `\nWorkspace guidance for this data: ${input.hint}` : ""}\n\nTitle: ${input.title}\nAuthor: ${input.author ?? "unknown"}\n\n${input.content}`,
      providerOptions: {
        gateway: smallGatewayOptions,
      },
    })
    emitUsage(onUsage, {
      workspaceId: input.workspaceId,
      tool: "source.summarize",
      model: result.response.modelId,
      inputTokens: result.usage.inputTokens,
      cachedInputTokens: result.usage.inputTokenDetails.cacheReadTokens,
      outputTokens: result.usage.outputTokens,
    })
    return result.text.trim()
  } catch {
    return input.content.trim().slice(0, SUMMARY_FALLBACK_MAX)
  }
}

export async function ingestSource(
  input: IngestSourceInput,
  onUsage?: OnUsage
): Promise<void> {
  const summary = await summarize(input, onUsage)
  const embedding = await embedDocumentWithUsage(summary)
    .then((r) => {
      emitUsage(onUsage, {
        workspaceId: input.workspaceId,
        tool: "source.embed",
        model: r.model,
        inputTokens: r.tokens,
      })
      return r.embedding
    })
    .catch(() => null)

  const { content: _content, hint: _hint, ...columns } = input
  await db
    .insert(schema.source)
    .values({ ...columns, summary, embedding, status: "active" })
    .onConflictDoUpdate({
      target: [
        schema.source.workspaceId,
        schema.source.provider,
        schema.source.externalId,
      ],
      set: {
        // A reinstall or a second trigger re-remembers the same item: follow
        // the latest connection and channel.
        connectionId: input.connectionId,
        channelId: input.channelId,
        title: input.title,
        url: input.url ?? null,
        author: input.author ?? null,
        occurredAt: input.occurredAt ?? null,
        summary,
        status: "active",
        // Keep the previous embedding if this re-delivery fails to embed.
        ...(embedding ? { embedding } : {}),
      },
    })
}
