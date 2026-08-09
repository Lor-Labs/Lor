import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/table"
import { useMemo } from "react"

const MAX_ROWS = 500

// Minimal RFC-4180-ish parser: quoted fields, escaped quotes, CRLF.
function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
    } else if (ch === delimiter) {
      row.push(field)
      field = ""
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++
      row.push(field)
      field = ""
      rows.push(row)
      row = []
    } else {
      field += ch
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.length > 1 || (r[0] ?? "").trim() !== "")
}

// Parsed data grid, not a markdown-table conversion: the future editable CSV
// binds the same rows/columns shape to a shared structure.
export function CsvTable({
  content,
  delimiter = ",",
}: {
  content: string
  delimiter?: string
}) {
  const rows = useMemo(() => parseCsv(content, delimiter), [content, delimiter])
  const header = rows[0] ?? []
  const body = rows.slice(1, 1 + MAX_ROWS)
  const truncated = rows.length - 1 > MAX_ROWS

  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">Empty file</p>
  }

  return (
    <div className="overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {header.map((cell, i) => (
              <TableHead key={`${i}-${cell}`}>{cell}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {body.map((r, ri) => (
            <TableRow key={`${ri}-${r[0] ?? ""}`}>
              {header.map((_, ci) => (
                <TableCell key={`${ri}-${ci}-${r[ci] ?? ""}`}>
                  {r[ci] ?? ""}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {truncated && (
        <p className="p-2 text-muted-foreground text-xs">
          Showing the first {MAX_ROWS} rows — download the file for the rest.
        </p>
      )}
    </div>
  )
}
