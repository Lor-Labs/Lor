import { useMemo } from "react"
import { FlatList, ScrollView, Text, View } from "react-native"

const ROW_HEIGHT = 32
const CHAR_WIDTH = 7.5
const CELL_PADDING = 20
const MIN_COLUMN = 72
const MAX_COLUMN = 240
// Widths come from the header and the first rows, so a long file doesn't
// measure every cell before it shows.
const SAMPLE_ROWS = 100

function columnWidths(columns: string[], rows: string[][]) {
  return columns.map((name, idx) => {
    let longest = name.length
    for (const row of rows.slice(0, SAMPLE_ROWS)) {
      longest = Math.max(longest, row[idx]?.length ?? 0)
    }
    return Math.min(
      MAX_COLUMN,
      Math.max(MIN_COLUMN, longest * CHAR_WIDTH + CELL_PADDING)
    )
  })
}

function TableRow({
  label,
  cells,
  widths,
  gutter,
  header = false,
}: {
  label: string
  cells: string[]
  widths: number[]
  gutter: number
  header?: boolean
}) {
  return (
    <View
      className={`flex-row border-b border-separator ${header ? "bg-surface-secondary" : "bg-background"}`}
      style={{ height: ROW_HEIGHT }}
    >
      <View
        className="justify-center border-r border-separator px-two"
        style={{ width: gutter }}
      >
        <Text className="text-right text-xs tabular-nums text-muted">
          {label}
        </Text>
      </View>
      {cells.map((cell, idx) => (
        <View
          className="justify-center border-r border-separator px-two"
          // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
          key={idx}
          style={{ width: widths[idx] }}
        >
          <Text
            className={
              header
                ? "text-xs font-semibold text-foreground"
                : "text-[13px] text-foreground"
            }
            numberOfLines={1}
            selectable={!header}
          >
            {cell}
          </Text>
        </View>
      ))}
    </View>
  )
}

// A CSV as a read-only table: a sticky header, row numbers, one line per
// cell. Scrolls both ways; only the rows on screen render.
export function CsvTable({
  columns,
  rows,
}: {
  columns: string[]
  rows: string[][]
}) {
  const widths = useMemo(() => columnWidths(columns, rows), [columns, rows])
  const gutter = Math.max(
    36,
    String(rows.length).length * CHAR_WIDTH + CELL_PADDING
  )
  const width = gutter + widths.reduce((sum, column) => sum + column, 0)

  return (
    <ScrollView horizontal>
      <FlatList
        data={rows}
        getItemLayout={(_, index) => ({
          index,
          length: ROW_HEIGHT,
          // The header row sits above the first data row.
          offset: ROW_HEIGHT * (index + 1),
        })}
        initialNumToRender={30}
        keyExtractor={(_, index) => String(index)}
        ListHeaderComponent={
          <TableRow
            cells={columns}
            gutter={gutter}
            header
            label=""
            widths={widths}
          />
        }
        renderItem={({ item, index }) => (
          <TableRow
            cells={item}
            gutter={gutter}
            label={String(index + 1)}
            widths={widths}
          />
        )}
        stickyHeaderIndices={[0]}
        style={{ width }}
      />
    </ScrollView>
  )
}
