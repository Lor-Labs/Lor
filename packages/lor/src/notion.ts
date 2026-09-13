import type { Client, QueryDataSourceParameters } from "@notionhq/client"
import { and, db, eq, schema } from "@repo/db"
import { tool } from "ai"
import { z } from "zod"
import { notionCall } from "./providers/notion"

const SEARCH_DEFAULT = 10
const SEARCH_MAX = 25
const QUERY_DEFAULT = 20
const QUERY_MAX = 50
const COMMENT_MAX = 50
const USER_MAX = 100
const USER_PAGE_CAP = 5
const MARKDOWN_MAX = 40_000

const notionContext = z.object({ externalId: z.string() })
const jsonObject = z.record(z.string(), z.unknown())

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function richText(value: unknown): string {
  if (!Array.isArray(value)) return ""
  return value
    .map((item) => asString(asRecord(item)?.plain_text) ?? "")
    .join("")
    .trim()
}

function notionTitle(value: unknown): string {
  const record = asRecord(value)
  if (!record) return "Untitled"
  const direct = richText(record.title)
  if (direct) return direct
  const properties = asRecord(record.properties)
  if (properties) {
    for (const property of Object.values(properties)) {
      const item = asRecord(property)
      if (item?.type !== "title") continue
      const title = richText(item.title)
      if (title) return title
    }
  }
  return "Untitled"
}

function notionUrl(value: unknown): string | null {
  const record = asRecord(value)
  const direct = asString(record?.url)
  if (direct) return direct
  const id = asString(record?.id)
  return id ? `https://www.notion.so/${id.replaceAll("-", "")}` : null
}

function compact(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    return value.length > 8000 ? `${value.slice(0, 8000)}…` : value
  }
  if (depth >= 7) return "[nested data omitted]"
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => compact(item, depth + 1))
  }
  const record = asRecord(value)
  if (!record) return value
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, compact(item, depth + 1)])
  )
}

export function notionSearchHit(value: unknown) {
  const record = asRecord(value)
  return {
    id: asString(record?.id),
    kind: asString(record?.object),
    title: notionTitle(value),
    url: notionUrl(value),
    lastEditedTime: asString(record?.last_edited_time),
    parent: compact(record?.parent ?? null),
  }
}

function sanitizedUser(value: unknown) {
  const record = asRecord(value)
  return {
    id: asString(record?.id),
    name: asString(record?.name),
    type: asString(record?.type),
    avatarUrl: asString(record?.avatar_url),
  }
}

async function listComments(client: Client, blockId: string) {
  const response = await client.comments.list({
    block_id: blockId,
    page_size: COMMENT_MAX,
  })
  return {
    comments: response.results.map((comment) => ({
      id: comment.id,
      author: comment.display_name.resolved_name,
      createdTime: comment.created_time,
      lastEditedTime: comment.last_edited_time,
      text: richText(comment.rich_text),
      attachments: compact(comment.attachments ?? []),
    })),
    truncated: response.has_more,
  }
}

export async function resolveWorkspaceNotion(
  workspaceId: string
): Promise<{ externalId: string } | null> {
  const connection = await db
    .select({ externalId: schema.integrationConnection.externalId })
    .from(schema.integrationConnection)
    .where(
      and(
        eq(schema.integrationConnection.workspaceId, workspaceId),
        eq(schema.integrationConnection.provider, "notion"),
        eq(schema.integrationConnection.status, "active")
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  return connection ?? null
}

export const notionTools = {
  search_notion: tool({
    description:
      "Search the connected Notion authorization by page or data-source title. Notion's search API does not full-text search page bodies. Use fetch_notion_page on a result to read its content, or query_notion_data_source for database rows.",
    inputSchema: z.object({
      query: z.string().trim().max(200).optional(),
      kind: z.enum(["all", "page", "data_source"]).default("all"),
      limit: z.number().int().min(1).max(SEARCH_MAX).default(SEARCH_DEFAULT),
    }),
    contextSchema: notionContext,
    execute: async ({ query, kind, limit }, { context }) => {
      const response = await notionCall(context.externalId, (client) =>
        client.search({
          ...(query ? { query } : {}),
          ...(kind === "all"
            ? {}
            : {
                filter: {
                  property: "object" as const,
                  value: kind,
                  in_trash: false,
                },
              }),
          sort: query
            ? { property: "relevance" as const }
            : {
                timestamp: "last_edited_time" as const,
                direction: "descending" as const,
              },
          page_size: limit,
        })
      )
      if (!response) return { error: "Notion search failed" }
      return { results: response.results.map(notionSearchHit) }
    },
  }),

  fetch_notion_page: tool({
    description:
      "Read one selected Notion page's properties, full Markdown content, and open page comments. Set includeTranscript only for a known meeting-notes page when its transcript is explicitly needed; this tool does not search private or user-specific meetings.",
    inputSchema: z.object({
      pageId: z.string().min(1).describe("page id returned by Notion search"),
      includeTranscript: z.boolean().default(false),
    }),
    contextSchema: notionContext,
    execute: async ({ pageId, includeTranscript }, { context }) => {
      const [page, markdown, comments] = await Promise.all([
        notionCall(context.externalId, (client) =>
          client.pages.retrieve({ page_id: pageId })
        ),
        notionCall(context.externalId, (client) =>
          client.pages.retrieveMarkdown({
            page_id: pageId,
            include_transcript: includeTranscript,
          })
        ),
        notionCall(context.externalId, (client) =>
          listComments(client, pageId)
        ),
      ])
      if (!(page || markdown)) return { error: "Notion page fetch failed" }
      return {
        id: pageId,
        title: notionTitle(page),
        url: notionUrl(page),
        properties: compact(asRecord(page)?.properties ?? {}),
        markdown: markdown?.markdown
          ? markdown.markdown.slice(0, MARKDOWN_MAX)
          : null,
        markdownTruncated:
          Boolean(markdown?.truncated) ||
          Boolean(markdown && markdown.markdown.length > MARKDOWN_MAX),
        unknownBlockIds: markdown?.unknown_block_ids ?? [],
        comments:
          comments?.comments ??
          ({ error: "Notion comments request failed" } as const),
        commentsTruncated: comments?.truncated ?? false,
      }
    },
  }),

  query_notion_data_source: tool({
    description:
      "Retrieve a Notion data source's schema and query its rows. Use the exact dataSourceId from search_notion. Filters and sorts use Notion's REST data-source query syntax.",
    inputSchema: z.object({
      dataSourceId: z
        .string()
        .min(1)
        .describe("data_source id returned by Notion search"),
      filter: jsonObject.optional(),
      sorts: z.array(jsonObject).max(10).optional(),
      limit: z.number().int().min(1).max(QUERY_MAX).default(QUERY_DEFAULT),
    }),
    contextSchema: notionContext,
    execute: async ({ dataSourceId, filter, sorts, limit }, { context }) => {
      const [dataSource, rows] = await Promise.all([
        notionCall(context.externalId, (client) =>
          client.dataSources.retrieve({ data_source_id: dataSourceId })
        ),
        notionCall(context.externalId, (client) =>
          client.dataSources.query({
            data_source_id: dataSourceId,
            ...(filter
              ? {
                  filter: filter as QueryDataSourceParameters["filter"],
                }
              : {}),
            ...(sorts
              ? { sorts: sorts as QueryDataSourceParameters["sorts"] }
              : {}),
            page_size: limit,
            in_trash: false,
          })
        ),
      ])
      if (!(dataSource || rows)) {
        return { error: "Notion data-source query failed" }
      }
      return {
        dataSource: dataSource
          ? {
              id: dataSource.id,
              title: notionTitle(dataSource),
              url: notionUrl(dataSource),
              properties: compact(dataSource.properties),
            }
          : { error: "Notion data-source schema request failed" },
        results: rows
          ? rows.results.map((row) => ({
              ...notionSearchHit(row),
              properties: compact(asRecord(row)?.properties ?? {}),
            }))
          : { error: "Notion data-source rows request failed" },
        hasMore: rows?.has_more ?? false,
      }
    },
  }),

  list_notion_users: tool({
    description:
      "List or locally filter people and bots in the connected Notion workspace. Returns names and avatars only; email addresses are never requested or returned.",
    inputSchema: z.object({
      query: z.string().trim().max(200).optional(),
      limit: z.number().int().min(1).max(USER_MAX).default(50),
    }),
    contextSchema: notionContext,
    execute: async ({ query, limit }, { context }) => {
      const response = await notionCall(context.externalId, async (client) => {
        const results: Awaited<ReturnType<Client["users"]["list"]>>["results"] =
          []
        let cursor: string | undefined
        let hasMore = true
        for (let page = 0; hasMore && page < USER_PAGE_CAP; page++) {
          const batch = await client.users.list({
            page_size: USER_MAX,
            ...(cursor ? { start_cursor: cursor } : {}),
          })
          results.push(...batch.results)
          hasMore = batch.has_more
          cursor = batch.next_cursor ?? undefined
        }
        return { results, truncated: hasMore }
      })
      if (!response) return { error: "Notion user lookup failed" }
      const normalized = query?.toLocaleLowerCase()
      const users = response.results
        .map(sanitizedUser)
        .filter(
          (user) =>
            !normalized || user.name?.toLocaleLowerCase().includes(normalized)
        )
        .slice(0, limit)
      return { users, truncated: response.truncated }
    },
  }),
}
