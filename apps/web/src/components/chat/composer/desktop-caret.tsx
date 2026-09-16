import { TextSelection } from "@tiptap/pm/state"
import type { Editor } from "@tiptap/react"
import { useEffect, useRef } from "react"
import { useDesktopChrome } from "@/components/desktop-window-frame"
import { whenEditorMounted } from "@/lib/editor-utils"

export function DesktopCaret({ editor }: { editor: Editor | null }) {
  const { isMacDesktop } = useDesktopChrome()
  const caretRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!editor || !isMacDesktop) return

    return whenEditorMounted(editor, () => {
      const caret = caretRef.current
      const container = caret?.parentElement
      if (!caret || !container) return () => {}

      const editable = editor.view.dom
      const scroller = editable.parentElement
      const doc = editable.ownerDocument
      const win = doc.defaultView
      if (!scroller || !win) return () => {}

      let frame = 0
      let blink: Animation | undefined
      let lastPosition = ""
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

      const update = () => {
        frame = 0
        const selection = editor.state.selection
        const domSelection = doc.getSelection()
        if (
          !doc.hasFocus() ||
          doc.hidden ||
          !editor.view.hasFocus() ||
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

        // DOM ranges preserve which side of a soft wrap the caret occupies.
        const range = domSelection.getRangeAt(0)
        const rect = Array.from(range.getClientRects()).find(
          (rect) => rect.height > 0
        )
        const position = rect ?? editor.view.coordsAtPos(selection.head)
        const lineHeight = (position.bottom - position.top) / scale
        const height = Math.min(16, lineHeight)
        const top = position.top + ((lineHeight - height) * scale) / 2
        if (
          height <= 0 ||
          top < clip.top ||
          top + height * scale > clip.bottom ||
          position.left < clip.left ||
          position.left > clip.right
        ) {
          hide()
          return
        }

        const x = (position.left - bounds.left) / scale
        const y = (top - bounds.top) / scale
        const nextPosition = `${selection.head}:${x}:${y}:${height}:${reducedMotion.matches}`
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
      const observer = new ResizeObserver(schedule)
      observer.observe(container)
      observer.observe(editable)
      editor.on("transaction", schedule)
      editor.on("focus", schedule)
      editor.on("blur", hide)
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
        editor.off("transaction", schedule)
        editor.off("focus", schedule)
        editor.off("blur", hide)
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
