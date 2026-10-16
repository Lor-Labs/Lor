import { tool } from "ai"
import { z } from "zod"
import { recordTitle } from "./attio"
import { attioWriteRequest } from "./providers/attio"

const contextSchema = z.object({ externalId: z.string() })
const id = z.string().uuid()
const identifier = z.string().trim().min(1).max(128)
const scalar = z.union([
  z.string().max(20_000),
  z.number(),
  z.boolean(),
  z.null(),
])
// Flat attribute objects support names, locations and explicit record IDs;
// nested record-creation instructions are deliberately not accepted.
const attributeObject = z
  .record(identifier, scalar)
  .refine((value) => Object.keys(value).length <= 20)
const attributeValue = z.union([
  scalar,
  attributeObject,
  z.array(z.union([scalar, attributeObject])).max(100),
])
const values = z
  .record(identifier, attributeValue)
  .refine(
    (value) =>
      Object.keys(value).length > 0 &&
      Object.keys(value).length <= 50 &&
      Buffer.byteLength(JSON.stringify(value)) <= 200_000,
    "Provide 1–50 attributes, with a total payload no larger than 200 KB"
  )
  .describe(
    'Attribute slugs or IDs mapped to Attio write values. Discover writable fields using query_attio mode=schema. Values may be scalars, flat objects, or arrays. Examples: name: "Acme", stage: [{status: "Lead"}], company: [{target_object: "companies", target_record_id: "uuid"}]. Reference existing records by ID; nested creation is unsupported.'
  )
const multiselectMode = z
  .enum(["append", "overwrite"])
  .default("append")
  .describe(
    "append preserves existing multiselect values. overwrite replaces each supplied field's values, allowing removal; include all values to retain and never overwrite from an incomplete read. Omitted attributes are unchanged in either mode."
  )
const linkedRecord = z.object({ object: identifier, recordId: id }).strict()
const taskFields = z
  .object({
    deadlineAt: z.iso.datetime({ offset: true }).nullable().optional(),
    completed: z.boolean().optional(),
    linkedRecords: z.array(linkedRecord).max(100).optional(),
    assigneeIds: z.array(id).max(100).optional(),
  })
  .strict()

function taskData(input: z.infer<typeof taskFields>) {
  return {
    ...(input.deadlineAt !== undefined
      ? { deadline_at: input.deadlineAt }
      : {}),
    ...(input.completed !== undefined ? { is_completed: input.completed } : {}),
    ...(input.linkedRecords !== undefined
      ? {
          linked_records: input.linkedRecords.map((record) => ({
            target_object: record.object,
            target_record_id: record.recordId,
          })),
        }
      : {}),
    ...(input.assigneeIds !== undefined
      ? {
          assignees: input.assigneeIds.map((memberId) => ({
            referenced_actor_type: "workspace-member",
            referenced_actor_id: memberId,
          })),
        }
      : {}),
  }
}

type Envelope = { data: unknown }

function receipt(value: unknown, summary: string, content: string) {
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null
  const ids =
    record?.id && typeof record.id === "object"
      ? (record.id as Record<string, unknown>)
      : null
  return {
    id: ids?.record_id ?? ids?.entry_id ?? ids?.note_id ?? ids?.task_id,
    title:
      typeof record?.title === "string"
        ? record.title
        : typeof record?.content_plaintext === "string"
          ? record.content_plaintext
          : record?.values
            ? recordTitle(record)
            : summary,
    url: typeof record?.web_url === "string" ? record.web_url : null,
    summary,
    content: content.slice(0, 3000),
    contentTruncated: content.length > 3000,
  }
}

export const attioWriteTools = {
  create_attio_record: tool({
    description:
      "Create a person, company, deal, or custom Attio record. Search for existing records first and inspect its object's writable attributes using query_attio mode=schema. Supply schema-valid values. This creates a new record, never upserts or updates an existing one. Never automatically repeat after an unknown outcome.",
    inputSchema: z.object({ object: identifier, values }).strict(),
    contextSchema,
    execute: async (input, { context }) => {
      const result = await attioWriteRequest<Envelope>(
        context.externalId,
        `/objects/${encodeURIComponent(input.object)}/records`,
        "POST",
        { values: input.values },
        "record_permission:read-write"
      )
      if ("error" in result) return result
      return receipt(
        result.data.data,
        `Created an Attio ${input.object} record`,
        JSON.stringify(input.values, null, 2)
      )
    },
  }),

  update_attio_record: tool({
    description:
      "Update only supplied attributes of an existing Attio record. Read its current values and object schema first. Multiselects append by default; explicitly choose overwrite to remove or replace values, including all values to retain. Cannot delete, merge, create records, or change object schema. Never automatically repeat after an unknown outcome.",
    inputSchema: z
      .object({ object: identifier, recordId: id, values, multiselectMode })
      .strict(),
    contextSchema,
    execute: async (input, { context }) => {
      const result = await attioWriteRequest<Envelope>(
        context.externalId,
        `/objects/${encodeURIComponent(input.object)}/records/${input.recordId}`,
        input.multiselectMode === "overwrite" ? "PUT" : "PATCH",
        { values: input.values },
        "record_permission:read-write"
      )
      if ("error" in result) return result
      return receipt(
        result.data.data,
        `Updated Attio fields: ${Object.keys(input.values).join(", ")}`,
        JSON.stringify(input.values, null, 2)
      )
    },
  }),

  create_attio_list_entry: tool({
    description:
      "Add an existing Attio record to a list or pipeline. Check its current memberships to avoid duplicates: Attio allows multiple entries for the same record. Inspect the list's schema first. No record or list is created. Never automatically repeat after an unknown outcome.",
    inputSchema: z
      .object({
        list: identifier,
        object: identifier,
        recordId: id,
        values: values.optional(),
      })
      .strict(),
    contextSchema,
    execute: async (input, { context }) => {
      const result = await attioWriteRequest<Envelope>(
        context.externalId,
        `/lists/${encodeURIComponent(input.list)}/entries`,
        "POST",
        {
          parent_object: input.object,
          parent_record_id: input.recordId,
          entry_values: input.values ?? {},
        },
        "list_entry:read-write"
      )
      if ("error" in result) return result
      return receipt(
        result.data.data,
        `Added a record to Attio list ${input.list}`,
        JSON.stringify(input.values ?? {}, null, 2)
      )
    },
  }),

  update_attio_list_entry: tool({
    description:
      "Update supplied fields on an existing Attio list entry, including its pipeline stage. Read the entry and list schema first. Multiselects append by default; overwrite replaces supplied fields' lists, so retain all intended values. Cannot move or delete entries, or change list schema. Never automatically repeat after an unknown outcome.",
    inputSchema: z
      .object({ list: identifier, entryId: id, values, multiselectMode })
      .strict(),
    contextSchema,
    execute: async (input, { context }) => {
      const result = await attioWriteRequest<Envelope>(
        context.externalId,
        `/lists/${encodeURIComponent(input.list)}/entries/${input.entryId}`,
        input.multiselectMode === "overwrite" ? "PUT" : "PATCH",
        { entry_values: input.values },
        "list_entry:read-write"
      )
      if ("error" in result) return result
      return receipt(
        result.data.data,
        `Updated Attio list fields: ${Object.keys(input.values).join(", ")}`,
        JSON.stringify(input.values, null, 2)
      )
    },
  }),

  create_attio_note: tool({
    description:
      "Add a Markdown note to an existing Attio record. Cannot edit or delete existing notes. Never automatically repeat after an unknown outcome.",
    inputSchema: z
      .object({
        object: identifier,
        recordId: id,
        title: z.string().trim().min(1).max(1000),
        markdown: z.string().min(1).max(20_000),
      })
      .strict(),
    contextSchema,
    execute: async (input, { context }) => {
      const result = await attioWriteRequest<Envelope>(
        context.externalId,
        "/notes",
        "POST",
        {
          parent_object: input.object,
          parent_record_id: input.recordId,
          title: input.title,
          format: "markdown",
          content: input.markdown,
        },
        "note:read-write"
      )
      if ("error" in result) return result
      return receipt(result.data.data, "Added an Attio note", input.markdown)
    },
  }),

  create_attio_task: tool({
    description:
      "Create a plaintext Attio task, optionally linking existing records by ID, assigning workspace members, and setting a deadline. Find member IDs using query_attio mode=catalog. Never automatically repeat after an unknown outcome.",
    inputSchema: taskFields
      .omit({ completed: true })
      .extend({ content: z.string().trim().min(1).max(2000) })
      .strict(),
    contextSchema,
    execute: async (input, { context }) => {
      const result = await attioWriteRequest<Envelope>(
        context.externalId,
        "/tasks",
        "POST",
        {
          content: input.content,
          format: "plaintext",
          ...taskData({
            deadlineAt: input.deadlineAt ?? null,
            completed: false,
            linkedRecords: input.linkedRecords ?? [],
            assigneeIds: input.assigneeIds ?? [],
          }),
        },
        "task:read-write"
      )
      if ("error" in result) return result
      return receipt(result.data.data, "Created an Attio task", input.content)
    },
  }),

  update_attio_task: tool({
    description:
      "Update an existing Attio task: complete/reopen it or change its deadline, linked records, or assignees. Read the current task using query_attio mode=task first. Supplied lists replace existing lists: include all values to retain, never overwrite from an incomplete read. Omitted fields stay unchanged; a null deadline clears it. Task text cannot be edited through Attio's API. Never automatically repeat after an unknown outcome.",
    inputSchema: z
      .object({
        taskId: id,
        changes: taskFields.refine(
          (value) => Object.values(value).some((item) => item !== undefined),
          "Provide at least one task field to update"
        ),
      })
      .strict(),
    contextSchema,
    execute: async (input, { context }) => {
      const result = await attioWriteRequest<Envelope>(
        context.externalId,
        `/tasks/${input.taskId}`,
        "PATCH",
        taskData(input.changes),
        "task:read-write"
      )
      if ("error" in result) return result
      return receipt(
        result.data.data,
        "Updated an Attio task",
        JSON.stringify(input.changes, null, 2)
      )
    },
  }),
}
