import { TextSelection, type Transaction } from "@tiptap/pm/state"
import type { Editor } from "@tiptap/react"
import { useEffect, useRef } from "react"
import { useDesktopChrome } from "@/components/desktop-window-frame"
import { whenEditorMounted } from "@/lib/editor-utils"

// Keys that put the caret at the end of the visual line.
function movesToLineEnd(event: KeyboardEvent) {
  return event.key === "End" || (event.metaKey && event.key === "ArrowRight")
}

// The gap cursor (beside a Linear card or code block) keeps its own CSS bar
// (globals.css .ProseMirror-gapcursor); this paints text carets only.
export function DesktopCaret({ editor }: { editor: Editor | null }) {
  const { isMacDesktop } = useDesktopChrome()
  const caretRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!editor || !isMacDesktop) return

    return whenEditorMounted(editor, () => {
      const caret = caretRef.current
      const container = caret?.parentElement
      if (!caret || !container) return () => {}

      const view = editor.view
      const editable = view.dom
      // The composer scrolls in its EditorContent; the edit box scrolls the
      // editable itself.
      const scroller =
        editable.closest<HTMLElement>(".composer-scroller") ?? editable
      const doc = editable.ownerDocument
      const win = doc.defaultView
      if (!win) return () => {}

      let frame = 0
      let blink: Animation | undefined
      let lastPosition = ""
      let composing = false
      // ProseMirror selections carry no affinity, so at a soft wrap one
      // position is both the end of a line and the start of the next. The
      // browser puts the caret on the next line unless it was moved to the
      // line end (End, Cmd+Right) or placed by a press on the earlier line.
      let pendingLineEnd = false
      let pendingPressY: number | null = null
      let affinity: { pos: number; side: -1 | 1 } | null = null
      const reducedMotion = win.matchMedia("(prefers-reduced-motion: reduce)")

      // WKWebView's native caret can persist at old composer positions.
      // Keep the real selection for editing/IME; replace only its paint.
      editable.setAttribute("data-desktop-caret", "")

      const hide = () => {
        caret.hidden = true
        blink?.cancel()
        blink = undefined
        lastPosition = ""
      }

      const sideAt = (head: number) => {
        if (pendingLineEnd || pendingPressY !== null) {
          const before = view.coordsAtPos(head, -1)
          const after = view.coordsAtPos(head, 1)
          const wraps = before.bottom <= after.top
          const side =
            wraps &&
            (pendingLineEnd ||
              (pendingPressY !== null && pendingPressY < after.top))
              ? -1
              : 1
          affinity = { pos: head, side }
          pendingLineEnd = false
          pendingPressY = null
        }
        return affinity?.pos === head ? affinity.side : 1
      }

      const update = () => {
        frame = 0
        const selection = editor.state.selection
        const domSelection = doc.getSelection()
        if (
          composing ||
          !doc.hasFocus() ||
          doc.hidden ||
          !view.hasFocus() ||
          !(selection instanceof TextSelection) ||
          !selection.empty ||
          !domSelection?.isCollapsed ||
          !domSelection.focusNode ||
          !editable.contains(domSelection.focusNode)
        ) {
          hide()
          return
        }

        const bounds = container.getBoundingClientRect()
        const clip = scroller.getBoundingClientRect()
        const scale = bounds.width / container.offsetWidth
        if (!Number.isFinite(scale) || scale <= 0) {
          hide()
          return
        }

        const head = selection.head
        const side = sideAt(head)
        const rect = view.coordsAtPos(head, side)
        // The glyph box at the caret, as the native caret is tall, capped at
        // the line height so a tall inline chip doesn't stretch it.
        const { node } = view.domAtPos(head)
        const block = node instanceof Element ? node : node.parentElement
        const lineHeight = block
          ? Number.parseFloat(win.getComputedStyle(block).lineHeight)
          : Number.NaN
        const glyph = (rect.bottom - rect.top) / scale
        const height = Number.isFinite(lineHeight)
          ? Math.min(glyph, lineHeight)
          : glyph
        const top = rect.top + ((glyph - height) * scale) / 2
        if (
          height <= 0 ||
          top < clip.top ||
          top + height * scale > clip.bottom ||
          rect.left < clip.left ||
          rect.left > clip.right
        ) {
          hide()
          return
        }

        const x = (rect.left - bounds.left) / scale
        const y = (top - bounds.top) / scale
        const nextPosition = `${head}:${x}:${y}:${height}:${reducedMotion.matches}`
        caret.style.transform = `translate(${x}px, ${y}px)`
        caret.style.height = `${height}px`
        caret.hidden = false
        if (nextPosition !== lastPosition) {
          lastPosition = nextPosition
          blink?.cancel()
          blink = reducedMotion.matches
            ? undefined
            : caret.animate(
                [
                  { opacity: 1, offset: 0 },
                  { opacity: 0, offset: 0.5 },
                  { opacity: 0, offset: 1 },
                ],
                {
                  duration: 1000,
                  iterations: Infinity,
                  easing: "steps(1, end)",
                  delay: 500,
                }
              )
        }
      }

      const schedule = () => {
        if (!frame) frame = win.requestAnimationFrame(update)
      }
      const onKeyDown = (event: KeyboardEvent) => {
        // Shift alone keeps the caret where it is.
        if (["Shift", "Meta", "Control", "Alt"].includes(event.key)) return
        affinity = null
        pendingPressY = null
        pendingLineEnd = movesToLineEnd(event)
      }
      const onMouseDown = (event: MouseEvent) => {
        affinity = null
        pendingLineEnd = false
        pendingPressY = event.clientY
      }
      const onTransaction = ({ transaction }: { transaction: Transaction }) => {
        if (transaction.docChanged) affinity = null
        schedule()
      }
      // The IME draws its marked text; no caret over it.
      const onCompositionStart = () => {
        composing = true
        hide()
      }
      const onCompositionEnd = () => {
        composing = false
        schedule()
      }
      const observer = new ResizeObserver(schedule)
      observer.observe(container)
      observer.observe(editable)
      editor.on("transaction", onTransaction)
      editor.on("focus", schedule)
      editor.on("blur", hide)
      editable.addEventListener("keydown", onKeyDown, true)
      editable.addEventListener("mousedown", onMouseDown, true)
      editable.addEventListener("compositionstart", onCompositionStart)
      editable.addEventListener("compositionend", onCompositionEnd)
      doc.addEventListener("selectionchange", schedule)
      doc.addEventListener("scroll", schedule, true)
      doc.addEventListener("visibilitychange", schedule)
      win.addEventListener("resize", schedule)
      win.addEventListener("focus", schedule)
      win.addEventListener("blur", hide)
      reducedMotion.addEventListener("change", schedule)
      schedule()

      return () => {
        win.cancelAnimationFrame(frame)
        observer.disconnect()
        blink?.cancel()
        editable.removeAttribute("data-desktop-caret")
        editor.off("transaction", onTransaction)
        editor.off("focus", schedule)
        editor.off("blur", hide)
        editable.removeEventListener("keydown", onKeyDown, true)
        editable.removeEventListener("mousedown", onMouseDown, true)
        editable.removeEventListener("compositionstart", onCompositionStart)
        editable.removeEventListener("compositionend", onCompositionEnd)
        doc.removeEventListener("selectionchange", schedule)
        doc.removeEventListener("scroll", schedule, true)
        doc.removeEventListener("visibilitychange", schedule)
        win.removeEventListener("resize", schedule)
        win.removeEventListener("focus", schedule)
        win.removeEventListener("blur", hide)
        reducedMotion.removeEventListener("change", schedule)
        hide()
      }
    })
  }, [editor, isMacDesktop])

  if (!isMacDesktop) return null

  return (
    <span
      ref={caretRef}
      hidden
      aria-hidden="true"
      className="pointer-events-none absolute top-0 left-0 w-px rounded-full bg-foreground/80"
    />
  )
}
