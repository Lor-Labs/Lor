import { cn } from "@repo/ui/lib/utils"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import {
  mergeAttributes,
  Node,
  type NodeViewProps,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from "@tiptap/react"
import type { ConnectorKey } from "@/lib/api-types"
import {
  connectorForUrl,
  connectorLinkLabel,
  connectorLogo,
  isConnectorKey,
} from "@/lib/connector-ui"

export interface ConnectorChipAttrs {
  connector: ConnectorKey | null
  url: string
  label: string
}

// Chips serialize to an ordinary Markdown link — what Lor and every other
// surface already understand. Brackets in the label would break the link, and
// spaces/parens in the url would break its target.
function chipMarkdown(attrs: Partial<ConnectorChipAttrs>): string {
  const url = attrs.url ?? ""
  const label = (attrs.label ?? "").replaceAll(/[[\]]/g, "").trim() || url
  if (!url) return label
  const safeUrl = url
    .replaceAll(/\s/g, "%20")
    .replaceAll("(", "%28")
    .replaceAll(")", "%29")
  return `[${label}](${safeUrl})`
}

export function connectorChipAttrs(url: string): ConnectorChipAttrs | null {
  const connector = connectorForUrl(url)
  if (!connector) return null
  return { connector, url, label: connectorLinkLabel(url) ?? url }
}

function ConnectorChipView({ node, selected }: NodeViewProps) {
  const attrs = node.attrs as ConnectorChipAttrs
  const Logo = connectorLogo(
    isConnectorKey(attrs.connector) ? attrs.connector : null
  )

  return (
    <NodeViewWrapper as="span" className="align-baseline">
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded bg-primary/10 px-1 py-0.5 align-baseline font-medium text-primary",
          selected && "ring-1 ring-primary/40"
        )}
        title={attrs.url}
      >
        <Logo className="size-3 shrink-0" />
        <span className="inline-block max-w-64 truncate align-bottom">
          {attrs.label}
        </span>
      </span>
    </NodeViewWrapper>
  )
}

// An atomic inline node so it deletes as one unit and can't be typed into.
export const ConnectorChip = Node.create({
  name: "connectorChip",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  // Above Link, so a pasted connector url becomes a chip instead of a link mark.
  priority: 1100,

  addAttributes() {
    return {
      connector: {
        default: null,
        // Pasted HTML can carry any data-connector; keep unknown values out of
        // the node so nothing downstream indexes the registry with them.
        parseHTML: (element) => {
          const value = element.getAttribute("data-connector")
          return isConnectorKey(value) ? value : null
        },
        renderHTML: (attributes) => ({
          "data-connector": attributes.connector,
        }),
      },
      url: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-url"),
        renderHTML: (attributes) => ({ "data-url": attributes.url }),
      },
      label: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-label"),
        renderHTML: (attributes) => ({ "data-label": attributes.label }),
      },
    }
  },

  parseHTML() {
    return [{ tag: "span[data-connector-chip]" }]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-connector-chip": "" }),
      node.attrs.label,
    ]
  },

  renderText({ node }) {
    return chipMarkdown(node.attrs)
  },

  renderMarkdown(node) {
    return chipMarkdown(node.attrs ?? {})
  },

  addNodeView() {
    return ReactNodeViewRenderer(ConnectorChipView)
  },

  addProseMirrorPlugins() {
    const type = this.type
    return [
      new Plugin({
        key: new PluginKey("connectorChipPaste"),
        props: {
          // Only a bare connector url on its own becomes a chip; mixed content
          // keeps the editor's normal paste behaviour.
          handlePaste: (view, event) => {
            const text = event.clipboardData?.getData("text/plain")?.trim()
            if (!text || /\s/.test(text)) return false

            const attrs = connectorChipAttrs(text)
            if (!attrs) return false

            const tr = view.state.tr
              .replaceSelectionWith(type.create(attrs), false)
              .insertText(" ")
            view.dispatch(tr.scrollIntoView())
            return true
          },
        },
      }),
    ]
  },
})
