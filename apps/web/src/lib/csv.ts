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

// Character-level parser: handles quoted fields containing the delimiter,
// escaped quotes (""), and newlines inside quotes — the three cases a naive
// split corrupts.
function parseDelimited(csv: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let currentRow: string[] = []
  let currentField = ""
  let inQuotes = false

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i]
    const nextChar = csv[i + 1]

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentField += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        currentField += char
      }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === delimiter) {
      currentRow.push(currentField)
      currentField = ""
    } else if (char === "\n") {
      currentRow.push(currentField)
      rows.push(currentRow)
      currentRow = []
      currentField = ""
    } else {
      currentField += char
    }
  }

  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField)
    rows.push(currentRow)
  }

  return rows
}

// Columns get stable keys (col_N) separate from display names, and every row
// gets a stable __rowId — react-data-grid needs both to avoid remounting rows
// and to survive future header renames without orphaning data.
export function parseCsvData(
  csvString: string,
  delimiter = ","
): { columns: CsvColumn[]; rows: GridRow[] } {
  const normalized = csvString.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const allRows = parseDelimited(normalized.trim(), delimiter)
  if (allRows.length === 0) return { columns: [], rows: [] }

  const headerRow = allRows[0] ?? []
  const dataRows = allRows
    .slice(1)
    .filter((row) => row.some((cell) => cell.trim()))

  const columns: CsvColumn[] = headerRow.map((name, idx) => ({
    key: `col_${idx}`,
    name: name.trim() || `Column ${idx + 1}`,
  }))

  // Iterate the header, not the row: short rows pad, long rows truncate, so
  // every row object carries an identical key set.
  const rows: GridRow[] = dataRows.map((rowData) => {
    const gridRow: GridRow = { __rowId: generateRowId() }
    headerRow.forEach((_, idx) => {
      gridRow[`col_${idx}`] = rowData[idx]?.trim() ?? ""
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

export function csvDelimiterForMime(mime: string): string {
  return mime === "text/tab-separated-values" ? "\t" : ","
}

export function isCsvMime(mime: string): boolean {
  return mime === "text/csv" || mime === "text/tab-separated-values"
}
