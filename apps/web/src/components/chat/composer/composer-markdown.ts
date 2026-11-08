import { Markdown } from "@tiptap/markdown"
import type { JSONContent } from "@tiptap/react"

// The chat editors keep one paragraph per line, so every line-start shortcut
// (- , 1. , ```, > ) works on every line. Stored message markdown joins
// adjacent lines into one paragraph with hard breaks ("  \n"), so they render
// as consecutive lines, and an empty line becomes a paragraph break; TipTap's
// Paragraph writes `&nbsp;` for each further empty line in a row, so blank
// lines never collapse (TipTap #8478). Loading does the reverse.

type Line = JSONContent[]

// Marks a line start in the serializer's output, where block markers are
// escaped once TipTap has written and escaped the line.
const LINE_START = "\uE002"
const LINE_START_NODE: JSONContent = { type: "text", text: LINE_START }
const LINE_START_TEXT = new RegExp(`${LINE_START}([^\\n]*)`, "g")

// Block markers CommonMark reads at a line start, which these editors show as
// plain text. TipTap already escapes * _ ` ~ [ and encodes > < &, so a typed
// "> " or "* " is literal without help.
const LINE_START_MARKERS = [
  // "# " heading, "- " or "+ " item.
  /^([ \u00A0]{0,3})(#{1,6}|[-+])(?=[ \t\u00A0]|$)/,
  // "1. " or "1) " item: the escape goes before the delimiter.
  /^([ \u00A0]{0,3}\d{1,9})([.)])(?=[ \t\u00A0]|$)/,
  // Table row.
  /^([ \u00A0]{0,3})(\|)/,
  // Rule, setext heading underline or table delimiter row: ---, ===, :-|-:.
  /^([ \u00A0]{0,3})([-=:])(?=[-=:| \t\u00A0]*$)/,
]

// A paragraph's inline content split at hard breaks and newlines in text.
function splitLines(content: JSONContent[] = []): Line[] {
  const lines: Line[] = [[]]
  for (const node of content) {
    if (node.type === "hardBreak") {
      lines.push([])
    } else if (node.type === "text" && node.text?.includes("\n")) {
      node.text.split("\n").forEach((text, index) => {
        if (index > 0) lines.push([])
        if (text) lines.at(-1)?.push({ ...node, text })
      })
    } else {
      lines.at(-1)?.push(node)
    }
  }
  return lines
}

function isBlank(line: Line) {
  return line.every(
    (node) => node.type === "text" && !/\S/.test(node.text ?? "")
  )
}

function isEmptyParagraph(node: JSONContent | undefined) {
  return node?.type === "paragraph" && !node.content?.length
}

function hasLine(node: JSONContent | undefined) {
  return (
    node?.type === "paragraph" &&
    splitLines(node.content).some((line) => !isBlank(line))
  )
}

// Trailing spaces before a stored hard break or paragraph end.
function trimEnd(line: Line): Line {
  const last = line.at(-1)
  if (last?.type !== "text" || last.marks?.length) return line
  const text = (last.text ?? "").replace(/[ \t]+$/, "")
  return text ? [...line.slice(0, -1), { ...last, text }] : line.slice(0, -1)
}

// Editor lines → markdown paragraphs: adjacent lines join with hard breaks.
function joinLines(nodes: JSONContent[]): JSONContent[] {
  const joined: JSONContent[] = []
  let paragraph: JSONContent | null = null
  for (const node of nodes) {
    if (node.type !== "paragraph") {
      paragraph = null
      joined.push(
        node.content ? { ...node, content: joinLines(node.content) } : node
      )
      continue
    }
    for (const line of splitLines(node.content)) {
      if (isBlank(line)) {
        paragraph = null
        joined.push({ type: "paragraph" })
      } else if (paragraph) {
        paragraph.content?.push({ type: "hardBreak" }, LINE_START_NODE, ...line)
      } else {
        paragraph = { ...node, content: [LINE_START_NODE, ...line] }
        joined.push(paragraph)
      }
    }
  }
  return joined
}

function toMarkdownDoc(doc: JSONContent): JSONContent {
  const content = joinLines(doc.content ?? [])
  // A trailing Shift+Enter or TrailingNode's empty line is not sent.
  while (isEmptyParagraph(content[0])) content.shift()
  while (isEmptyParagraph(content.at(-1))) content.pop()
  return { ...doc, content }
}

function escapeLineStarts(markdown: string) {
  return markdown.replace(LINE_START_TEXT, (_match, line: string) => {
    const marker = LINE_START_MARKERS.find((pattern) => pattern.test(line))
    return marker ? line.replace(marker, "$1\\$2") : line
  })
}

// Markdown paragraphs → editor lines. Two paragraphs in a row were separated
// by a blank line (old messages, pasted text), so an empty line goes between.
function splitParagraphs(nodes: JSONContent[]): JSONContent[] {
  return nodes.flatMap((node, index): JSONContent[] => {
    if (node.type !== "paragraph") {
      return [
        node.content
          ? { ...node, content: splitParagraphs(node.content) }
          : node,
      ]
    }
    const lines = splitLines(node.content)
      .map(trimEnd)
      .map((line) =>
        isBlank(line) ? { type: "paragraph" } : { ...node, content: line }
      )
    return hasLine(nodes[index - 1]) && hasLine(node)
      ? [{ type: "paragraph" }, ...lines]
      : lines
  })
}

function toEditorDoc(doc: JSONContent): JSONContent {
  return { ...doc, content: splitParagraphs(doc.content ?? []) }
}

function isDocJSON(content: unknown): content is JSONContent {
  return (
    typeof content === "object" &&
    content !== null &&
    (content as JSONContent).type === "doc"
  )
}

// Markdown for the chat editors: editor.getMarkdown(), and every markdown
// load (contentType: "markdown", editor.markdown.parse), go through the line
// model above.
export const ComposerMarkdown = Markdown.extend({
  onBeforeCreate(event) {
    this.parent?.(event)
    const { editor } = this
    const manager = editor.markdown
    if (!manager) return
    const parse = manager.parse.bind(manager)
    const serialize = manager.serialize.bind(manager)
    manager.parse = (markdown) => toEditorDoc(parse(markdown))
    manager.serialize = (doc) => escapeLineStarts(serialize(toMarkdownDoc(doc)))
    // The parent parsed initial markdown content before parse was wrapped.
    const { content, contentType } = editor.options
    if (contentType === "markdown" && isDocJSON(content)) {
      editor.options.content = toEditorDoc(content)
    }
  },
})
