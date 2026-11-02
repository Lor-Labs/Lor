import { Plugin, PluginKey } from "@tiptap/pm/state"
import {
  type JSONContent,
  mergeAttributes,
  Node,
  type NodeViewProps,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from "@tiptap/react"
import { LinearIssueCard } from "@/components/chat/linear-issue-card"
import { MessageMarkdown } from "@/components/chat/message-markdown"
import { parseLinearIssue, splitLinearIssues } from "@/lib/linear-issue-block"

function LinearIssueView({ node, deleteNode }: NodeViewProps) {
  const issue = parseLinearIssue(node.attrs.raw)
  if (!issue) return <NodeViewWrapper />
  return (
    // The editor's pre-wrap would show the markdown's newlines as blank lines.
    <NodeViewWrapper className="my-1.5 whitespace-normal">
      <LinearIssueCard
        issue={issue}
        description={
          <MessageMarkdown content={issue.description} mentions={[]} />
        }
        onRemove={deleteNode}
      />
    </NodeViewWrapper>
  )
}

// Stored text with its issue blocks as this node's HTML, for an editor that
// loads stored text as HTML (where the block's tags would be dropped).
export function withLinearIssueNodes(text: string): string {
  return splitLinearIssues(text)
    .map((part) => {
      if (part.kind === "text") return part.text
      const raw = part.issue.raw
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
      return `<div data-linear-issue="${raw}"></div>`
    })
    .join("")
}

// Lines of pasted text, one paragraph each, as a plain-text paste gives them.
function paragraphs(text: string): JSONContent[] {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => ({
      type: "paragraph",
      content: [{ type: "text", text: line }],
    }))
}

// A Linear issue pasted with Copy as prompt: a card in the composer, sent as
// the block it was pasted as (linear-issue-block.ts).
export const LinearIssue = Node.create({
  name: "linearIssue",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  // Keep the default priority: a block above paragraph (1000) in the schema
  // becomes what an empty editor is filled with.

  addAttributes() {
    return {
      raw: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-linear-issue"),
        renderHTML: (attributes) => ({ "data-linear-issue": attributes.raw }),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: "div[data-linear-issue]",
        getAttrs: (element) =>
          parseLinearIssue(element.getAttribute("data-linear-issue") ?? "")
            ? null
            : false,
      },
    ]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes),
      parseLinearIssue(node.attrs.raw)?.title ?? "",
    ]
  },

  renderText({ node }) {
    return node.attrs.raw
  },

  renderMarkdown(node) {
    return node.attrs?.raw ?? ""
  },

  addNodeView() {
    return ReactNodeViewRenderer(LinearIssueView)
  },

  addProseMirrorPlugins() {
    const { editor, name } = this
    return [
      new Plugin({
        key: new PluginKey("linearIssuePaste"),
        props: {
          handlePaste: (view, event) => {
            if (view.state.selection.$from.parent.type.spec.code) return false
            const text = event.clipboardData?.getData("text/plain")
            if (!text) return false
            const parts = splitLinearIssues(text)
            if (!parts.some((part) => part.kind === "issue")) return false

            const content: JSONContent[] = parts.flatMap((part) =>
              part.kind === "issue"
                ? [{ type: name, attrs: { raw: part.issue.raw } }]
                : paragraphs(part.text)
            )
            // Typing goes on under the card.
            if (parts.at(-1)?.kind === "issue")
              content.push({ type: "paragraph" })
            return editor.chain().focus().insertContent(content).run()
          },
        },
      }),
    ]
  },
})
