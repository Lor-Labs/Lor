import { and, cosineDistance, db, eq, isNotNull, schema } from "@repo/db"
import { generateText, tool } from "ai"
import { z } from "zod"
import { embedTextWithUsage } from "./embeddings"
import { MERLIN_SMALL_FALLBACK_MODEL, MERLIN_SMALL_MODEL } from "./models"
import { getSourceProvider } from "./providers"
import type { OnUsage } from "./usage"

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

export async function searchSources(
  workspaceId: string,
  queryEmbedding: number[],
  limit: number
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
    .where(
      and(
        eq(schema.source.workspaceId, workspaceId),
        eq(schema.source.status, "active"),
        eq(schema.integrationConnection.status, "active"),
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

const workspaceContext = z.object({ workspaceId: z.string() })

export const sourceTools = {
  fetch_source: tool({
    description:
      "Fetch a source's full content (the complete PR/issue/release body and discussion), beyond the summary from search_sources. Pass a source id. Returns a `live` flag: when false the integration was unreachable and `content` falls back to the stored summary. Cite it as [[src:<id>]] with the same id you passed.",
    inputSchema: z.object({
      id: z.string().describe("a source id from search_sources"),
    }),
    contextSchema: workspaceContext,
    execute: async ({ id }, { context }) => {
      try {
        return await fetchSourceContent(context.workspaceId, id)
      } catch {
        return { error: "fetch failed" }
      }
    },
    strict: true,
  }),
}

export async function fetchSourceContent(workspaceId: string, id: string) {
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
    .where(
      and(
        eq(schema.source.id, id),
        eq(schema.source.workspaceId, workspaceId),
        eq(schema.source.status, "active"),
        eq(schema.integrationConnection.status, "active")
      )
    )
    .limit(1)
    .then((r) => r[0])
  if (!row) return { error: "source not found" }

  const provider = getSourceProvider(row.provider)
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

// Active-connection and tenant-scoped source citation lookup.
export async function resolveSourceCitation(
  workspaceId: string,
  id: string
): Promise<{ url: string | null; title: string } | null> {
  if (!UUID_REGEX.test(id)) return null
  const row = await db
    .select({ url: schema.source.url, title: schema.source.title })
    .from(schema.source)
    .innerJoin(
      schema.integrationConnection,
      eq(schema.source.connectionId, schema.integrationConnection.id)
    )
    .where(
      and(
        eq(schema.source.id, id),
        eq(schema.source.workspaceId, workspaceId),
        eq(schema.source.status, "active"),
        eq(schema.integrationConnection.status, "active")
      )
    )
    .limit(1)
    .then((r) => r[0])
  return row ? { url: row.url, title: row.title } : null
}

export type IngestSourceInput = Omit<
  typeof schema.source.$inferInsert,
  "id" | "summary" | "embedding" | "status" | "createdAt" | "updatedAt"
> & {
  content: string
}

const SUMMARY_FALLBACK_MAX = 1000

async function summarize(
  input: IngestSourceInput,
  onUsage?: OnUsage
): Promise<string> {
  try {
    const result = await generateText({
      model: MERLIN_SMALL_MODEL,
      prompt: `Summarize this ${input.provider} ${input.kind} for a team's institutional memory in 2–4 sentences: what changed or was decided, who did it, and why it matters. Be factual and specific; no preamble.\n\nTitle: ${input.title}\nAuthor: ${input.author ?? "unknown"}\n\n${input.content}`,
      providerOptions: {
        gateway: { models: [MERLIN_SMALL_FALLBACK_MODEL] },
      },
    })
    onUsage?.({
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
  const embedding = await embedTextWithUsage(summary)
    .then((r) => {
      onUsage?.({
        workspaceId: input.workspaceId,
        tool: "source.embed",
        model: r.model,
        inputTokens: r.tokens,
      })
      return r.embedding
    })
    .catch(() => null)

  const { content: _content, ...columns } = input
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
