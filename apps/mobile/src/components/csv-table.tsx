import {
  LegendList,
  type LegendListRenderItemProps,
} from "@legendapp/list/react-native"
import * as Clipboard from "expo-clipboard"
import { useToast } from "heroui-native/toast"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native"
import { triggerHaptic } from "@/components/ui/haptics"

const ROW_HEIGHT = 32
const CHAR_WIDTH = 7.5
const CELL_PADDING = 20
const MIN_COLUMN = 72
const MAX_COLUMN = 240
// Widths come from the header and the first rows, so a long file doesn't
// measure every cell before it shows.
const SAMPLE_ROWS = 100
// Columns drawn past each edge of the screen, so a fast swipe doesn't show
// empty cells before the next range renders.
const COLUMN_OVERSCAN = 2

type ColumnRange = { start: number; end: number }

type TableLayout = {
  widths: number[]
  // Left edge of each column, after the row-number gutter.
  lefts: number[]
  gutter: number
  width: number
}

function tableLayout(columns: string[], rows: string[][]): TableLayout {
  const sample = rows.slice(0, SAMPLE_ROWS)
  const widths = columns.map((name, idx) => {
    let longest = name.length
    for (const row of sample) {
      longest = Math.max(longest, row[idx]?.length ?? 0)
    }
    return Math.min(
      MAX_COLUMN,
      Math.max(MIN_COLUMN, longest * CHAR_WIDTH + CELL_PADDING)
    )
  })
  const gutter = Math.max(
    36,
    String(rows.length).length * CHAR_WIDTH + CELL_PADDING
  )
  const lefts: number[] = []
  let left = gutter
  for (const width of widths) {
    lefts.push(left)
    left += width
  }
  return { widths, lefts, gutter, width: left }
}

// The columns that overlap [from, to], plus the overscan on each side.
function columnRange(
  layout: TableLayout,
  from: number,
  to: number
): ColumnRange {
  const { lefts, widths } = layout
  const last = lefts.length - 1
  let start = 0
  while (start < last && (lefts[start] ?? 0) + (widths[start] ?? 0) <= from) {
    start++
  }
  let end = start
  while (end < last && (lefts[end + 1] ?? 0) < to) end++
  return {
    start: Math.max(0, start - COLUMN_OVERSCAN),
    end: Math.min(last, end + COLUMN_OVERSCAN),
  }
}

const rowSize = () => ROW_HEIGHT
const rowKey = (_: string[], index: number) => String(index)

// One row with only the columns on screen; a spacer stands in for the ones
// scrolled past on the left.
const TableRow = memo(function TableRow({
  label,
  cells,
  visible,
  layout,
  header = false,
  onCopy,
}: {
  label: string
  cells: string[]
  visible: number[]
  layout: TableLayout
  header?: boolean
  onCopy?: (text: string) => void
}) {
  const first = visible[0]
  const skipped =
    first === undefined ? 0 : (layout.lefts[first] ?? 0) - layout.gutter
  return (
    <View
      className={`flex-row border-b border-separator ${header ? "bg-surface-secondary" : "bg-background"}`}
      style={{ height: ROW_HEIGHT, width: layout.width }}
    >
      <View
        className="justify-center border-r border-separator px-two"
        style={{ width: layout.gutter }}
      >
        <Text className="text-right text-xs tabular-nums text-muted">
          {label}
        </Text>
      </View>
      <View style={{ width: skipped }} />
      {visible.map((column) => {
        const cell = cells[column] ?? ""
        return (
          <View
            className="justify-center border-r border-separator px-two"
            key={column}
            style={{ width: layout.widths[column] }}
          >
            <Text
              className={
                header
                  ? "text-xs font-semibold text-foreground"
                  : "text-[13px] text-foreground"
              }
              numberOfLines={1}
              onLongPress={onCopy && cell ? () => onCopy(cell) : undefined}
            >
              {cell}
            </Text>
          </View>
        )
      })}
    </View>
  )
})

// A CSV as a read-only table: a fixed header, row numbers, one line per
// cell; long-press a cell to copy it. Virtualized both ways: LegendList
// recycles the rows on screen, and each row draws only the columns in view.
export function CsvTable({
  columns,
  rows,
}: {
  columns: string[]
  rows: string[][]
}) {
  const { toast } = useToast()
  const { width: windowWidth } = useWindowDimensions()
  const layout = useMemo(() => tableLayout(columns, rows), [columns, rows])
  const scrollLeft = useRef(0)
  const viewportWidth = useRef(windowWidth)
  const [range, setRange] = useState(() => columnRange(layout, 0, windowWidth))

  // State changes only when the range does, not on every scroll frame.
  const syncRange = useCallback(() => {
    const left = scrollLeft.current
    const next = columnRange(layout, left, left + viewportWidth.current)
    setRange((current) =>
      current.start === next.start && current.end === next.end ? current : next
    )
  }, [layout])
  useEffect(syncRange, [syncRange])

  const visible = useMemo(
    () =>
      Array.from(
        { length: Math.max(0, range.end - range.start + 1) },
        (_, offset) => range.start + offset
      ),
    [range]
  )

  const copyCell = useCallback(
    (text: string) => {
      void Clipboard.setStringAsync(text)
        .then(() => {
          triggerHaptic("soft")
          toast.show({ variant: "success", label: "Copied" })
        })
        .catch(() => undefined)
    },
    [toast]
  )

  const renderRow = useCallback(
    ({ item, index }: LegendListRenderItemProps<string[]>) => (
      <TableRow
        cells={item}
        label={String(index + 1)}
        layout={layout}
        onCopy={copyCell}
        visible={visible}
      />
    ),
    [layout, visible, copyCell]
  )

  return (
    <ScrollView
      horizontal
      onLayout={(event: LayoutChangeEvent) => {
        viewportWidth.current = event.nativeEvent.layout.width
        syncRange()
      }}
      onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
        scrollLeft.current = event.nativeEvent.contentOffset.x
        syncRange()
      }}
      scrollEventThrottle={16}
    >
      <View style={{ width: layout.width }}>
        <TableRow
          cells={columns}
          header
          label=""
          layout={layout}
          visible={visible}
        />
        <LegendList
          data={rows}
          estimatedItemSize={ROW_HEIGHT}
          extraData={range}
          getFixedItemSize={rowSize}
          keyExtractor={rowKey}
          recycleItems
          renderItem={renderRow}
          style={{ flex: 1 }}
        />
      </View>
    </ScrollView>
  )
}
