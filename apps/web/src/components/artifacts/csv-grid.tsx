import { cn } from "@repo/ui/lib/utils"
import { useTheme } from "next-themes"
import { type CSSProperties, useMemo } from "react"
import { type Column, DataGrid } from "react-data-grid"
import type { CsvColumn, GridRow } from "@/lib/csv"
import "react-data-grid/lib/styles.css"

// rdg themes via CSS variables — mapped to our tokens so both modes follow
// the app palette instead of rdg's stock grays.
const GRID_STYLE = {
  height: "100%",
  width: "100%",
  "--rdg-background-color": "var(--color-background)",
  "--rdg-header-background-color": "var(--color-muted)",
  "--rdg-border-color": "var(--color-border)",
  "--rdg-row-hover-background-color": "var(--color-accent)",
} as CSSProperties

// Read-only virtualized spreadsheet. Editing is deliberately absent for now —
// edits go through Merlin or export; the editing layer (editor context,
// undo/redo, version-guarded save) lands here later without touching callers.
export function CsvGrid({
  columns,
  rows,
  className,
}: {
  columns: CsvColumn[]
  rows: GridRow[]
  className?: string
}) {
  const { resolvedTheme } = useTheme()

  const gridColumns: Column<GridRow>[] = useMemo(
    () => [
      {
        // Synthetic row-number column — frozen, never part of the data.
        key: "__rowNumber",
        name: "",
        frozen: true,
        minWidth: 40,
        maxWidth: 55,
        resizable: true,
        renderCell: ({ rowIdx }) => (
          <div className="text-center text-muted-foreground">{rowIdx + 1}</div>
        ),
      },
      ...columns.map((col) => ({
        key: col.key,
        name: col.name,
        resizable: true,
        minWidth: 80,
      })),
    ],
    [columns]
  )

  if (columns.length === 0) {
    return (
      <div
        className={cn(
          "flex h-full items-center justify-center text-muted-foreground text-sm",
          className
        )}
      >
        No data to display
      </div>
    )
  }

  return (
    <div className={cn("h-full w-full overflow-hidden", className)}>
      <DataGrid
        columns={gridColumns}
        rows={rows}
        rowKeyGetter={(row: GridRow) => row.__rowId}
        className={resolvedTheme === "dark" ? "rdg-dark" : "rdg-light"}
        defaultColumnOptions={{ resizable: true }}
        rowHeight={35}
        headerRowHeight={40}
        style={GRID_STYLE}
      />
    </div>
  )
}
