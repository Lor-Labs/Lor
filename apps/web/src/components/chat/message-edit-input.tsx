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
import type { MentionCandidate } from "@/components/chat/composer/mention-types"
import type { Message } from "@/lib/api-types"
import { toStoredMarkdown } from "@/lib/editor-utils"

const EDITOR_PROPS: EditorProps = {
  attributes: {
    class:
      "min-h-[24px] max-h-[200px] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6 text-foreground/90 outline-none [&_ul]:my-0.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_code]:rounded-[4px] [&_code]:border [&_code]:border-border/70 [&_code]:bg-primary/10 [&_code]:px-0.75 [&_code]:py-0.25 [&_code]:font-mono [&_code]:text-[0.92em] [&_code]:text-foreground [&_pre]:mt-1 [&_pre]:mb-0 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border/70 [&_pre]:bg-muted/50 [&_pre]:px-2 [&_pre]:py-1.5 [&_pre]:font-mono [&_pre]:text-[0.92em] [&_pre]:leading-6 [&_pre_code]:rounded-none [&_pre_code]:border-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-foreground",
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

    onSave(content)
  }, [editor, initialContent, loadedContent, onSave, onCancel])

  return (
    <div className="rounded-xl border border-input bg-background px-3 py-2.5 shadow-sm transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/15">
      <div className="relative [&_.ProseMirror_p]:m-0 [&_.ProseMirror_p]:leading-6">
        <EditorContent editor={editor} />
        <DesktopCaret editor={editor} />
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
