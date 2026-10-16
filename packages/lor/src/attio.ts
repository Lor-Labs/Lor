import { and, db, eq, schema } from "@repo/db"
import { tool } from "ai"
import { z } from "zod"
import {
  attioRequest,
  fetchAttioCallRecording,
  formatAttioTranscript,
} from "./providers/attio"
import { rerankItems } from "./rerank"
import type { OnUsage } from "./usage"

const SEARCH_DEFAULT = 10
const SEARCH_MAX = 25
const QUERY_DEFAULT = 20
const QUERY_MAX = 50
const ACTIVITY_LIMIT = 20
const TRANSCRIPT_MEETING_MAX = 5
const TRANSCRIPT_RECORDING_MAX = 2
const TRANSCRIPT_TEXT_MAX = 20_000
const TRANSCRIPT_CONCURRENCY = 3

type Envelope<T = unknown> = {
  data: T
  pagination?: { next_cursor?: string | null }
}

const attioContext = z.object({ externalId: z.string() })
const jsonObject = z.record(z.string(), z.unknown())

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function idField(value: unknown, key: string): string | null {
  const direct = asString(asRecord(value)?.[key])
  if (direct) return direct
  return asString(asRecord(asRecord(value)?.id)?.[key])
}

export function recordTitle(value: unknown): string {
  const record = asRecord(value)
  if (!record) return "Attio record"
  for (const key of ["title", "label", "name", "display_name"]) {
    const candidate = asString(record[key])
    if (candidate) return candidate
  }
  const values = asRecord(record.values)
  if (values) {
    for (const key of ["name", "full_name", "company", "email_addresses"]) {
      const candidates = values[key]
      if (!Array.isArray(candidates)) continue
      for (const candidate of candidates) {
        const item = asRecord(candidate)
        const fullName = [asString(item?.first_name), asString(item?.last_name)]
          .filter(Boolean)
          .join(" ")
        const label =
          fullName ||
          asString(item?.value) ||
          asString(item?.email_address) ||
          asString(item?.domain)
        if (label) return label
      }
    }
  }
  return idField(record, "record_id") ?? "Attio record"
}

function compact(
  value: unknown,
  depth = 0,
  omissions?: { truncated: boolean }
): unknown {
  if (typeof value === "string") {
    if (value.length > 4000 && omissions) omissions.truncated = true
    return value.length > 4000 ? `${value.slice(0, 4000)}…` : value
  }
  if (depth >= 7) {
    if (omissions) omissions.truncated = true
    return "[nested data omitted]"
  }
  if (Array.isArray(value)) {
    if (value.length > 50 && omissions) omissions.truncated = true
    return value.slice(0, 50).map((item) => compact(item, depth + 1, omissions))
  }
  const record = asRecord(value)
  if (!record) return value
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [
      key,
      compact(item, depth + 1, omissions),
    ])
  )
}

function bounded(value: unknown) {
  const omissions = { truncated: false }
  const data = compact(value, 0, omissions)
  return { data, dataTruncated: omissions.truncated }
}

export function attioSearchResult(value: unknown, fallbackObject?: string) {
  const record = asRecord(value)
  const nestedRecord = asRecord(record?.record)
  const source = nestedRecord ?? record
  return {
    title: recordTitle(source),
    object:
      asString(record?.object_slug) ??
      asString(asRecord(record?.object)?.api_slug) ??
      fallbackObject ??
      null,
    recordId: idField(source, "record_id"),
    url: asString(source?.web_url) ?? asString(record?.web_url),
    ...bounded(value),
  }
}

function queryString(values: Record<string, string | number | boolean>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    params.set(key, String(value))
  }
  return params.toString()
}

// Fetch a recording's transcript via the recording GET (`transcript.segments`
// arrives whole; the old paged `…/transcript` endpoint is deprecated).
async function fetchTranscript(
  externalId: string,
  meetingId: string,
  recordingId: string,
  budget: { used: number }
): Promise<{ url: string | null; rawTranscript: string | null } | null> {
  if (budget.used >= TRANSCRIPT_TEXT_MAX) return null
  const recording = await fetchAttioCallRecording(
    externalId,
    meetingId,
    recordingId
  )
  if (!recording) return null
  const available = Math.max(TRANSCRIPT_TEXT_MAX - budget.used, 0)
  const rawTranscript =
    available > 0 && recording.segments?.length
      ? formatAttioTranscript(recording.segments, available)
      : null
  if (rawTranscript) budget.used += rawTranscript.length
  return {
    url: recording.webUrl,
    rawTranscript: rawTranscript || null,
  }
}

export async function resolveWorkspaceAttio(
  workspaceId: string
): Promise<{ externalId: string } | null> {
  const connection = await db
    .select({ externalId: schema.integrationConnection.externalId })
    .from(schema.integrationConnection)
    .where(
      and(
        eq(schema.integrationConnection.workspaceId, workspaceId),
        eq(schema.integrationConnection.provider, "attio"),
        eq(schema.integrationConnection.status, "active")
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  return connection ?? null
}

export const attioTools = {
  search_attio: tool({
    description:
      "Fuzzy-search the connected Attio workspace across people, companies, deals, and custom objects. Matches names, domains, emails, phone numbers, social handles, and record labels. Returns the object and record id needed by fetch_attio_record or fetch_attio_activity.",
    inputSchema: z.object({
      query: z
        .string()
        .max(256)
        .describe("name, company, email, domain, or label"),
      objects: z
        .array(z.string())
        .optional()
        .describe("optional object slugs/ids; omit to search every object"),
      limit: z.number().optional().describe("max results, 1–25 (default 10)"),
    }),
    contextSchema: attioContext.extend({
      workspaceId: z.string().optional(),
      onUsage: z.custom<OnUsage>().optional(),
    }),
    execute: async ({ query, objects, limit }, { context }) => {
      let targets = objects?.filter(Boolean) ?? []
      if (targets.length === 0) {
        const catalog = await attioRequest<Envelope<unknown[]>>(
          context.externalId,
          "/objects"
        )
        targets = asArray(catalog?.data).flatMap((item) => {
          const slug = asString(asRecord(item)?.api_slug)
          return slug ? [slug] : []
        })
      }
      if (targets.length === 0) {
        return { error: "Attio has no readable objects" }
      }
      const n = Math.floor(
        Math.min(Math.max(limit ?? SEARCH_DEFAULT, 1), SEARCH_MAX)
      )
      const response = await attioRequest<Envelope<unknown[]>>(
        context.externalId,
        "/objects/records/search",
        {
          method: "POST",
          body: JSON.stringify({
            query,
            objects: targets,
            request_as: { type: "workspace" },
            limit: Math.min(n * 2, SEARCH_MAX),
          }),
        }
      )
      if (!response) return { error: "Attio search failed" }
      return {
        results: await rerankItems({
          workspaceId: context.workspaceId,
          query,
          items: asArray(response.data).map((item) => attioSearchResult(item)),
          toText: (r) =>
            `${r.object ?? ""}: ${r.title ?? ""}\n${JSON.stringify(r.data).slice(0, 800)}`,
          limit: n,
          onUsage: context.onUsage,
        }),
      }
    },
  }),

  fetch_attio_record: tool({
    description:
      "Fetch one Attio record with all of its current schema-defined values and relationships. Use fetch_attio_activity separately for notes, tasks, comments, meetings, transcripts, files, and pipeline/list memberships.",
    inputSchema: z.object({
      object: z.string().describe("object slug or id from search_attio"),
      recordId: z.string().uuid().describe("record id from search_attio"),
    }),
    contextSchema: attioContext,
    execute: async ({ object, recordId }, { context }) => {
      const response = await attioRequest<Envelope>(
        context.externalId,
        `/objects/${encodeURIComponent(object)}/records/${encodeURIComponent(recordId)}`
      )
      if (!response) return { error: "Attio record fetch failed" }
      const data = asRecord(response.data)
      return {
        title: recordTitle(data),
        object,
        recordId,
        url: asString(data?.web_url),
        record: compact(data),
      }
    },
  }),

  query_attio: tool({
    description:
      "Inspect Attio or run a structured query. catalog lists objects, lists/pipelines, and workspace members. schema lists attributes (or reads one using attribute), with writable types and cardinality. select_options/statuses list an attribute's valid choices. For schema/options, set targetType=objects or lists. records queries an object; list_entries queries a list; task reads one task using its ID as target, including tasks not linked to records. Filters and sorts use Attio's REST syntax. dataTruncated marks omitted data; never copy an incomplete field into an overwrite.",
    inputSchema: z.object({
      mode: z.enum([
        "catalog",
        "schema",
        "select_options",
        "statuses",
        "records",
        "list_entries",
        "task",
      ]),
      target: z
        .string()
        .optional()
        .describe("object/list slug or ID, or a task ID for mode=task"),
      targetType: z.enum(["objects", "lists"]).optional(),
      attribute: z.string().trim().min(1).max(128).optional(),
      filter: jsonObject.optional().describe("Attio filter object"),
      sorts: z
        .array(jsonObject)
        .optional()
        .describe("Attio sort objects, e.g. direction + attribute + field"),
      limit: z.number().optional().describe("max results, 1–50 (default 20)"),
      offset: z.number().optional().describe("results to skip (default 0)"),
    }),
    contextSchema: attioContext,
    execute: async (
      {
        mode,
        target,
        targetType = "objects",
        attribute,
        filter,
        sorts,
        limit,
        offset,
      },
      { context }
    ) => {
      if (mode === "catalog") {
        const [objects, lists, members] = await Promise.all([
          attioRequest<Envelope<unknown[]>>(context.externalId, "/objects"),
          attioRequest<Envelope<unknown[]>>(context.externalId, "/lists"),
          attioRequest<Envelope<unknown[]>>(
            context.externalId,
            "/workspace_members"
          ),
        ])
        if (!(objects || lists || members)) {
          return { error: "Attio catalog fetch failed" }
        }
        return {
          objects: objects
            ? compact(asArray(objects.data))
            : { error: "Attio objects request failed" },
          lists: lists
            ? compact(asArray(lists.data))
            : { error: "Attio lists request failed" },
          workspaceMembers: members
            ? compact(asArray(members.data))
            : { error: "Attio workspace members request failed" },
        }
      }
      if (!target) return { error: `target is required for ${mode}` }
      if (mode === "task") {
        const response = await attioRequest<Envelope>(
          context.externalId,
          `/tasks/${encodeURIComponent(target)}`
        )
        if (!response) return { error: "Attio task request failed" }
        const result = bounded(response.data)
        return {
          mode,
          target,
          results: [result.data],
          dataTruncated: result.dataTruncated,
        }
      }
      const n = Math.floor(
        Math.min(Math.max(limit ?? QUERY_DEFAULT, 1), QUERY_MAX)
      )
      if (["schema", "select_options", "statuses"].includes(mode)) {
        if (mode !== "schema" && !attribute)
          return { error: `attribute is required for ${mode}` }
        const base = `/${targetType}/${encodeURIComponent(target)}/attributes`
        const attributePath = attribute
          ? `/${encodeURIComponent(attribute)}`
          : ""
        const path =
          mode === "schema"
            ? `${base}${attributePath}${attribute ? "" : `?${queryString({ limit: n, offset: Math.max(Math.floor(offset ?? 0), 0) })}`}`
            : `${base}${attributePath}/${mode === "statuses" ? "statuses" : "options"}`
        const response = await attioRequest<Envelope>(context.externalId, path)
        if (!response) return { error: "Attio schema request failed" }
        const items = Array.isArray(response.data) ? response.data : null
        const start = Math.max(Math.floor(offset ?? 0), 0)
        const page = mode === "schema" ? items : items?.slice(start, start + n)
        const hasMore =
          mode === "schema"
            ? !attribute && items?.length === n
            : (items?.length ?? 0) > start + n
        const result = bounded(page ?? [response.data])
        return {
          mode,
          target,
          targetType,
          results: result.data,
          dataTruncated: result.dataTruncated,
          truncated: hasMore,
          ...(hasMore ? { nextOffset: start + n } : {}),
        }
      }
      const path =
        mode === "records"
          ? `/objects/${encodeURIComponent(target)}/records/query`
          : `/lists/${encodeURIComponent(target)}/entries/query`
      const response = await attioRequest<Envelope<unknown[]>>(
        context.externalId,
        path,
        {
          method: "POST",
          body: JSON.stringify({
            ...(filter ? { filter } : {}),
            ...(sorts ? { sorts } : {}),
            limit: n,
            offset: Math.max(Math.floor(offset ?? 0), 0),
          }),
        }
      )
      if (!response) return { error: "Attio query failed" }
      const result = bounded(asArray(response.data))
      return {
        mode,
        target,
        results:
          mode === "records"
            ? asArray(response.data).map((item) =>
                attioSearchResult(item, target)
              )
            : result.data,
        dataTruncated: result.dataTruncated,
      }
    },
  }),

  fetch_attio_activity: tool({
    description:
      "Fetch a record's surrounding Attio activity: pipeline/list memberships, notes, tasks, comment threads, meetings, and files. incompleteSections marks failed or potentially partial sections; dataTruncated marks omitted field data. Do not infer absence or overwrite lists from incomplete results. Set includeTranscripts=true when call transcript text is needed; it fetches recordings for up to five returned meetings.",
    inputSchema: z.object({
      object: z.string().describe("object slug or id"),
      recordId: z.string().uuid().describe("record id"),
      includeTranscripts: z
        .boolean()
        .optional()
        .describe("include call transcript text (default false)"),
    }),
    contextSchema: attioContext,
    execute: async ({ object, recordId, includeTranscripts }, { context }) => {
      const encodedObject = encodeURIComponent(object)
      const encodedRecord = encodeURIComponent(recordId)
      const common = queryString({
        limit: ACTIVITY_LIMIT,
        linked_object: object,
        linked_record_id: recordId,
      })
      const [entries, notes, tasks, threads, meetings, files] =
        await Promise.all([
          attioRequest<Envelope<unknown[]>>(
            context.externalId,
            `/objects/${encodedObject}/records/${encodedRecord}/entries?${queryString({ limit: ACTIVITY_LIMIT })}`
          ),
          attioRequest<Envelope<unknown[]>>(
            context.externalId,
            `/notes?${queryString({ limit: ACTIVITY_LIMIT, parent_object: object, parent_record_id: recordId })}`
          ),
          attioRequest<Envelope<unknown[]>>(
            context.externalId,
            `/tasks?${common}&sort=created_at:desc`
          ),
          attioRequest<Envelope<unknown[]>>(
            context.externalId,
            `/threads?${queryString({ limit: ACTIVITY_LIMIT, object, record_id: recordId })}`
          ),
          attioRequest<Envelope<unknown[]>>(
            context.externalId,
            `/meetings?${common}&sort=start_desc`
          ),
          attioRequest<Envelope<unknown[]>>(
            context.externalId,
            `/files?${queryString({ limit: ACTIVITY_LIMIT, object, record_id: recordId })}`
          ),
        ])

      const meetingData = asArray(meetings?.data)
      const transcripts: unknown[] = []
      if (includeTranscripts) {
        const meetingIds = meetingData
          .slice(0, TRANSCRIPT_MEETING_MAX)
          .flatMap((meeting) => {
            const meetingId = idField(meeting, "meeting_id")
            return meetingId ? [meetingId] : []
          })
        const recordingResponses = await Promise.all(
          meetingIds.map(async (meetingId) => ({
            meetingId,
            response: await attioRequest<Envelope<unknown[]>>(
              context.externalId,
              `/meetings/${encodeURIComponent(meetingId)}/call_recordings`
            ),
          }))
        )
        const recordings = recordingResponses.flatMap(
          ({ meetingId, response }) =>
            asArray(response?.data)
              .slice(0, TRANSCRIPT_RECORDING_MAX)
              .flatMap((recording) => {
                const recordingId = idField(recording, "call_recording_id")
                return recordingId
                  ? [{ meetingId, recordingId, recording }]
                  : []
              })
        )
        const budget = { used: 0 }
        let nextRecording = 0
        const results: Array<unknown | null> = Array.from(
          { length: recordings.length },
          () => null
        )
        const worker = async () => {
          while (budget.used < TRANSCRIPT_TEXT_MAX) {
            const index = nextRecording++
            const recording = recordings[index]
            if (!recording) return
            const transcript = await fetchTranscript(
              context.externalId,
              recording.meetingId,
              recording.recordingId,
              budget
            )
            if (!transcript) continue
            results[index] = {
              meetingId: recording.meetingId,
              callRecordingId: recording.recordingId,
              url:
                transcript.url ??
                asString(asRecord(recording.recording)?.web_url),
              rawTranscript: transcript.rawTranscript,
            }
          }
        }
        await Promise.all(
          Array.from(
            {
              length: Math.min(TRANSCRIPT_CONCURRENCY, recordings.length),
            },
            worker
          )
        )
        transcripts.push(...results.filter((result) => result !== null))
      }

      const omissions = { truncated: false }
      const incompleteSections = Object.entries({
        listEntries: entries,
        notes,
        tasks,
        commentThreads: threads,
        meetings,
        files,
      })
        .filter(
          ([, response]) =>
            !response ||
            response.pagination?.next_cursor ||
            asArray(response.data).length >= ACTIVITY_LIMIT
        )
        .map(([name]) => name)
      return {
        object,
        recordId,
        listEntries: compact(entries?.data ?? [], 0, omissions),
        notes: compact(notes?.data ?? [], 0, omissions),
        tasks: compact(tasks?.data ?? [], 0, omissions),
        commentThreads: compact(threads?.data ?? [], 0, omissions),
        meetings: compact(meetingData, 0, omissions),
        files: compact(files?.data ?? [], 0, omissions),
        transcripts: compact(transcripts, 0, omissions),
        dataTruncated: omissions.truncated,
        incompleteSections,
      }
    },
  }),
}
