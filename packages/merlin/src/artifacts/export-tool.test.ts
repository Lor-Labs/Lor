import { beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

vi.mock("./service", () => ({
  writeArtifactVersion: vi.fn(
    async (input: {
      path: string
      contentType: string
      bytes: Uint8Array
    }) => ({
      path: input.path,
      contentType: input.contentType,
      size: input.bytes.byteLength,
      version: 1,
      artifactId: "artifact-1",
      url: `https://cdn.test/artifacts/ws/${input.path}`,
    })
  ),
}))

import {
  createExportToolResultTool,
  detectRows,
  EXPORT_DENIED_TOOLS,
  encodeCsv,
  resolveFilename,
  unwrapToolOutput,
} from "./export-tool"
import { writeArtifactVersion } from "./service"

const context = {
  workspaceId: "ws",
  channelId: "ch",
  task: null,
}

type ExecuteOptions = {
  toolCallId: string
  messages: unknown[]
  context: typeof context
  abortSignal?: AbortSignal
}

function call(
  exportTool: { execute?: unknown },
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const execute = exportTool.execute as (
    input: unknown,
    options: ExecuteOptions
  ) => Promise<Record<string, unknown>>
  return execute(input, { toolCallId: "tc-1", messages: [], context })
}

describe("encodeCsv", () => {
  it("encodes rows with a header and CRLF line endings", () => {
    const { csv, columns } = encodeCsv([
      { a: 1, b: "x" },
      { a: 2, b: "y" },
    ])
    expect(columns).toEqual(["a", "b"])
    expect(csv).toBe("a,b\r\n1,x\r\n2,y\r\n")
  })

  it("quotes commas, quotes, and newlines", () => {
    const { csv } = encodeCsv([{ a: 'say "hi", ok', b: "line1\nline2" }])
    expect(csv).toBe('a,b\r\n"say ""hi"", ok","line1\nline2"\r\n')
  })

  it("neutralizes formula-like string cells before quote escaping", () => {
    const { csv } = encodeCsv([
      { a: "=SUM(1,2)", b: "+cmd", c: "-2", d: "@name", e: -2 },
    ])
    expect(csv).toBe(`a,b,c,d,e\r\n"'=SUM(1,2)",'+cmd,'-2,'@name,-2\r\n`)
  })

  it("unions columns across rows in first-seen order", () => {
    const { csv, columns } = encodeCsv([{ a: 1 }, { b: 2, a: 3 }, { c: 4 }])
    expect(columns).toEqual(["a", "b", "c"])
    expect(csv).toBe("a,b,c\r\n1,,\r\n3,2,\r\n,,4\r\n")
  })

  it("renders null and undefined as empty fields", () => {
    const { csv } = encodeCsv([{ a: null, b: undefined, c: false }])
    expect(csv).toBe("a,b,c\r\n,,false\r\n")
  })

  it("passes unicode through untouched", () => {
    const { csv } = encodeCsv([{ name: "Zoë ✓" }])
    expect(csv).toBe("name\r\nZoë ✓\r\n")
  })
})

describe("detectRows", () => {
  it("accepts a direct array of flat objects", () => {
    expect(detectRows([{ a: 1 }, { a: 2 }])).toHaveLength(2)
  })

  it("finds rows under conventional keys", () => {
    expect(detectRows({ rows: [{ a: 1 }] })).toHaveLength(1)
    expect(detectRows({ results: [{ a: 1 }], meta: "x" })).toHaveLength(1)
  })

  it("finds rows under an object's only array property", () => {
    expect(detectRows({ policies: [{ id: "p1" }], count: 1 })).toHaveLength(1)
  })

  it("rejects arrays with nested object values", () => {
    expect(detectRows([{ a: { nested: true } }])).toBeNull()
  })

  it("rejects mixed and non-object arrays", () => {
    expect(detectRows([{ a: 1 }, "text"])).toBeNull()
    expect(detectRows(["a", "b"])).toBeNull()
  })

  it("rejects empty arrays and scalars", () => {
    expect(detectRows([])).toBeNull()
    expect(detectRows("csv,text")).toBeNull()
  })
})

describe("unwrapToolOutput", () => {
  it("parses JSON strings", () => {
    expect(unwrapToolOutput('{"rows":[{"a":1}]}')).toEqual({
      rows: [{ a: 1 }],
    })
  })

  it("keeps non-JSON strings as-is", () => {
    expect(unwrapToolOutput("plain text")).toBe("plain text")
  })

  it("joins MCP text blocks and parses them", () => {
    expect(
      unwrapToolOutput({ content: [{ type: "text", text: '[{"a":1}]' }] })
    ).toEqual([{ a: 1 }])
  })

  it("prefers structuredContent over content blocks", () => {
    expect(
      unwrapToolOutput({
        structuredContent: { rows: [] },
        content: [{ type: "text", text: "ignored" }],
      })
    ).toEqual({ rows: [] })
  })

  it("passes ordinary objects through", () => {
    expect(unwrapToolOutput({ a: 1 })).toEqual({ a: 1 })
  })
})

describe("resolveFilename", () => {
  it("appends the format extension when missing", () => {
    expect(resolveFilename("report", "csv")).toBe("report.csv")
  })

  it("keeps an existing matching extension", () => {
    expect(resolveFilename("report.CSV", "csv")).toBe("report.CSV")
  })

  it("sanitizes path separators and empty names", () => {
    expect(resolveFilename("../a/b", "json")).toBe("_a_b.json")
    expect(resolveFilename("  ", "csv")).toBe("export.csv")
  })
})

describe("export_tool_result execute", () => {
  beforeEach(() => {
    vi.mocked(writeArtifactVersion).mockClear()
  })

  it("refuses deny-listed tools", async () => {
    expect(EXPORT_DENIED_TOOLS.has("create_artifacts")).toBe(true)
    const exportTool = createExportToolResultTool({
      tools: { create_artifacts: { execute: async () => ({}) } },
      toolsContext: {},
    })
    const result = await call(exportTool, {
      tool: "create_artifacts",
      filename: "x",
    })
    expect(result.error).toMatch(/can't be exported/)
    expect(writeArtifactVersion).not.toHaveBeenCalled()
  })

  it("refuses unknown tools", async () => {
    const exportTool = createExportToolResultTool({
      tools: {},
      toolsContext: {},
    })
    const result = await call(exportTool, { tool: "run_sql", filename: "x" })
    expect(result.error).toMatch(/no exportable tool/)
  })

  it("validates args against the target's input schema", async () => {
    const exportTool = createExportToolResultTool({
      tools: {
        run_sql: {
          inputSchema: z.object({ sql: z.string() }),
          execute: async () => [],
        },
      },
      toolsContext: {},
    })
    const result = await call(exportTool, {
      tool: "run_sql",
      args: { nope: 1 },
      filename: "x",
    })
    expect(result.error).toMatch(/args don't match/)
  })

  it("executes with defaults and transforms from the target schema", async () => {
    const execute = vi.fn(async () => [{ ok: true }])
    const exportTool = createExportToolResultTool({
      tools: {
        search: {
          inputSchema: z.object({
            query: z.string().transform((value) => value.trim()),
            limit: z.number().default(100),
          }),
          execute,
        },
      },
      toolsContext: {},
    })
    await call(exportTool, {
      tool: "search",
      args: { query: "  active  " },
      filename: "x",
    })
    expect(execute).toHaveBeenCalledWith(
      { query: "active", limit: 100 },
      expect.any(Object)
    )
  })

  it("surfaces underlying tool errors without persisting", async () => {
    const exportTool = createExportToolResultTool({
      tools: {
        run_sql: { execute: async () => ({ error: "relation missing" }) },
        mcp_tool: {
          execute: async () => ({
            isError: true,
            content: [{ type: "text", text: "query timeout" }],
          }),
        },
        thrower: {
          execute: async () => {
            throw new Error("boom")
          },
        },
      },
      toolsContext: {},
    })
    const err1 = await call(exportTool, { tool: "run_sql", filename: "x" })
    expect(err1.error).toMatch(/relation missing/)
    const err2 = await call(exportTool, { tool: "mcp_tool", filename: "x" })
    expect(err2.error).toMatch(/query timeout/)
    const err3 = await call(exportTool, { tool: "thrower", filename: "x" })
    expect(err3.error).toMatch(/boom/)
    expect(writeArtifactVersion).not.toHaveBeenCalled()
  })

  it("exports tabular results as CSV with a receipt", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      id: `p${i}`,
      status: "active",
    }))
    const seen: unknown[] = []
    const exportTool = createExportToolResultTool({
      tools: {
        run_sql: {
          execute: async (input: unknown, options: unknown) => {
            seen.push(input, options)
            return { content: [{ type: "text", text: JSON.stringify(rows) }] }
          },
        },
      },
      toolsContext: { run_sql: { projectId: "neon-1" } },
    })
    const result = await call(exportTool, {
      tool: "run_sql",
      args: { sql: "select 1" },
      filename: "policies",
    })
    expect(result.error).toBeUndefined()
    expect(result.url).toMatch(/policies\.csv$/)
    expect(result.format).toBe("csv")
    expect(result.rowCount).toBe(12)
    expect(result.columns).toEqual(["id", "status"])
    expect(result.preview).toHaveLength(5)
    expect(seen[0]).toEqual({ sql: "select 1" })
    expect(seen[1]).toMatchObject({ context: { projectId: "neon-1" } })
    const persisted = vi.mocked(writeArtifactVersion).mock.calls[0]?.[0]
    if (!persisted) throw new Error("writeArtifactVersion was not called")
    expect(persisted.contentType).toBe("text/csv")
    expect(persisted.path).toBe("policies.csv")
    expect(new TextDecoder().decode(persisted.bytes)).toMatch(
      /^id,status\r\np0,active\r\n/
    )
  })

  it("falls back to JSON with a note when csv is requested but the result is not tabular", async () => {
    const exportTool = createExportToolResultTool({
      tools: {
        fetch_thing: { execute: async () => ({ nested: { deep: true } }) },
      },
      toolsContext: {},
    })
    const result = await call(exportTool, {
      tool: "fetch_thing",
      filename: "thing",
      format: "csv",
    })
    expect(result.format).toBe("json")
    expect(result.filename).toBe("thing.json")
    expect(result.note).toMatch(/not tabular/)
    expect(result.rowCount).toBeUndefined()
  })

  it("reports a storage failure as a retryable error", async () => {
    vi.mocked(writeArtifactVersion).mockRejectedValueOnce(new Error("s3 down"))
    const exportTool = createExportToolResultTool({
      tools: { run_sql: { execute: async () => [{ a: 1 }] } },
      toolsContext: {},
    })
    const result = await call(exportTool, { tool: "run_sql", filename: "x" })
    expect(result.error).toMatch(/couldn't be stored/)
  })
})
