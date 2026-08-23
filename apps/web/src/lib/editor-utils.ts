import type { Editor } from "@tiptap/react"

const BROADCAST_MENTION_IDS = new Set(["everyone", "channel", "here"])

// Tiptap v3's editor.view is a truthy Proxy that THROWS on property access
// until EditorContent mounts the real view — `editor.view.dom` in a mount
// effect can crash the tree. Runs `attach` once the view exists (immediately
// if it already does, again on every remount) and returns a cleanup.
export function whenEditorMounted(
  editor: Editor,
  attach: () => () => void
): () => void {
  let detach: (() => void) | undefined
  const onMount = () => {
    detach?.()
    detach = attach()
  }
  if (editor.isInitialized) detach = attach()
  editor.on("mount", onMount)
  return () => {
    editor.off("mount", onMount)
    detach?.()
  }
}

export const TIPTAP_MARKDOWN_MENTION_REGEX = /\[@[^\]]*?\bid="([^"]+)"[^\]]*]/g
export const STORED_MENTION_REGEX =
  /<@([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})>/gi

export function toStoredMarkdown(markdown: string) {
  return (
    markdown
      .replace(/\u00A0/g, " ")
      // Strip ++…++ wrappers the Markdown extension generates for unrecognised marks (e.g. Link)
      // TipTap outputs either ++[url](url)++ or ++bareUrl++
      .replace(/\+\+\[([^\]]+)\]\([^)]+\)\+\+/g, "$1")
      .replace(/\+\+([\s\S]+?)\+\+/g, "$1")
      // Strip bare markdown links where text matches href (autolinked URLs without ++ wrappers)
      .replace(/\[([^\]]+)\]\(\1\)/g, "$1")
      .replace(TIPTAP_MARKDOWN_MENTION_REGEX, (_match, mentionId: string) => {
        if (BROADCAST_MENTION_IDS.has(mentionId.toLowerCase())) {
          return `@${mentionId.toLowerCase()}`
        }

        return `<@${mentionId}>`
      })
  )
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
