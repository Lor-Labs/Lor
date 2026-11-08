import { Button } from "@repo/ui/components/button"
import { Kbd } from "@repo/ui/components/unlumen-ui/kbd"
import type { EditorProps } from "@tiptap/pm/view"
import { EditorContent, useEditor } from "@tiptap/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  type ComposerHost,
  composerExtensions,
} from "@/components/chat/composer/composer-extensions"
import { DesktopCaret } from "@/components/chat/composer/desktop-caret"
import { withLinearIssueNodes } from "@/components/chat/composer/linear-issue-node"
import {
  LinkPopover,
  type LinkPopoverHandle,
} from "@/components/chat/composer/link-popover"
import type { MentionCandidate } from "@/components/chat/composer/mention-types"
import type { Message } from "@/lib/api-types"
import { toStoredMarkdown, warnIfTooLong } from "@/lib/editor-utils"

const EDITOR_PROPS: EditorProps = {
  attributes: {
    // Prose rules shared with sent messages: globals.css .composer-prose.
    class:
      "composer-prose max-h-[200px] overflow-y-auto text-sm text-foreground/90 outline-none",
  },
}

function storedContent(editor: { getMarkdown: () => string }) {
  return toStoredMarkdown(editor.getMarkdown()).trim()
}

interface MessageEditInputProps {
  initialContent: string
  // Names for the message's `<@id>` mentions, shown as chips while editing.
  mentions?: Message["mentions"]
  onSave: (content: string) => void
  onCancel: () => void
  mentionCandidates?: MentionCandidate[]
}

export function MessageEditInput({
  initialContent,
  mentions = [],
  onSave,
  onCancel,
  mentionCandidates = [],
}: MessageEditInputProps) {
  const linkPopoverRef = useRef<LinkPopoverHandle>(null)
  const host: ComposerHost = {
    mentionCandidates,
    mentionLabel: (id) =>
      mentions.find((mention) => mention.id === id)?.name ??
      mentionCandidates.find((candidate) => candidate.id === id)?.label ??
      "unknown-user",
    // Enter saves and Escape cancels, after the @ menu takes its keys.
    onSubmit: () => handleSave(),
    onEscape: () => {
      onCancel()
      return true
    },
    openLinkEditor: () => linkPopoverRef.current?.open() ?? false,
  }
  const hostRef = useRef(host)
  hostRef.current = host
  // Built once, so re-renders never call editor.setOptions().
  const [extensions] = useState(() =>
    composerExtensions({ variant: "edit", host: hostRef })
  )
  const [initialMarkdown] = useState(() => withLinearIssueNodes(initialContent))

  const editor = useEditor(
    {
      extensions,
      content: initialMarkdown,
      contentType: "markdown",
      editorProps: EDITOR_PROPS,
    },
    []
  )

  // The message as this editor stores it, before any change. Serializing can
  // normalize stored text (escapes, link form), so an unchanged save compares
  // against this, not only against the original.
  const loadedContent = useMemo(
    () => (editor ? storedContent(editor) : null),
    [editor]
  )

  // Opened from the message's menu. Base UI returns focus to the menu
  // trigger only while focus is still inside the menu, so one deferred focus
  // is enough; a click that already placed the caret wins.
  useEffect(() => {
    if (!editor) return
    const frame = requestAnimationFrame(() => {
      if (!editor.isDestroyed && !editor.isFocused) {
        editor.commands.focus("end")
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [editor])

  const handleSave = useCallback(() => {
    if (!editor) return

    const content = storedContent(editor)
    if (content.length === 0) return

    if (content === loadedContent || content === initialContent) {
      onCancel()
      return
    }
    if (warnIfTooLong(content)) return

    onSave(content)
  }, [editor, initialContent, loadedContent, onSave, onCancel])

  return (
    <div className="rounded-xl border border-input bg-background px-3 py-2.5 shadow-sm transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/15">
      <div className="relative">
        <EditorContent editor={editor} />
        <DesktopCaret editor={editor} />
        {editor && <LinkPopover editor={editor} ref={linkPopoverRef} />}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
          <Kbd size="sm">Esc</Kbd>
          <span>to cancel</span>
          <span className="text-muted-foreground/40">·</span>
          <Kbd size="sm">↵</Kbd>
          <span>to save</span>
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            title="Cancel (Esc)"
          >
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} title="Save (Enter)">
            Save
          </Button>
        </div>
      </div>
    </div>
  )
}
