import type { SuggestionKeyDownProps } from "@tiptap/suggestion"
import {
  type ForwardedRef,
  type MouseEvent,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react"

export interface SuggestionListRef {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
}

// Keyboard and pointer selection for the @, / and $ menus. Only a bare Enter
// or Tab picks the item: Shift+Enter and Cmd+Enter go on to the editor (new
// line, send), which closes the menu.
export function useSuggestionList<TItem>(
  items: TItem[],
  command: (item: TItem) => void,
  ref: ForwardedRef<SuggestionListRef>
) {
  // New items (the query changed) start again at the top.
  const [selection, setSelection] = useState({
    items,
    index: 0,
    byPointer: false,
  })
  const isCurrent = selection.items === items
  const selectedIndex = isCurrent ? selection.index : 0
  const byPointer = isCurrent && selection.byPointer
  const rowsRef = useRef<(HTMLElement | null)[]>([])
  const pointerRef = useRef<{ x: number; y: number } | null>(null)

  // Keyboard moves and new results keep the selected row in view; hover
  // never scrolls the list under the pointer.
  useEffect(() => {
    if (byPointer || items.length === 0) return
    rowsRef.current[selectedIndex]?.scrollIntoView({ block: "nearest" })
  }, [byPointer, selectedIndex, items])

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown: ({ event }) => {
        if (items.length === 0) return false
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          const step = event.key === "ArrowDown" ? 1 : -1
          setSelection({
            items,
            index: (selectedIndex + step + items.length) % items.length,
            byPointer: false,
          })
          return true
        }
        const bare = !(
          event.shiftKey ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey
        )
        const item = items[selectedIndex]
        if (!bare || !item || (event.key !== "Enter" && event.key !== "Tab")) {
          return false
        }
        command(item)
        return true
      },
    }),
    [items, selectedIndex, command]
  )

  const getRowProps = (index: number) => ({
    ref: (node: HTMLElement | null) => {
      rowsRef.current[index] = node
    },
    // Only a real pointer move selects: a row that scrolls under a still
    // pointer, or a menu that opens under it, keeps the keyboard's choice.
    onMouseMove: (event: MouseEvent) => {
      const last = pointerRef.current
      pointerRef.current = { x: event.clientX, y: event.clientY }
      if (!last || (last.x === event.clientX && last.y === event.clientY)) {
        return
      }
      if (index !== selectedIndex) {
        setSelection({ items, index, byPointer: true })
      }
    },
  })

  return { selectedIndex, getRowProps }
}
