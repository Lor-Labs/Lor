import { MERLIN_USER_ID } from "@repo/db/constants"
import { tool } from "ai"
import { z } from "zod"
import { logger } from "../logger"
import { SIDE_EFFECT_TOOLS } from "../tool-guard"
import { writeArtifactVersion } from "./service"

export const EXPORT_TOOL_NAME = "export_tool_result"

// Bulk file output must never trigger actions: side-effecting tools plus the
// run-control tools are excluded. Everything else (searches, fetches, MCP
// reads like run_sql) runs with the authority the run already has.
export const EXPORT_DENIED_TOOLS = new Set([
  ...SIDE_EFFECT_TOOLS,
  "request_approval",
  "update_plan",
  "complete_plan",
  EXPORT_TOOL_NAME,
])

const EXPORT_MAX_FILE_BYTES = 64 * 1024 * 1024
const PREVIEW_ROWS = 5
const PREVIEW_CELL_MAX = 200
const ERROR_TEXT_MAX = 2_000

// Keys under which tools commonly nest their tabular payload.
const ROW_ARRAY_KEYS = ["rows", "data", "results", "records", "items"]

type Primitive = string | number | boolean | null | undefined
export type TabularRow = Record<string, Primitive>

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== null &&
    Object.getPrototypeOf(value).constructor?.name === "Object"
  )
}

function isPrimitive(value: unknown): value is Primitive {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
}

// MCP results wrap the payload in content blocks; plain tools may return JSON
// as a string. Unwrap to the actual data before shape detection.
export function unwrapToolOutput(output: unknown): unknown {
  if (typeof output === "string") return tryParseJson(output)
  if (isPlainObject(output)) {
    if (output.structuredContent !== undefined) return output.structuredContent
    if (Array.isArray(output.content)) {
      const text = output.content
        .filter(
          (b): b is { type: "text"; text: string } =>
            isPlainObject(b) && b.type === "text" && typeof b.text === "string"
        )
        .map((b) => b.text)
        .join("\n")
      if (text) return tryParseJson(text)
    }
  }
  return output
}

function rowsIfTabular(value: unknown): TabularRow[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const rows: TabularRow[] = []
  for (const item of value) {
    if (!isPlainObject(item)) return null
    for (const v of Object.values(item)) {
      if (!isPrimitive(v)) return null
    }
    rows.push(item as TabularRow)
  }
  return rows
}

// Uniform array of flat objects, directly or nested under a conventional key
// (or the object's only array property).
export function detectRows(value: unknown): TabularRow[] | null {
  const direct = rowsIfTabular(value)
  if (direct) return direct
  if (!isPlainObject(value)) return null
  for (const key of ROW_ARRAY_KEYS) {
    const rows = rowsIfTabular(value[key])
    if (rows) return rows
  }
  const arrayProps = Object.values(value).filter((v) => Array.isArray(v))
  if (arrayProps.length === 1) return rowsIfTabular(arrayProps[0])
  return null
}

// RFC 4180: quote fields containing commas, quotes, or newlines; double
// embedded quotes. Columns are the union of keys in first-seen order.
export function encodeCsv(rows: TabularRow[]): {
  csv: string
  columns: string[]
} {
  const columns: string[] = []
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key)
    }
  }
  const field = (value: Primitive): string => {
    if (value === null || value === undefined) return ""
    const raw = String(value)
    const text =
      typeof value === "string" && /^[=+@-]/.test(raw) ? `'${raw}` : raw
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const lines = [
    columns.map((c) => field(c)).join(","),
    ...rows.map((row) => columns.map((c) => field(row[c])).join(",")),
  ]
  return { csv: `${lines.join("\r\n")}\r\n`, columns }
}

export function resolveFilename(
  filename: string,
  format: "csv" | "json"
): string {
  const base =
    filename.trim().replace(/[/\\]/g, "_").replace(/^\.+/, "") || "export"
  return base.toLowerCase().endsWith(`.${format}`) ? base : `${base}.${format}`
}

function previewOf(rows: TabularRow[]): TabularRow[] {
  return rows
    .slice(0, PREVIEW_ROWS)
    .map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([k, v]) => [
          k,
          typeof v === "string" ? clip(v, PREVIEW_CELL_MAX) : v,
        ])
      )
    )
}

function errorText(output: unknown): string | null {
  if (!isPlainObject(output)) return null
  if (output.isError === true) {
    return clip(
      JSON.stringify(unwrapToolOutput(output)) ?? "tool failed",
      ERROR_TEXT_MAX
    )
  }
  if (typeof output.error === "string")
    return clip(output.error, ERROR_TEXT_MAX)
  if ("error" in output) {
    return clip(JSON.stringify(output.error) ?? "tool failed", ERROR_TEXT_MAX)
  }
  return null
}

const exportContext = z.object({
  workspaceId: z.string(),
  channelId: z.string(),
  // Plan runs attach the file to the plan's artifact set. A getter because
  // the plan may start mid-run (start_plan).
  getPlan: z.custom<() => { id: string } | null>(),
})

type AnyToolExecute = (
  input: unknown,
  options: unknown
) => Promise<unknown> | unknown

type InvokableTool = {
  execute?: AnyToolExecute
  inputSchema?: {
    safeParse?: (
      input: unknown
    ) => { success: true; data: unknown } | { success: false; error?: unknown }
  }
}

// Host-side pipe: run a read tool, write its full result to artifact storage,
// and hand the model only a receipt. Bulk data never enters model context —
// the file URL feeds create_artifacts.inputFileUrls or ships as the deliverable.
// The factory closes over the run's live tool map + per-tool context map, so
// it must be created after those are assembled (and added to the same map).
export function createExportToolResultTool(opts: {
  tools: Record<string, unknown>
  toolsContext: Record<string, unknown>
}) {
  return tool({
    description:
      "Run another available tool and save its complete result as a file instead of reading it into the conversation. Use this whenever a tool would return bulk data (many rows, long lists, big JSON) — especially database queries — or when someone wants the data as a file. Returns a receipt with the file url, row/byte counts, and a small preview; the full data is only in the file. Share the url as the deliverable, or pass it to create_artifacts as an input file for further processing. Only read tools can be exported; action tools are refused.",
    inputSchema: z.object({
      tool: z.string().describe("name of the tool to run, e.g. run_sql"),
      args: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("arguments for that tool, exactly as it expects them"),
      filename: z
        .string()
        .describe("output filename, e.g. manual_status_changes.csv"),
      format: z
        .enum(["csv", "json"])
        .optional()
        .describe(
          "csv when the result is tabular (default when rows are detected), json otherwise"
        ),
    }),
    contextSchema: exportContext,
    execute: async (
      { tool: toolName, args, filename, format },
      { toolCallId, context, abortSignal }
    ) => {
      if (EXPORT_DENIED_TOOLS.has(toolName)) {
        return {
          error: `${toolName} performs actions and can't be exported to a file; call it directly`,
        }
      }
      const target = opts.tools[toolName] as InvokableTool | undefined
      if (!target || typeof target.execute !== "function") {
        return { error: `no exportable tool named ${toolName} in this session` }
      }
      const input = args ?? {}
      const parsed = target.inputSchema?.safeParse?.(input)
      if (parsed && !parsed.success) {
        return {
          error: `args don't match what ${toolName} expects: ${clip(String(parsed.error), ERROR_TEXT_MAX)}`,
        }
      }

      const executeInput = parsed?.success ? parsed.data : input
      let output: unknown
      try {
        output = await target.execute(executeInput, {
          toolCallId,
          messages: [],
          abortSignal,
          context: opts.toolsContext[toolName],
        })
      } catch (err) {
        logger.warn({ err, tool: toolName }, "Export: wrapped tool threw")
        return {
          error: `${toolName} failed: ${clip(String(err), ERROR_TEXT_MAX)}`,
        }
      }
      const failure = errorText(output)
      if (failure) return { error: `${toolName} returned an error: ${failure}` }

      const data = unwrapToolOutput(output)
      const rows = detectRows(data)
      const resolvedFormat = format ?? (rows ? "csv" : "json")
      const note =
        resolvedFormat === "csv" && !rows
          ? "result was not tabular; saved as json instead"
          : undefined
      const finalFormat = rows && resolvedFormat === "csv" ? "csv" : "json"

      let body: string
      let columns: string[] | undefined
      if (finalFormat === "csv" && rows) {
        const encoded = encodeCsv(rows)
        body = encoded.csv
        columns = encoded.columns
      } else {
        body = `${JSON.stringify(data, null, 2)}\n`
      }
      const bytes = new TextEncoder().encode(body)
      if (bytes.byteLength > EXPORT_MAX_FILE_BYTES) {
        return {
          error: `result is ${bytes.byteLength} bytes, over the ${EXPORT_MAX_FILE_BYTES} file cap; narrow the request (fewer columns, a WHERE clause, or paging) and export the parts`,
        }
      }

      const path = resolveFilename(filename, finalFormat)
      try {
        const manifest = await writeArtifactVersion({
          workspaceId: context.workspaceId,
          channelId: context.channelId,
          planId: context.getPlan()?.id ?? null,
          path,
          contentType: finalFormat === "csv" ? "text/csv" : "application/json",
          bytes,
          authorType: "agent",
          authorId: MERLIN_USER_ID,
        })
        return {
          url: manifest.url,
          filename: path,
          format: finalFormat,
          bytes: bytes.byteLength,
          version: manifest.version,
          ...(rows ? { rowCount: rows.length, preview: previewOf(rows) } : {}),
          ...(columns ? { columns } : {}),
          ...(note ? { note } : {}),
        }
      } catch (err) {
        logger.error(
          { err, tool: toolName, path },
          "Export: persistence failed"
        )
        return { error: "the file couldn't be stored; try again" }
      }
    },
    strict: true,
  })
}
