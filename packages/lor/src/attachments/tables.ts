import ExcelJS from "exceljs"
import type { Extracted, Piece } from "./extract"

// Spreadsheets and CSVs are indexed as a profile, not as row groups
// (TableRAG, arXiv 2410.04739): per sheet, the schema with example values and
// sample rows, plus the distinct values of each column that repeats. One
// piece per sheet, whatever its length. Small sheets are stored whole.
const SMALL_TABLE_CHARS = 4000
const MAX_TABLE_ROWS = 500_000
const MAX_TRACKED_DISTINCT = 5000
const MAX_LISTED_VALUES = 500
const MAX_CELL_CHARS = 200
const SAMPLE_ROWS = 5
const EXAMPLE_VALUES = 3
const MAX_UNIQUE_VALUE_CHARS = 40
const HEADER_SCAN_ROWS = 10

type Cell = string | number | Date | null

type Column = {
  name: string
  filled: number
  numbers: number
  dates: number
  min: number
  max: number
  chars: number
  counts: Map<string, number> | null
}

const NUMBER = /^[-+]?\$?[\d,]*\.?\d+(e[-+]?\d+)?$/i
const ISO_DATE =
  /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/

// CSV cells arrive as strings; type them the way a spreadsheet would.
function typeCell(raw: string): Cell {
  const s = raw.trim()
  if (!s) return null
  if (NUMBER.test(s)) {
    const n = Number(s.replace(/[$,]/g, ""))
    if (Number.isFinite(n)) return n
  }
  if (ISO_DATE.test(s)) {
    const d = new Date(s.length === 10 ? `${s}T00:00:00Z` : s)
    if (!Number.isNaN(d.getTime())) return d
  }
  const us = US_DATE.exec(s)
  if (us) {
    return new Date(Date.UTC(Number(us[3]), Number(us[1]) - 1, Number(us[2])))
  }
  return s
}

// exceljs returns Excel dates as UTC midnight; format in UTC so the day
// doesn't shift with the server's timezone.
function formatDate(d: Date): string {
  const iso = d.toISOString()
  return iso.endsWith("T00:00:00.000Z")
    ? iso.slice(0, 10)
    : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`
}

function formatCell(cell: Cell): string {
  if (cell === null) return ""
  if (cell instanceof Date) return formatDate(cell)
  if (typeof cell === "number") return String(Number(cell.toPrecision(12)))
  const s = cell.replace(/\s+/g, " ").trim()
  return s.length > MAX_CELL_CHARS ? `${s.slice(0, MAX_CELL_CHARS)}…` : s
}

function newColumn(name: string): Column {
  return {
    name,
    filled: 0,
    numbers: 0,
    dates: 0,
    min: Number.POSITIVE_INFINITY,
    max: Number.NEGATIVE_INFINITY,
    chars: 0,
    counts: new Map(),
  }
}

function createTable(name: string | null) {
  let columns: Column[] | null = null
  let header = ""
  let caption: string[] = []
  let pending: { cells: Cell[]; texts: string[] }[] | null = []
  let rowCount = 0
  let capped = false
  const samples: string[] = []
  let allRows: string[] | null = []
  let allRowsChars = 0

  const addRow = (cells: Cell[], texts: string[]): void => {
    const line = texts.join("\t").trimEnd()
    if (rowCount >= MAX_TABLE_ROWS) {
      capped = true
      return
    }
    rowCount++
    if (samples.length < SAMPLE_ROWS) samples.push(line)
    if (allRows) {
      allRowsChars += line.length + 1
      if (allRowsChars > SMALL_TABLE_CHARS) allRows = null
      else allRows.push(line)
    }
    cells.forEach((cell, i) => {
      if (cell === null || texts[i] === "") return
      let column = columns?.[i]
      if (!column) {
        column = newColumn(`Column ${i + 1}`)
        columns?.push(column)
      }
      column.filled++
      column.chars += texts[i]?.length ?? 0
      const value =
        cell instanceof Date
          ? cell.getTime()
          : typeof cell === "number"
            ? cell
            : null
      if (value !== null) {
        if (cell instanceof Date) column.dates++
        else column.numbers++
        column.min = Math.min(column.min, value)
        column.max = Math.max(column.max, value)
      }
      if (column.counts) {
        const text = texts[i] ?? ""
        column.counts.set(text, (column.counts.get(text) ?? 0) + 1)
        if (column.counts.size > MAX_TRACKED_DISTINCT) column.counts = null
      }
    })
  }

  // Exports often put a title or date line above the real header. The header
  // is the first of the opening rows filled across most columns; rows above
  // it become the caption.
  const resolveHeader = (): void => {
    if (!pending) return
    const rows = pending
    pending = null
    const filled = rows.map((r) => r.texts.filter(Boolean).length)
    const widest = Math.max(0, ...filled)
    const at = Math.max(
      0,
      filled.findIndex((n) => n >= Math.max(2, widest * 0.6))
    )
    const headerRow = rows[at]
    if (!headerRow) return
    caption = rows.slice(0, at).map((r) => r.texts.filter(Boolean).join(" "))
    columns = headerRow.texts.map((t, i) => newColumn(t || `Column ${i + 1}`))
    header = columns.map((c) => c.name).join("\t")
    for (const row of rows.slice(at + 1)) addRow(row.cells, row.texts)
  }

  const add = (cells: Cell[]): void => {
    if (capped) return
    const texts = cells.map(formatCell)
    if (!texts.some(Boolean)) return
    if (pending) {
      pending.push({ cells, texts })
      if (pending.length >= HEADER_SCAN_ROWS) resolveHeader()
      return
    }
    addRow(cells, texts)
  }

  const describe = (c: Column): string => {
    const fill =
      c.filled < rowCount
        ? `, ${Math.round((c.filled / Math.max(rowCount, 1)) * 100)}% filled`
        : ""
    if (c.filled === 0) return `- ${c.name}: empty`
    if (c.dates === c.filled) {
      return `- ${c.name} (date${fill}): ${formatDate(new Date(c.min))} to ${formatDate(new Date(c.max))}`
    }
    if (c.numbers === c.filled) {
      return `- ${c.name} (number${fill}): ${formatCell(c.min)} to ${formatCell(c.max)}`
    }
    if (!c.counts) {
      return `- ${c.name} (text${fill}, over ${MAX_TRACKED_DISTINCT.toLocaleString("en-US")} distinct)`
    }
    const top = [...c.counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, EXAMPLE_VALUES)
      .map(([v]) => v)
    return `- ${c.name} (text${fill}, ${c.counts.size} distinct): ${top.join(", ")}`
  }

  // Values are listed for columns that repeat (vendors, categories). A mostly
  // unique column is listed only when it is short-valued (names, emails) and
  // fits whole; long free text (descriptions) stays in the file.
  const listable = (c: Column): boolean => {
    if (!c.counts || c.dates === c.filled || c.numbers === c.filled)
      return false
    if (c.counts.size <= c.filled / 2) return true
    return (
      c.counts.size <= MAX_LISTED_VALUES &&
      c.chars / c.filled <= MAX_UNIQUE_VALUE_CHARS
    )
  }

  const valueList = (c: Column): string | null => {
    if (!c.counts || !listable(c)) return null
    const values = [...c.counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_LISTED_VALUES)
      .map(([v, n]) => (n > 1 ? `${v} (${n})` : v))
    const shown =
      c.counts.size > MAX_LISTED_VALUES
        ? `top ${MAX_LISTED_VALUES} of ${c.counts.size}`
        : `${c.counts.size}`
    return `${c.name} values (${shown} distinct, by frequency): ${values.join(", ")}`
  }

  // The profile comes first, so the embedding (which reads only the start)
  // covers the summary; the value lists after it still feed keyword search.
  const text = (): string | null => {
    resolveHeader()
    if (!columns) return null
    const cols: Column[] = columns
    const title = `${name ? `Sheet: ${name}` : "Table"}, ${capped ? "over " : ""}${rowCount.toLocaleString("en-US")} rows × ${cols.length} columns`
    if (allRows) return [title, ...caption, header, ...allRows].join("\n")
    const profile = [
      title,
      ...caption,
      "Columns:",
      ...cols.map(describe),
      "Sample rows:",
      header,
      ...samples,
    ].join("\n")
    const values = cols.map(valueList).filter((v): v is string => v !== null)
    return [profile, ...values].join("\n\n")
  }

  return { add, text, capped: () => capped }
}

function excelCell(value: ExcelJS.CellValue): Cell {
  if (value === null || value === undefined) return null
  if (value instanceof Date || typeof value === "number") return value
  if (typeof value === "string") return value
  if (typeof value === "boolean") return String(value)
  if ("result" in value) return excelCell(value.result ?? null)
  if ("richText" in value) return value.richText.map((r) => r.text).join("")
  if ("text" in value) return value.text
  return null
}

// One piece per sheet; position is the sheet's number in the workbook.
export async function extractXlsx(bytes: Uint8Array): Promise<Extracted> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes.slice().buffer)
  const pieces: Piece[] = []
  let truncated = false
  workbook.worksheets.forEach((worksheet, i) => {
    const table = createTable(worksheet.name)
    worksheet.eachRow((row) => {
      const cells: Cell[] = []
      row.eachCell({ includeEmpty: true }, (cell) => {
        cells.push(excelCell(cell.value))
      })
      table.add(cells)
    })
    const text = table.text()
    if (text) pieces.push({ position: i + 1, text })
    truncated ||= table.capped()
  })
  return { pieces, truncated }
}

// RFC 4180 fields: quoted fields may hold the delimiter, newlines, and "".
function parseDelimited(
  text: string,
  delimiter: string,
  onRow: (cells: string[]) => void
): void {
  let field = ""
  let row: string[] = []
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') {
        quoted = false
      } else {
        field += ch
      }
    } else if (ch === '"' && field === "") {
      quoted = true
    } else if (ch === delimiter) {
      row.push(field)
      field = ""
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++
      row.push(field)
      onRow(row)
      row = []
      field = ""
    } else {
      field += ch
    }
  }
  if (field || row.length > 0) {
    row.push(field)
    onRow(row)
  }
}

export function extractCsv(text: string): Extracted {
  const firstLine = text.split("\n", 1)[0] ?? ""
  const delimiter =
    (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0)
      ? "\t"
      : ","
  const table = createTable(null)
  parseDelimited(text, delimiter, (cells) => table.add(cells.map(typeCell)))
  const tableText = table.text()
  return {
    pieces: tableText ? [{ position: 0, text: tableText }] : [],
    truncated: table.capped(),
  }
}
