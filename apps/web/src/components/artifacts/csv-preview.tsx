import { ArrowExpand01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { cn } from "@repo/ui/lib/utils"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { motion } from "framer-motion"
import { useMemo } from "react"
import { ArtifactFileCard } from "@/components/chat/artifact-file-card"
import { useArtifactContent } from "@/hooks/use-artifact"
import { getFileKind } from "@/lib/attachments"
import { csvDelimiterForMime } from "@/lib/csv"

const PREVIEW_MAX_ROWS = 8

// Cheap line-based parse for the card: touches maxRows+1 lines only, so a
// multi-megabyte file never scans on the message render path. The full
// parser runs once, in the viewer, when it opens.
function parsePreviewLines(
  data: string,
  delimiter: string,
  maxRows: number
): { headers: string[]; rows: string[][]; totalRows: number } {
  const lines = data.trim().split("\n")
  const first = lines[0]
  if (!first) return { headers: [], rows: [], totalRows: 0 }

  const parseLine = (line: string): string[] => {
    const result: string[] = []
    let current = ""
    let inQuotes = false
    for (const char of line) {
      if (char === '"') inQuotes = !inQuotes
      else if (char === delimiter && !inQuotes) {
        result.push(current.trim())
        current = ""
      } else current += char
    }
    result.push(current.trim())
    return result
  }

  return {
    headers: parseLine(first),
    rows: lines.slice(1, maxRows + 1).map(parseLine),
    totalRows: lines.length - 1,
  }
}

// Compact CSV card: a real (static) table with the same shape as the grid it
// morphs into — header bar over a bordered table with a narrow leading index
// column, so the shared-layout morph reads as one gesture.
export function CsvPreview({
  data,
  title,
  delimiter,
  onExpand,
  layoutId,
  className,
}: {
  data: string
  title: string
  delimiter: string
  onExpand: () => void
  layoutId?: string
  className?: string
}) {
  const { headers, rows, totalRows } = useMemo(
    () => parsePreviewLines(data, delimiter, PREVIEW_MAX_ROWS),
    [data, delimiter]
  )
  const kind = getFileKind("text/csv", title)

  if (headers.length === 0) return null

  return (
    <motion.div
      layoutId={layoutId}
      onClick={onExpand}
      className={cn(
        "w-fit min-w-full cursor-pointer overflow-hidden rounded-lg border bg-card transition-colors hover:bg-accent/20",
        className
      )}
    >
      <div className="flex h-9 items-center justify-between px-3">
        <div className="flex min-w-0 items-center gap-2 font-medium text-sm">
          <kind.Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{title}</span>
          {totalRows > rows.length && (
            <span className="shrink-0 font-normal text-muted-foreground text-xs">
              {rows.length.toLocaleString()} of {totalRows.toLocaleString()}{" "}
              rows
            </span>
          )}
        </div>
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground">
          <HugeiconsIcon
            icon={ArrowExpand01Icon}
            className="size-3.5"
            strokeWidth={2}
          />
        </span>
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-t">
            {/* Mirrors the grid's frozen row-number column so the shapes
                line up when the morph lands. */}
            <th className="w-10 border-r bg-muted/50 px-3 py-1.5" />
            {headers.map((header, idx) => (
              <th
                key={`${idx}-${header}`}
                title={header}
                className="max-w-[150px] min-w-[100px] truncate border-r bg-muted/50 px-3 py-1.5 text-left font-semibold last:border-r-0"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIdx) => (
            <tr key={row.join("\u0000")} className="border-t">
              <td className="border-r bg-muted/30 px-3 py-1.5 text-center text-muted-foreground">
                {rowIdx + 1}
              </td>
              {headers.map((_, colIdx) => (
                <td
                  key={`${colIdx}-${row[colIdx] ?? ""}`}
                  title={row[colIdx] || ""}
                  className="max-w-[150px] truncate border-r px-3 py-1.5 last:border-r-0"
                >
                  {row[colIdx] || ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </motion.div>
  )
}

// Deliverable presentation for CSV artifacts in Lor messages: fetches the
// content and renders the preview card (falling back to the plain file card
// while loading or when the file is too big to inline). Expanding navigates
// to ?artifactId= — the viewer morphs out of this card via the shared
// layoutId, which is suppressed while open so the pair never double-mounts.
export function ArtifactCsvPreviewCard({
  artifactId,
  name,
  contentType,
  size,
  url,
}: {
  artifactId: string
  name: string
  contentType: string
  size: number | null
  url: string
}) {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { artifactId?: string }
  const isOpen = search.artifactId === artifactId
  const content = useArtifactContent({ url, mime: contentType, size })

  if (content.data === undefined) {
    return (
      <ArtifactFileCard
        artifactId={artifactId}
        name={name}
        contentType={contentType}
        size={size}
      />
    )
  }

  return (
    <div className="min-w-0 overflow-x-auto">
      <CsvPreview
        data={content.data}
        title={name}
        delimiter={csvDelimiterForMime(contentType)}
        layoutId={isOpen ? undefined : `artifact:${artifactId}`}
        onExpand={() => {
          void navigate({
            to: ".",
            search: (prev) => ({ ...prev, artifactId }),
          })
        }}
      />
    </div>
  )
}
