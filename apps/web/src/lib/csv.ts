import { parseCsv } from "@repo/utils/file-preview"

export interface GridRow {
  __rowId: string
  [key: string]: string | number | null
}

export interface CsvColumn {
  key: string
  name: string
}

let rowIdCounter = 0
export const generateRowId = () =>
  `row_${Date.now().toString(36)}_${(rowIdCounter++).toString(36)}`

// Columns get stable keys (col_N) separate from display names, and every row
// gets a stable __rowId — react-data-grid needs both to avoid remounting rows
// and to survive future header renames without orphaning data.
export function parseCsvData(
  csvString: string,
  delimiter = ","
): { columns: CsvColumn[]; rows: GridRow[] } {
  const parsed = parseCsv(csvString, delimiter)
  const columns: CsvColumn[] = parsed.columns.map((name, idx) => ({
    key: `col_${idx}`,
    name,
  }))
  const rows: GridRow[] = parsed.rows.map((cells) => {
    const gridRow: GridRow = { __rowId: generateRowId() }
    cells.forEach((cell, idx) => {
      gridRow[`col_${idx}`] = cell
    })
    return gridRow
  })
  return { columns, rows }
}

export function serializeToCsv(
  rows: GridRow[],
  columns: CsvColumn[],
  delimiter = ","
): string {
  const escapeField = (value: string | number | null | undefined): string => {
    const str = String(value ?? "")
    if (str.includes(delimiter) || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }

  // Driven by columns, not Object.keys(row): keeps __rowId out of the output
  // and guarantees column order matches the header.
  const header = columns.map((col) => escapeField(col.name)).join(delimiter)
  const body = rows.map((row) =>
    columns.map((col) => escapeField(row[col.key])).join(delimiter)
  )

  return [header, ...body].join("\n")
}
