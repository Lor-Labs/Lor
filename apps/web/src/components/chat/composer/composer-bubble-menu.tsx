import {
  SourceCodeIcon,
  TextBoldIcon,
  TextItalicIcon,
  TextStrikethroughIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import { cn } from "@repo/ui/lib/utils"
import {
  type Editor,
  type EditorStateSnapshot,
  useEditorState,
} from "@tiptap/react"
import { BubbleMenu, type BubbleMenuProps } from "@tiptap/react/menus"
import { memo, useCallback } from "react"

const MARK_BUTTONS = [
  { mark: "bold", label: "Bold", icon: TextBoldIcon },
  { mark: "italic", label: "Italic", icon: TextItalicIcon },
  { mark: "code", label: "Inline code", icon: SourceCodeIcon },
  { mark: "strike", label: "Strikethrough", icon: TextStrikethroughIcon },
] as const

type MarkName = (typeof MARK_BUTTONS)[number]["mark"]
type MarkState = Record<MarkName, { active: boolean; enabled: boolean }>

// Module-level on purpose: BubbleMenu dispatches an `updateOptions`
// transaction whenever one of its plugin props changes identity.
const BUBBLE_MENU_OPTIONS: BubbleMenuProps["options"] = {
  strategy: "fixed",
  placement: "top",
  offset: 8,
  flip: true,
  shift: true,
}

const appendToBody = () => document.body

const shouldShowBubbleMenu: NonNullable<BubbleMenuProps["shouldShow"]> = ({
  editor,
  state,
  from,
  to,
}) => {
  if (!editor.isEditable) return false
  if (state.selection.empty || from === to) return false
  if (editor.isActive("codeBlock")) return false
  return state.doc.textBetween(from, to).trim().length > 0
}

const HIDDEN_MARK_STATE: MarkState = {
  bold: { active: false, enabled: false },
  italic: { active: false, enabled: false },
  code: { active: false, enabled: false },
  strike: { active: false, enabled: false },
}

// The menu only shows for a selection, so with a caret (every keystroke) this
// returns at once and runs no `can()` dry runs.
function selectMarkState({
  editor,
}: EditorStateSnapshot<Editor | null>): MarkState {
  if (!editor || editor.isDestroyed || editor.state.selection.empty) {
    return HIDDEN_MARK_STATE
  }
  const markState = (mark: MarkName) => ({
    active: editor.isActive(mark),
    // Off inside inline code, which excludes other marks.
    enabled: editor.can().toggleMark(mark),
  })
  return {
    bold: markState("bold"),
    italic: markState("italic"),
    code: markState("code"),
    strike: markState("strike"),
  }
}

function markButtonClassName(isActive: boolean) {
  return cn(
    "size-7 border border-transparent text-muted-foreground",
    "hover:text-foreground",
    isActive &&
      "border-primary/30 bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary"
  )
}

// The composer's formatting menu over a text selection. Its own narrow editor
// subscription keeps mark changes from re-rendering MessageInput.
export const ComposerBubbleMenu = memo(function ComposerBubbleMenu({
  editor,
}: {
  editor: Editor
}) {
  const marks = useEditorState({ editor, selector: selectMarkState })
  const getReferencedVirtualElement = useCallback(() => {
    const { selection } = editor.state
    if (selection.empty) return null

    const { left, right, top, bottom } = editor.view.coordsAtPos(selection.head)

    return {
      getBoundingClientRect: () =>
        new DOMRect(
          left,
          top,
          Math.max(1, right - left),
          Math.max(1, bottom - top)
        ),
    }
  }, [editor])

  return (
    <BubbleMenu
      editor={editor}
      appendTo={appendToBody}
      shouldShow={shouldShowBubbleMenu}
      getReferencedVirtualElement={getReferencedVirtualElement}
      options={BUBBLE_MENU_OPTIONS}
      className="z-50 flex items-center gap-1 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {MARK_BUTTONS.map(({ mark, label, icon }) => {
        const { active, enabled } = marks[mark]
        return (
          <Button
            key={mark}
            type="button"
            size="icon-xs"
            variant="ghost"
            className={markButtonClassName(active)}
            aria-label={label}
            aria-pressed={active}
            onMouseDown={(event) => {
              event.preventDefault()
            }}
            onClick={() => {
              editor.chain().focus().toggleMark(mark).run()
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
    </BubbleMenu>
  )
})
