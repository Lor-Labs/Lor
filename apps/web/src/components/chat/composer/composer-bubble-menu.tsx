import {
  LeftToRightBlockQuoteIcon,
  LeftToRightListBulletIcon,
  LeftToRightListNumberIcon,
  Link01Icon,
  SourceCodeIcon,
  SourceCodeSquareIcon,
  TextBoldIcon,
  TextItalicIcon,
  TextStrikethroughIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import { cn } from "@repo/ui/lib/utils"
import { PluginKey } from "@tiptap/pm/state"
import {
  type Editor,
  type EditorStateSnapshot,
  getTextBetween,
  getTextSerializersFromSchema,
  posToDOMRect,
  useEditorState,
} from "@tiptap/react"
import { BubbleMenu, type BubbleMenuProps } from "@tiptap/react/menus"
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react"
import { whenEditorMounted } from "@/lib/editor-utils"

interface FormatButton {
  id: string
  label: string
  icon: IconSvgElement
  isActive: (editor: Editor) => boolean
  canRun: (editor: Editor) => boolean
  run: (editor: Editor) => void
}

const markButton = (
  mark: "bold" | "italic" | "code" | "strike",
  label: string,
  icon: IconSvgElement
): FormatButton => ({
  id: mark,
  label,
  icon,
  isActive: (editor) => editor.isActive(mark),
  // Off inside inline code, which excludes other marks.
  canRun: (editor) => editor.can().toggleMark(mark),
  run: (editor) => editor.chain().focus().toggleMark(mark).run(),
})

const LINK_ID = "link"
const PROBE_HREF = "https://example.com"

// Groups, split by a divider: marks and link, then blocks.
const FORMAT_GROUPS: FormatButton[][] = [
  [
    markButton("bold", "Bold", TextBoldIcon),
    markButton("italic", "Italic", TextItalicIcon),
    markButton("strike", "Strikethrough", TextStrikethroughIcon),
    markButton("code", "Inline code", SourceCodeIcon),
    {
      id: LINK_ID,
      label: "Link",
      icon: Link01Icon,
      isActive: (editor) => editor.isActive("link"),
      canRun: (editor) =>
        editor.isActive("link") || editor.can().setLink({ href: PROBE_HREF }),
      // Opens the link popover (ComposerBubbleMenu's onLink).
      run: () => undefined,
    },
  ],
  [
    {
      id: "bulletList",
      label: "Bulleted list",
      icon: LeftToRightListBulletIcon,
      isActive: (editor) => editor.isActive("bulletList"),
      canRun: (editor) => editor.can().toggleBulletList(),
      run: (editor) => editor.chain().focus().toggleBulletList().run(),
    },
    {
      id: "orderedList",
      label: "Numbered list",
      icon: LeftToRightListNumberIcon,
      isActive: (editor) => editor.isActive("orderedList"),
      canRun: (editor) => editor.can().toggleOrderedList(),
      run: (editor) => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      id: "blockquote",
      label: "Quote",
      icon: LeftToRightBlockQuoteIcon,
      isActive: (editor) => editor.isActive("blockquote"),
      canRun: (editor) => editor.can().toggleBlockquote(),
      run: (editor) => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      id: "codeBlock",
      label: "Code block",
      icon: SourceCodeSquareIcon,
      isActive: (editor) => editor.isActive("codeBlock"),
      canRun: (editor) => editor.can().toggleCodeBlock(),
      run: (editor) => toCodeBlock(editor),
    },
  ],
]
const FORMAT_BUTTONS = FORMAT_GROUPS.flat()

type FormatState = Record<string, { active: boolean; enabled: boolean }>

// Several selected lines become one code block, not one block per line.
function toCodeBlock(editor: Editor) {
  const { state } = editor
  const { $from, $to } = state.selection
  const range = $from.blockRange($to)
  const lines = range ? range.endIndex - range.startIndex : 0
  const allText =
    range &&
    Array.from(
      { length: lines },
      (_, index) => range.parent.child(range.startIndex + index).isTextblock
    ).every(Boolean)
  if (!range || lines < 2 || !allText) {
    editor.chain().focus().toggleCodeBlock().run()
    return
  }
  const text = getTextBetween(
    state.doc,
    { from: range.start, to: range.end },
    {
      blockSeparator: "\n",
      textSerializers: getTextSerializersFromSchema(state.schema),
    }
  )
  editor
    .chain()
    .focus()
    .insertContentAt(
      { from: range.start, to: range.end },
      { type: "codeBlock", content: text ? [{ type: "text", text }] : [] }
    )
    .run()
}

// Its own key, so useMenuVisibility can show and hide the menu.
const BUBBLE_MENU_KEY = new PluginKey("composerBubbleMenu")

// Module-level on purpose: BubbleMenu dispatches an `updateOptions`
// transaction whenever one of its plugin props changes identity.
const BUBBLE_MENU_OPTIONS: NonNullable<BubbleMenuProps["options"]> = {
  strategy: "fixed",
  placement: "top",
  offset: 8,
  flip: true,
  shift: true,
  // Hidden while the selection is scrolled out of the editor's scroller.
  hide: true,
}

const appendToBody = () => document.body

// Editors with a mouse or pen selection in progress. The menu waits for
// pointerup so it doesn't flicker along a drag; keyboard selections show it
// at once (updateDelay 0).
const pointerSelecting = new WeakSet<Editor>()

const shouldShowBubbleMenu: NonNullable<BubbleMenuProps["shouldShow"]> = ({
  editor,
  view,
  state,
  from,
  to,
}) => {
  if (!editor.isEditable || !view.hasFocus()) return false
  if (pointerSelecting.has(editor)) return false
  if (state.selection.empty || from === to) return false
  if (editor.isActive("codeBlock")) return false
  return state.doc.textBetween(from, to).trim().length > 0
}

const FORMAT_OFF = { active: false, enabled: false }
const HIDDEN_FORMAT_STATE: FormatState = Object.fromEntries(
  FORMAT_BUTTONS.map(({ id }) => [id, FORMAT_OFF])
)

// The menu only shows for a selection, so with a caret (every keystroke) this
// returns at once and runs no `can()` dry runs.
function selectFormatState({
  editor,
}: EditorStateSnapshot<Editor | null>): FormatState {
  if (!editor || editor.isDestroyed || editor.state.selection.empty) {
    return HIDDEN_FORMAT_STATE
  }
  return Object.fromEntries(
    FORMAT_BUTTONS.map(({ id, isActive, canRun }) => [
      id,
      { active: isActive(editor), enabled: canRun(editor) },
    ])
  )
}

function formatButtonClassName(isActive: boolean) {
  return cn(
    "size-7 border border-transparent text-muted-foreground",
    "hover:text-foreground",
    isActive &&
      "border-primary/30 bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary"
  )
}

// Shows the menu when a mouse selection ends. A press inside the old
// selection collapses it only at mouseup, before ProseMirror reads it, so a
// collapsed DOM selection waits for that transaction instead. Also hides it
// on every editor blur: the plugin skips the first blur after any press on
// the menu, which left it over the link popover.
function useMenuVisibility(editor: Editor) {
  useEffect(
    () =>
      whenEditorMounted(editor, () => {
        const { view } = editor
        const onPointerDown = (event: PointerEvent) => {
          if (event.pointerType === "touch" || event.button !== 0) return
          pointerSelecting.add(editor)
        }
        let timer: number | undefined
        const onPointerUp = () => {
          if (!pointerSelecting.delete(editor)) return
          window.clearTimeout(timer)
          // After mouseup and click, which can still move the selection.
          timer = window.setTimeout(() => {
            if (editor.isDestroyed) return
            if (window.getSelection()?.isCollapsed ?? true) return
            const { from, to } = editor.state.selection
            const show = shouldShowBubbleMenu({
              editor,
              element: view.dom,
              view,
              state: editor.state,
              from,
              to,
            })
            if (!show) return
            // "show" skips positioning until the menu is visible.
            view.dispatch(editor.state.tr.setMeta(BUBBLE_MENU_KEY, "show"))
            view.dispatch(
              editor.state.tr.setMeta(BUBBLE_MENU_KEY, "updatePosition")
            )
          })
        }
        const onBlur = () => {
          if (editor.isDestroyed) return
          view.dispatch(editor.state.tr.setMeta(BUBBLE_MENU_KEY, "hide"))
        }
        view.dom.addEventListener("pointerdown", onPointerDown)
        window.addEventListener("pointerup", onPointerUp, true)
        window.addEventListener("pointercancel", onPointerUp, true)
        editor.on("blur", onBlur)
        return () => {
          window.clearTimeout(timer)
          pointerSelecting.delete(editor)
          editor.off("blur", onBlur)
          view.dom.removeEventListener("pointerdown", onPointerDown)
          window.removeEventListener("pointerup", onPointerUp, true)
          window.removeEventListener("pointercancel", onPointerUp, true)
        }
      }),
    [editor]
  )
}

// The composer's formatting menu over a text selection. Its own narrow editor
// subscription keeps format changes from re-rendering MessageInput.
export const ComposerBubbleMenu = memo(function ComposerBubbleMenu({
  editor,
  onLink,
}: {
  editor: Editor
  // Opens the link popover; no Link button without it.
  onLink?: () => void
}) {
  const formats = useEditorState({ editor, selector: selectFormatState })
  useMenuVisibility(editor)

  // The menu follows the editor's own scroller, which moves without a
  // window scroll. Found once mounted: one options update.
  const [scroller, setScroller] = useState<HTMLElement | null>(null)
  useEffect(
    () =>
      whenEditorMounted(editor, () => {
        setScroller(editor.view.dom.closest<HTMLElement>(".composer-scroller"))
        return () => undefined
      }),
    [editor]
  )
  const options = useMemo(
    () =>
      scroller
        ? { ...BUBBLE_MENU_OPTIONS, scrollTarget: scroller }
        : BUBBLE_MENU_OPTIONS,
    [scroller]
  )

  // Anchored to the whole selection. contextElement lets the hide
  // middleware clip it against the editor's scroller.
  const getReferencedVirtualElement = useCallback(() => {
    const { view } = editor
    const { from, to, empty } = editor.state.selection
    if (empty) return null
    const rect = () => posToDOMRect(view, from, to)
    return {
      getBoundingClientRect: rect,
      getClientRects: () => [rect()],
      contextElement: view.dom,
    }
  }, [editor])

  return (
    <BubbleMenu
      editor={editor}
      pluginKey={BUBBLE_MENU_KEY}
      updateDelay={0}
      appendTo={appendToBody}
      shouldShow={shouldShowBubbleMenu}
      getReferencedVirtualElement={getReferencedVirtualElement}
      options={options}
      className="z-50 flex items-center gap-1 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {FORMAT_GROUPS.map((group, index) => (
        <Fragment key={group[0]?.id}>
          {index > 0 && (
            <div aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-border" />
          )}
          {group.map(({ id, label, icon, run }) => {
            if (id === LINK_ID && !onLink) return null
            const { active, enabled } = formats[id] ?? FORMAT_OFF
            return (
              <Button
                key={id}
                type="button"
                size="icon-xs"
                variant="ghost"
                className={formatButtonClassName(active)}
                aria-label={label}
                aria-pressed={active}
                onMouseDown={(event) => {
                  event.preventDefault()
                }}
                onClick={() => {
                  if (id === LINK_ID) onLink?.()
                  else run(editor)
                }}
                disabled={!enabled}
              >
                <HugeiconsIcon
                  icon={icon}
                  className="size-3.5"
                  strokeWidth={active ? 2.5 : 2}
                />
              </Button>
            )
          })}
        </Fragment>
      ))}
    </BubbleMenu>
  )
})
