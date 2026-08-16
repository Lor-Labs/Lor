import { cn } from "@repo/ui/lib/utils"
import {
  type Editor,
  EditorContent,
  Extension,
  mergeAttributes,
  Node,
  type NodeViewProps,
  NodeViewWrapper,
  nodeInputRule,
  ReactNodeViewRenderer,
  ReactRenderer,
  useEditor,
} from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Suggestion, {
  type SuggestionKeyDownProps,
  type SuggestionProps,
} from "@tiptap/suggestion"
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react"

// Template field for custom tools: {{args.x}} / {{secrets.KEY}} render as
// inline chips (same pattern as composer @mentions), and typing "{{" opens a
// suggestion popup over the tool's known arguments and secrets. Single-line
// by default (URL, header values); `multiline` for the request body. The
// stored value stays the plain template string — chips are presentation.

export type PlaceholderKind = "args" | "secrets"

export type PlaceholderItem = {
  kind: PlaceholderKind
  name: string
  isNew?: boolean
}

const NAME_REGEX = /^[A-Za-z][A-Za-z0-9_]*$/

function chipText(kind: PlaceholderKind, name: string): string {
  return `{{${kind}.${name}}}`
}

function PlaceholderChipView({ node, selected }: NodeViewProps) {
  const kind = node.attrs.kind as PlaceholderKind
  const name = node.attrs.name as string
  // Literal template text, not a pill — what you see is what's stored. Color
  // marks it as one atomic token (it still deletes/selects as a unit).
  return (
    <NodeViewWrapper as="span" className="align-baseline">
      <span
        className={cn(
          "font-medium text-primary",
          selected && "rounded bg-primary/15"
        )}
        title={
          kind === "secrets"
            ? "Secret — value stored encrypted"
            : "Argument — Merlin fills this in"
        }
      >
        {chipText(kind, name)}
      </span>
    </NodeViewWrapper>
  )
}

// Atomic inline chip; deletes as one unit, can't be typed into. A fully
// typed-out {{args.x}} converts via input rule too, so hand-typing works.
const TemplatePlaceholder = Node.create({
  name: "templatePlaceholder",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      kind: {
        default: "args",
        parseHTML: (element) => element.getAttribute("data-kind"),
        renderHTML: (attributes) => ({ "data-kind": attributes.kind }),
      },
      name: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-name"),
        renderHTML: (attributes) => ({ "data-name": attributes.name }),
      },
    }
  },

  parseHTML() {
    return [{ tag: "span[data-template-placeholder]" }]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-template-placeholder": "" }),
      chipText(node.attrs.kind, node.attrs.name),
    ]
  },

  renderText({ node }) {
    return chipText(node.attrs.kind, node.attrs.name)
  },

  addInputRules() {
    return [
      nodeInputRule({
        find: /\{\{\s*(args|secrets)\.([A-Za-z0-9_]+)\s*\}\}$/,
        type: this.type,
        getAttributes: (match) => ({ kind: match[1], name: match[2] }),
      }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(PlaceholderChipView)
  },
})

type SuggestionListProps = {
  items: PlaceholderItem[]
  command: (item: PlaceholderItem) => void
}

type SuggestionListRef = {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
}

const PlaceholderSuggestionList = forwardRef<
  SuggestionListRef,
  SuggestionListProps
>(function PlaceholderSuggestionList({ items, command }, ref) {
  const [selectedIndex, setSelectedIndex] = useState(0)

  const selectItem = useCallback(
    (index: number) => {
      const item = items[index]
      if (!item) return false
      command(item)
      return true
    },
    [items, command]
  )

  useEffect(() => {
    setSelectedIndex((current) =>
      items.length === 0 ? 0 : Math.min(current, items.length - 1)
    )
  }, [items.length])

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown: ({ event }) => {
        if (items.length === 0) return false
        if (event.key === "ArrowDown") {
          event.preventDefault()
          setSelectedIndex((i) => (i + 1) % items.length)
          return true
        }
        if (event.key === "ArrowUp") {
          event.preventDefault()
          setSelectedIndex((i) => (i + items.length - 1) % items.length)
          return true
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault()
          return selectItem(selectedIndex)
        }
        return false
      },
    }),
    [items.length, selectedIndex, selectItem]
  )

  if (items.length === 0) {
    return (
      <div className="px-2 py-1.5 text-xs text-muted-foreground">
        Type a name for a new argument or secret
      </div>
    )
  }

  return (
    <div className="max-h-56 overflow-y-auto p-1">
      {items.map((item, index) => (
        <button
          key={`${item.kind}:${item.name}:${item.isNew ? "new" : ""}`}
          type="button"
          className={cn(
            "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left font-mono text-xs",
            index === selectedIndex
              ? "bg-accent text-accent-foreground"
              : "hover:bg-accent/70"
          )}
          onMouseDown={(event) => {
            event.preventDefault()
            selectItem(index)
          }}
        >
          <span
            className={cn(
              "rounded px-1 py-px font-sans text-[10px]",
              item.kind === "args"
                ? "bg-primary/12 text-primary"
                : "bg-success/15 text-success"
            )}
          >
            {item.kind === "args" ? "arg" : "secret"}
          </span>
          {item.name}
          {item.isNew && (
            <span className="ml-auto font-sans text-[10px] text-muted-foreground">
              create new
            </span>
          )}
        </button>
      ))}
    </div>
  )
})

// Serialize the doc back to the plain template string. Marks are ignored on
// purpose — only text and placeholder chips carry meaning. Blocks join with
// newlines in multiline mode and concatenate otherwise.
function docToTemplate(editor: Editor, multiline: boolean): string {
  const lines: string[] = []
  editor.state.doc.forEach((block) => {
    let line = ""
    block.descendants((node) => {
      if (node.type.name === "templatePlaceholder") {
        line += chipText(node.attrs.kind, node.attrs.name)
        return false
      }
      if (node.isText) line += node.text ?? ""
      return true
    })
    lines.push(line)
  })
  return lines.join(multiline ? "\n" : "")
}

const REF_SPLIT_REGEX = /(\{\{\s*(?:args|secrets)\.[A-Za-z0-9_]+\s*\}\})/g
const REF_PARSE_REGEX = /^\{\{\s*(args|secrets)\.([A-Za-z0-9_]+)\s*\}\}$/

// A full doc object, not a block array: tiptap v3's createNodeFromContent
// turns arrays into Fragments, which EditorState.create rejects as a doc.
function templateToContent(template: string, multiline: boolean) {
  const lineToInline = (line: string) => {
    const content: Record<string, unknown>[] = []
    for (const part of line.split(REF_SPLIT_REGEX)) {
      if (!part) continue
      const ref = REF_PARSE_REGEX.exec(part)
      if (ref) {
        content.push({
          type: "templatePlaceholder",
          attrs: { kind: ref[1], name: ref[2] },
        })
      } else {
        content.push({ type: "text", text: part })
      }
    }
    return content
  }
  const lines = multiline ? template.split("\n") : [template]
  return {
    type: "doc",
    content: lines.map((line) => {
      const content = lineToInline(line)
      return { type: "paragraph", ...(content.length > 0 ? { content } : {}) }
    }),
  }
}

export function TemplateInput({
  value,
  onChange,
  argNames,
  secretNames,
  onCreatePlaceholder,
  placeholder,
  multiline = false,
  className,
}: {
  value: string
  onChange: (value: string) => void
  argNames: string[]
  secretNames: string[]
  // Called when the user picks "create new" from the {{ popup.
  onCreatePlaceholder: (item: PlaceholderItem) => void
  placeholder?: string
  multiline?: boolean
  className?: string
}) {
  // The suggestion config is captured at editor creation; refs keep its
  // callbacks reading current props.
  const namesRef = useRef({ argNames, secretNames })
  namesRef.current = { argNames, secretNames }
  const onCreateRef = useRef(onCreatePlaceholder)
  onCreateRef.current = onCreatePlaceholder
  const lastEmitted = useRef(value)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        horizontalRule: false,
        codeBlock: false,
        bulletList: false,
        orderedList: false,
        link: false,
      }),
      TemplatePlaceholder,
      Extension.create({
        name: "placeholderSuggestion",
        addProseMirrorPlugins() {
          return [
            Suggestion<PlaceholderItem, PlaceholderItem>({
              editor: this.editor,
              char: "{{",
              allowSpaces: false,
              // Default only triggers after whitespace — wrong for templates,
              // where {{ usually follows a / or " with no space.
              allowedPrefixes: null,
              items: ({ query }) => {
                const { argNames, secretNames } = namesRef.current
                const q = query.toLowerCase()
                const existing: PlaceholderItem[] = [
                  ...argNames.map((name) => ({ kind: "args" as const, name })),
                  ...secretNames.map((name) => ({
                    kind: "secrets" as const,
                    name,
                  })),
                ].filter((item) => item.name.toLowerCase().includes(q))
                const creatable =
                  query.length > 0 &&
                  NAME_REGEX.test(query) &&
                  !existing.some((i) => i.name === query)
                return [
                  ...existing,
                  ...(creatable
                    ? [
                        { kind: "args" as const, name: query, isNew: true },
                        { kind: "secrets" as const, name: query, isNew: true },
                      ]
                    : []),
                ]
              },
              command: ({ editor, range, props: item }) => {
                if (item.isNew) onCreateRef.current(item)
                editor
                  .chain()
                  .focus()
                  .insertContentAt(range, [
                    {
                      type: "templatePlaceholder",
                      attrs: { kind: item.kind, name: item.name },
                    },
                  ])
                  .run()
              },
              render: () => {
                let renderer: ReactRenderer<
                  SuggestionListRef,
                  SuggestionListProps
                > | null = null
                let popup: HTMLDivElement | null = null

                const position = (
                  props: SuggestionProps<PlaceholderItem, PlaceholderItem>
                ) => {
                  const rect = props.clientRect?.()
                  if (!rect || !popup) return
                  popup.style.left = `${rect.left}px`
                  popup.style.top = `${rect.bottom + 4}px`
                }

                return {
                  onStart: (props) => {
                    renderer = new ReactRenderer(PlaceholderSuggestionList, {
                      props,
                      editor: props.editor,
                    })
                    popup = document.createElement("div")
                    popup.className =
                      "fixed z-[70] w-64 rounded-md border border-border bg-popover text-popover-foreground shadow-md"
                    popup.dataset.suggestionOpen = "true"
                    popup.append(renderer.element)
                    document.body.append(popup)
                    position(props)
                  },
                  onUpdate: (props) => {
                    renderer?.updateProps(props)
                    position(props)
                  },
                  onKeyDown: (props) => {
                    if (props.event.key === "Escape") {
                      popup?.remove()
                      popup = null
                      return true
                    }
                    return renderer?.ref?.onKeyDown(props) ?? false
                  },
                  onExit: () => {
                    renderer?.destroy()
                    renderer = null
                    popup?.remove()
                    popup = null
                  },
                }
              },
            }),
          ]
        },
      }),
    ],
    content: templateToContent(value, multiline),
    editorProps: {
      attributes: {
        class: multiline
          ? "outline-none whitespace-pre-wrap min-h-12"
          : "outline-none whitespace-nowrap",
      },
      // Single line: Enter never inserts a paragraph (the suggestion popup
      // handles its own Enter before this runs).
      handleKeyDown: (_view, event) => {
        if (multiline) return false
        if (event.key !== "Enter") return false
        if (document.querySelector("[data-suggestion-open]")) return false
        event.preventDefault()
        return true
      },
    },
    onUpdate: ({ editor }) => {
      const next = docToTemplate(editor, multiline)
      lastEmitted.current = next
      onChange(next)
    },
  })

  // External writes (cURL import, switching tools) reset the doc; our own
  // emissions don't loop back.
  useEffect(() => {
    if (!editor || value === lastEmitted.current) return
    lastEmitted.current = value
    editor.commands.setContent(templateToContent(value, multiline))
  }, [editor, value, multiline])

  return (
    <div
      className={cn(
        "relative w-full min-w-0 cursor-text rounded-md border border-input bg-transparent px-2.5 py-1.5 font-mono text-xs shadow-xs transition-shadow focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30",
        className
      )}
    >
      {value === "" && (
        <span className="pointer-events-none absolute inset-x-2.5 top-1.5 truncate text-muted-foreground">
          {placeholder}
        </span>
      )}
      <EditorContent
        editor={editor}
        className={multiline ? undefined : "overflow-x-auto"}
      />
    </div>
  )
}
