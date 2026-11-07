import { Button } from "@repo/ui/components/button"
import { Input } from "@repo/ui/components/input"
import { Popover, PopoverPopup } from "@repo/ui/components/popover"
import { type Editor, posToDOMRect } from "@tiptap/react"
import {
  memo,
  type Ref,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react"
import { toLinkHref } from "@/components/chat/composer/mention-markdown"

export interface LinkPopoverHandle {
  // Returns whether it opened; it can't in code.
  open: () => boolean
}

interface LinkTarget {
  from: number
  to: number
  // The link being edited; empty when adding one.
  href: string
}

// Any URL Link accepts, to ask whether this spot can take a link at all.
const PROBE_HREF = "https://example.com"

// Adds, edits or removes the link on the composer's selection (or the link
// at the caret). Opened by Cmd+K, Cmd+Shift+U and the bubble menu.
export const LinkPopover = memo(function LinkPopover({
  editor,
  ref,
}: {
  editor: Editor
  ref: Ref<LinkPopoverHandle>
}) {
  const [target, setTarget] = useState<LinkTarget | null>(null)
  const [value, setValue] = useState("")
  const [invalid, setInvalid] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // Closing returns focus, and the selection, to the editor unless the
  // person pressed somewhere else.
  const refocusRef = useRef(true)

  useImperativeHandle(
    ref,
    () => ({
      open: () => {
        if (!editor.isEditable) return false
        if (editor.isActive("link")) {
          editor.commands.extendMarkRange("link")
        }
        const href = String(editor.getAttributes("link").href ?? "")
        if (!href && !editor.can().setLink({ href: PROBE_HREF })) return false
        const { from, to } = editor.state.selection
        refocusRef.current = true
        setTarget({ from, to, href })
        setValue(href)
        setInvalid(false)
        return true
      },
    }),
    [editor]
  )

  const anchor = useMemo(() => {
    if (!target) return null
    const rect = () => {
      const size = editor.state.doc.content.size
      return posToDOMRect(
        editor.view,
        Math.min(target.from, size),
        Math.min(target.to, size)
      )
    }
    return {
      getBoundingClientRect: rect,
      getClientRects: () => [rect()],
      // Floating UI follows the editor's own scroller.
      contextElement: editor.view.dom,
    }
  }, [editor, target])

  const close = () => setTarget(null)

  const range = () => {
    const size = editor.state.doc.content.size
    return {
      from: Math.min(target?.from ?? 0, size),
      to: Math.min(target?.to ?? 0, size),
    }
  }

  const removeLink = () => {
    const { from, to } = range()
    editor
      .chain()
      .focus()
      .setTextSelection({ from, to })
      .unsetLink()
      .setTextSelection(to)
      .run()
    refocusRef.current = false
    close()
  }

  const applyLink = () => {
    if (!target) return
    if (!value.trim()) {
      if (target.href) removeLink()
      else close()
      return
    }
    const href = toLinkHref(value)
    if (!href) {
      setInvalid(true)
      return
    }
    const { from, to } = range()
    const chain = editor.chain().focus()
    if (from === to) {
      // Cmd+Shift+U with no selection: the URL is the link's text.
      chain.insertContentAt(from, {
        type: "text",
        text: href,
        marks: [{ type: "link", attrs: { href } }],
      })
    } else {
      chain
        .setTextSelection({ from, to })
        .setLink({ href })
        .setTextSelection(to)
    }
    chain.run()
    refocusRef.current = false
    close()
  }

  return (
    <Popover
      open={target !== null}
      onOpenChange={(open, details) => {
        if (open) return
        refocusRef.current =
          details.reason !== "outside-press" && details.reason !== "focus-out"
        close()
      }}
    >
      <PopoverPopup
        anchor={anchor}
        side="top"
        sideOffset={8}
        className="w-80"
        viewportClassName="p-1.5"
        initialFocus={inputRef}
        finalFocus={() => {
          if (refocusRef.current) editor.commands.focus()
          return false
        }}
      >
        <form
          noValidate
          className="flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            applyLink()
          }}
        >
          <Input
            ref={inputRef}
            size="sm"
            type="text"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="Paste or type a link"
            aria-label="Link URL"
            aria-invalid={invalid || undefined}
            value={value}
            onChange={(event) => {
              setValue(event.target.value)
              setInvalid(false)
            }}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return
              // Stays out of page-level Escape handlers (panels, sessions).
              event.preventDefault()
              event.stopPropagation()
              refocusRef.current = true
              close()
            }}
          />
          {target?.href && (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="shrink-0 text-muted-foreground hover:text-foreground"
              onClick={removeLink}
            >
              Remove
            </Button>
          )}
        </form>
        {invalid && (
          <p className="px-1 pt-1.5 text-destructive text-xs">
            Enter a web address, like example.com
          </p>
        )}
      </PopoverPopup>
    </Popover>
  )
})
