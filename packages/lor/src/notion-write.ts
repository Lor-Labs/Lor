import type {
  CreatePageParameters,
  UpdatePageParameters,
} from "@notionhq/client"
import { tool } from "ai"
import { z } from "zod"
import { notionTitle, notionUrl } from "./notion"
import { notionWriteCall } from "./providers/notion"

const contextSchema = z.object({ externalId: z.string() })
const id = z.string().uuid()
const markdown = z.string().min(1).max(20_000)
const text = z
  .object({ text: z.object({ content: z.string().max(2000) }).strict() })
  .strict()
const option = z.object({ id: z.string().min(1).max(128) }).strict()
const person = z.object({ id }).strict()
const property = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("title"), title: z.array(text).max(100) })
    .strict(),
  z
    .object({ type: z.literal("rich_text"), rich_text: z.array(text).max(100) })
    .strict(),
  z
    .object({ type: z.literal("number"), number: z.number().nullable() })
    .strict(),
  z.object({ type: z.literal("checkbox"), checkbox: z.boolean() }).strict(),
  z
    .object({
      type: z.literal("url"),
      url: z.string().url().max(2000).nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("email"),
      email: z.string().email().max(200).nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("phone_number"),
      phone_number: z.string().max(200).nullable(),
    })
    .strict(),
  z.object({ type: z.literal("select"), select: option.nullable() }).strict(),
  z.object({ type: z.literal("status"), status: option.nullable() }).strict(),
  z
    .object({
      type: z.literal("multi_select"),
      multi_select: z.array(option).max(100),
    })
    .strict(),
  z
    .object({ type: z.literal("people"), people: z.array(person).max(100) })
    .strict(),
  z
    .object({ type: z.literal("relation"), relation: z.array(person).max(100) })
    .strict(),
  z
    .object({
      type: z.literal("date"),
      date: z
        .object({
          start: z.string().min(1).max(100),
          end: z.string().max(100).nullable().optional(),
          time_zone: z.string().max(100).nullable().optional(),
        })
        .strict()
        .nullable(),
    })
    .strict(),
])
const properties = z
  .record(z.string().min(1).max(128), property)
  .refine(
    (value) =>
      Object.keys(value).length > 0 &&
      Object.keys(value).length <= 50 &&
      Buffer.byteLength(JSON.stringify(value)) <= 200_000,
    "Provide 1–50 properties, with a total payload no larger than 200 KB"
  )
  .describe(
    "Notion property names or IDs mapped to writable values. Use existing option IDs from query_notion_data_source. Multi-select, people, and relation arrays replace that field’s current values; include every value to retain. Computed fields cannot be written."
  )

function pageResult(
  value: unknown,
  fallbackId?: string,
  fallbackTitle = "Notion page"
) {
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null
  const pageId = typeof record?.id === "string" ? record.id : fallbackId
  return {
    id: pageId,
    title:
      record && "properties" in record ? notionTitle(value) : fallbackTitle,
    url:
      notionUrl(value) ??
      (pageId ? `https://www.notion.so/${pageId.replaceAll("-", "")}` : null),
  }
}

const preview = (value: string) => ({
  content: value.slice(0, 3000),
  contentTruncated: value.length > 3000,
})

export const notionWriteTools = {
  create_notion_page: tool({
    description:
      "Create a Notion page under an authorized page or as a database entry under an authorized data source. For data sources, query its schema first and supply the title property's exact name or ID and valid property values. Creation is one request; do not repeat after an unknown outcome.",
    inputSchema: z
      .object({
        parent: z.discriminatedUnion("type", [
          z.object({ type: z.literal("page"), id }).strict(),
          z
            .object({
              type: z.literal("data_source"),
              id,
              titleProperty: z.string().min(1).max(128),
            })
            .strict(),
        ]),
        title: z.string().min(1).max(2000),
        markdown: markdown.optional(),
        properties: properties.optional(),
      })
      .strict(),
    contextSchema,
    execute: async (input, { context }) => {
      if (
        input.parent.type === "page" &&
        Object.keys(input.properties ?? {}).some((key) => key !== "title")
      )
        return {
          error: "Pages outside a data source only support the title property.",
        }
      const titleProperty =
        input.parent.type === "page" ? "title" : input.parent.titleProperty
      const values: NonNullable<CreatePageParameters["properties"]> = {
        ...input.properties,
        [titleProperty]: { title: [{ text: { content: input.title } }] },
      }
      const result = await notionWriteCall(context.externalId, (client) =>
        client.pages.create({
          parent:
            input.parent.type === "page"
              ? { page_id: input.parent.id }
              : { data_source_id: input.parent.id },
          properties: values,
          ...(input.markdown ? { markdown: input.markdown } : {}),
        })
      )
      if ("error" in result) return result
      return {
        ...pageResult(result.data, undefined, input.title),
        ...preview(input.markdown ?? input.title),
        summary: "Created a Notion page",
      }
    },
  }),

  append_notion_content: tool({
    description:
      "Append Markdown to the end of an authorized Notion page, preserving existing content. Use this for additional sections or notes. Never automatically repeat after an unknown outcome.",
    inputSchema: z.object({ pageId: id, markdown }).strict(),
    contextSchema,
    execute: async (input, { context }) => {
      const result = await notionWriteCall(context.externalId, (client) =>
        client.pages.updateMarkdown({
          page_id: input.pageId,
          type: "insert_content",
          insert_content: {
            content: input.markdown,
            position: { type: "end" },
          },
        })
      )
      if ("error" in result) return result
      return {
        ...pageResult(result.data, input.pageId),
        ...preview(input.markdown),
        summary: "Appended page content",
      }
    },
  }),

  edit_notion_content: tool({
    description:
      "Make targeted search-and-replace edits to a Notion page's Markdown. Read the current page first. Each oldText must match exactly one location; ambiguous or missing text is rejected. Child-page and database deletion is disabled. Never edit truncated or unknown sections or automatically repeat after an unknown outcome.",
    inputSchema: z
      .object({
        pageId: id,
        edits: z
          .array(
            z
              .object({
                oldText: z.string().min(1).max(20_000),
                newText: z.string().max(20_000),
              })
              .strict()
          )
          .min(1)
          .max(20),
      })
      .strict()
      .refine(
        (value) => Buffer.byteLength(JSON.stringify(value)) <= 200_000,
        "Edit payload must be no larger than 200 KB"
      ),
    contextSchema,
    execute: async (input, { context }) => {
      const result = await notionWriteCall(context.externalId, (client) =>
        client.pages.updateMarkdown({
          page_id: input.pageId,
          type: "update_content",
          update_content: {
            content_updates: input.edits.map((edit) => ({
              old_str: edit.oldText,
              new_str: edit.newText,
              replace_all_matches: false,
            })),
            allow_deleting_content: false,
          },
        })
      )
      if ("error" in result) return result
      return {
        ...pageResult(result.data, input.pageId),
        ...preview(
          input.edits
            .map((edit) => `${edit.oldText}\n→\n${edit.newText}`)
            .join("\n\n")
        ),
        summary: `Applied ${input.edits.length} targeted ${input.edits.length === 1 ? "edit" : "edits"}`,
      }
    },
  }),

  update_notion_properties: tool({
    description:
      "Update only the named writable properties of a Notion page or database entry. Read the current values and data-source schema first. Lists of relations, people, or select options replace that field: include all values to retain, and do not replace a list whose current values are truncated or incomplete. Uses existing option IDs; does not change database schema, move, archive, or delete pages.",
    inputSchema: z.object({ pageId: id, properties }).strict(),
    contextSchema,
    execute: async (input, { context }) => {
      const values: NonNullable<UpdatePageParameters["properties"]> =
        input.properties
      const result = await notionWriteCall(context.externalId, (client) =>
        client.pages.update({ page_id: input.pageId, properties: values })
      )
      if ("error" in result) return result
      return {
        ...pageResult(result.data, input.pageId),
        propertyNames: Object.keys(input.properties),
        ...preview(JSON.stringify(input.properties, null, 2)),
        summary: `Updated properties: ${Object.keys(input.properties).join(", ")}`,
      }
    },
  }),

  add_notion_comment: tool({
    description:
      "Add a Markdown comment to an authorized Notion page or reply to an existing discussion. Requires Notion Insert comments permission. Never automatically repeat after an unknown outcome.",
    inputSchema: z
      .object({
        target: z.discriminatedUnion("type", [
          z.object({ type: z.literal("page"), id }).strict(),
          z.object({ type: z.literal("discussion"), id }).strict(),
        ]),
        markdown: z.string().min(1).max(10_000),
      })
      .strict(),
    contextSchema,
    execute: async (input, { context }) => {
      const result = await notionWriteCall(context.externalId, (client) =>
        client.comments.create({
          ...(input.target.type === "page"
            ? { parent: { page_id: input.target.id } }
            : { discussion_id: input.target.id }),
          markdown: input.markdown,
        })
      )
      if ("error" in result) return result
      return {
        id: result.data.id,
        title: "Notion comment",
        url:
          input.target.type === "page"
            ? `https://www.notion.so/${input.target.id.replaceAll("-", "")}`
            : null,
        ...preview(input.markdown),
        summary: "Added a Notion comment",
      }
    },
  }),
}
