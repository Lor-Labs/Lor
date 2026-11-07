import type { Editor } from "@tiptap/react"
import { splitLinearIssues } from "@/lib/linear-issue-block"

// Tiptap v3's editor.view is a truthy Proxy that THROWS on property access
// until EditorContent mounts the real view — `editor.view.dom` in a mount
// effect can crash the tree. Runs `attach` once the view exists (immediately
// if it already does, again on every remount) and returns a cleanup.
// isDestroyed is false while a live view exists. isInitialized flips a task
// after mount, after a click-opened editor's effects have already run.
export function whenEditorMounted(
  editor: Editor,
  attach: () => () => void
): () => void {
  let detach: (() => void) | undefined
  const onMount = () => {
    detach?.()
    detach = attach()
  }
  if (!editor.isDestroyed) detach = attach()
  editor.on("mount", onMount)
  return () => {
    editor.off("mount", onMount)
    detach?.()
  }
}

export const STORED_MENTION_REGEX =
  /<@([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})>/gi

// Mentions and links write their stored form themselves (mention-markdown.ts).
// Pasted Linear issues are stored exactly as pasted (linear-issue-block.ts).
export function toStoredMarkdown(markdown: string) {
  return splitLinearIssues(markdown)
    .map((part) =>
      part.kind === "issue" ? part.issue.raw : storedText(part.text)
    )
    .join("")
}

function storedText(markdown: string) {
  return markdown.replace(/\u00A0/g, " ")
}

export function extractMentionIds(content: string) {
  const mentionIds = new Set<string>()

  for (const match of content.matchAll(STORED_MENTION_REGEX)) {
    const mentionId = match[1]
    if (mentionId) {
      mentionIds.add(mentionId)
    }
  }

  return Array.from(mentionIds)
}
