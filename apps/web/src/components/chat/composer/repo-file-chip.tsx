import { File01Icon, Folder01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { cn } from "@repo/ui/lib/utils"
import { Selection } from "@tiptap/pm/state"
import {
  type Editor,
  mergeAttributes,
  Node,
  type NodeViewProps,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from "@tiptap/react"
import {
  type ComposerFileReference,
  repoFileFromUrl,
  repoFileLabel,
  repoFileMarkdown,
  repoFileUrl,
} from "@/lib/repo-file-reference"

function chipMarkdown(url: string) {
  const reference = repoFileFromUrl(url)
  return reference ? repoFileMarkdown(reference) : ""
}

function RepoFileChipView({ node, selected }: NodeViewProps) {
  const reference = repoFileFromUrl(node.attrs.url)
  return (
    <NodeViewWrapper as="span" className="align-baseline">
      <span
        className={cn(
          "inline-flex max-w-full items-center gap-1 rounded bg-primary/10 px-1 py-0.5 align-baseline font-medium text-primary",
          selected && "ring-1 ring-primary/40"
        )}
        title={reference?.path}
      >
        <HugeiconsIcon
          icon={reference?.kind === "folder" ? Folder01Icon : File01Icon}
          className="size-3 shrink-0"
        />
        <span className="max-w-64 truncate">
          {reference ? repoFileLabel(reference) : ""}
        </span>
      </span>
    </NodeViewWrapper>
  )
}

export const RepoFileChip = Node.create({
  name: "repoFileChip",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      url: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-repo-file"),
        renderHTML: (attributes) => ({ "data-repo-file": attributes.url }),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: "span[data-repo-file]",
        getAttrs: (element) =>
          repoFileFromUrl(element.getAttribute("data-repo-file") ?? "")
            ? null
            : false,
      },
    ]
  },

  renderHTML({ HTMLAttributes, node }) {
    const reference = repoFileFromUrl(node.attrs.url)
    return [
      "span",
      mergeAttributes(HTMLAttributes),
      reference ? repoFileLabel(reference) : "",
    ]
  },

  renderText({ node }) {
    return chipMarkdown(node.attrs.url)
  },

  renderMarkdown(node) {
    return chipMarkdown(node.attrs?.url ?? "")
  },

  addNodeView() {
    return ReactNodeViewRenderer(RepoFileChipView)
  },
})

export function insertRepoFileReference(
  editor: Editor,
  { reference, point }: ComposerFileReference
) {
  let position = Selection.atEnd(editor.state.doc).from
  if (point) {
    const bounds = editor.view.dom.getBoundingClientRect()
    if (
      point.left >= bounds.left &&
      point.left <= bounds.right &&
      point.top >= bounds.top &&
      point.top <= bounds.bottom
    ) {
      position = editor.view.posAtCoords(point)?.pos ?? position
    }
  }
  const content = [
    { type: "repoFileChip", attrs: { url: repoFileUrl(reference) } },
    { type: "text", text: " " },
  ]
  const resolved = editor.state.doc.resolve(position)
  // Code blocks accept text only; put the reference in a paragraph after it.
  const inCode = resolved.parent.type.spec.code
  return editor
    .chain()
    .focus()
    .insertContentAt(
      inCode ? resolved.after() : position,
      inCode ? { type: "paragraph", content } : content
    )
    .run()
}
