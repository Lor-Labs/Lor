import { MESSAGE_CONTENT_MAX_LENGTH } from "@repo/realtime-types"
import { toast } from "@repo/ui/components/toast"
import { Fragment, type Mark, type Schema, Slice } from "@tiptap/pm/model"
import { type EditorState, Plugin, PluginKey } from "@tiptap/pm/state"
import type { EditorView } from "@tiptap/pm/view"
import { type Editor, Extension, type JSONContent } from "@tiptap/react"
import { toStoredMarkdown, warnIfTooLong } from "@/lib/editor-utils"
import { hasLinearIssue } from "@/lib/linear-issue-block"

// Paste pipeline for the chat editors, in Outline's and Campsite's order:
// files, long text, code, Shift (plain), Linear issues and single URLs (their
// own handlers), VS Code, ProseMirror and Claude.ai HTML, markdown-looking
// text, then ProseMirror's default.

// Pastes longer than this become a .txt attachment instead of inline text,
// matching ChatGPT/Claude/Discord. Keeps the editor responsive and stays well
// under MESSAGE_CONTENT_MAX_LENGTH.
const LARGE_PASTE_CHAR_THRESHOLD = 4000
const LARGE_PASTE_FILENAME = "pasted-text.txt"
const LARGE_PASTE_TOAST_MS = 8000
const SINGLE_URL = /^https?:\/\/\S+$/i

export interface ComposerPasteOptions {
  // Adds the files as attachments. False where the editor has none (the
  // message edit box), so the paste goes on as text.
  attachFiles: (files: File[]) => boolean
  // Removes a pasted file that is still waiting to be sent.
  detachFile: (file: File) => boolean
}

let parsingPastedMarkdown = false
// headingAsText (composer-extensions.ts) makes a pasted heading a bold line
// instead of literal "# " text.
export function isParsingPastedMarkdown() {
  return parsingPastedMarkdown
}

// Code pasted without fences: statement ends, keywords, comments, tags,
// shell prompts, indented bodies and YAML keys. A "# comment" reads as a
// heading, so code never counts as markdown.
const CODE_LINES = [
  /[;{}]\s*$|=>/,
  /^\s*(?:import|export|from|const|let|var|function|def|class|return|async|await|package|public|private|fn|func|struct|impl)\s/,
  /^\s*(?:\/\/|\/\*|\*\/|<\/?[a-z][\w-]*[\s>/]|\$ )/i,
  /^(?: {2,}|\t)(?![-*+]\s|\d{1,9}[.)]\s)\S/,
  /^\s*[\w.-]+:(?:\s|$)/,
]

function looksLikeCode(lines: string[]) {
  const filled = lines.filter((line) => line.trim())
  const code = filled.filter((line) =>
    CODE_LINES.some((pattern) => pattern.test(line))
  ).length
  return code >= 2 && code / filled.length >= 0.4
}

// Outline's signal count (shared/editor/lib/isMarkdown.ts) plus quotes,
// ordered lists and bold. Always at least two signals, so one stray "- " or
// "# comment" stays text. Fences count double, so one long fenced snippet
// converts on its own.
function isMarkdown(text: string) {
  const lines = text.split("\n")
  const count = (pattern: RegExp) => text.match(pattern)?.length ?? 0
  const fences = count(/^ {0,3}(?:```|~~~)/gm)
  if (fences < 2 && looksLikeCode(lines)) return false
  const signals =
    (fences > 1 ? fences * 2 : 0) +
    count(/^ {0,3}#{2,6}[ \t]+\S/gm) +
    count(/^ {0,3}#[ \t]+\S/gm) / 2 +
    count(/^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\S/gm) +
    count(/^ {0,3}>[ \t]?\S/gm) +
    count(/\[[^\]\n]+\]\((?:https?:\/\/|\/)[^\s)]+\)/g) * 2 +
    count(/(\*\*|__)(?=\S)[^\n]*?\S\1/g) +
    count(/\|[ \t]*:?-+:?[ \t]*\|/g)
  return signals > Math.max(1, Math.min(3, Math.floor(lines.length / 5)))
}

// Blank lines around the paste are dropped; the ones inside stay.
function trimBlankLines(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/^(?:[ \t]*\n)+/, "")
    .replace(/(?:\n[ \t]*)+$/, "")
}

// One paragraph per line and an empty one per blank line (ProseMirror's own
// text paste drops blank lines). Open at both ends, so a single line goes
// inline and the first and last lines join the text around the caret.
function lineSlice(schema: Schema, text: string, marks: readonly Mark[]) {
  const { paragraph } = schema.nodes
  if (!paragraph) return Slice.empty
  const lines = trimBlankLines(text).split("\n")
  return new Slice(
    Fragment.from(
      lines.map((line) =>
        paragraph.create(null, line ? schema.text(line, marks) : null)
      )
    ),
    1,
    1
  )
}

function isEmptyParagraph(node: JSONContent | undefined) {
  return node?.type === "paragraph" && !node.content?.length
}

// Through the editor's markdown manager (ComposerMarkdown: lines, blank
// lines, `<@id>` mentions). One line converts only to inline formatting, so
// "1. Do this" pasted mid-sentence never splits it into a list.
function markdownSlice(editor: Editor, text: string): Slice | null {
  const manager = editor.markdown
  if (!manager) return null
  const source = trimBlankLines(text)
  parsingPastedMarkdown = true
  try {
    const content = manager.parse(source).content ?? []
    while (isEmptyParagraph(content[0])) content.shift()
    while (isEmptyParagraph(content.at(-1))) content.pop()
    if (
      !source.includes("\n") &&
      (content.length !== 1 || content[0]?.type !== "paragraph")
    ) {
      return null
    }
    const fragment = Fragment.fromArray(
      content.map((node) => editor.schema.nodeFromJSON(node))
    )
    if (!fragment.childCount) return null
    const isParagraph = (index: number) =>
      fragment.child(index).type.name === "paragraph"
    return new Slice(
      fragment,
      isParagraph(0) ? 1 : 0,
      isParagraph(fragment.childCount - 1) ? 1 : 0
    )
  } catch {
    return null
  } finally {
    parsingPastedMarkdown = false
  }
}

function contextMarks(state: EditorState) {
  return state.storedMarks ?? state.selection.$from.marks()
}

// No paste rules: the text is final (no chips, links or mark conversion).
function insertSlice(view: EditorView, slice: Slice) {
  view.dispatch(
    view.state.tr
      .replaceSelection(slice)
      .scrollIntoView()
      .setMeta("paste", true)
  )
}

// Into a code block or inline code the text goes in as typed: newlines stay
// inside the block, and nothing becomes a chip, link, mention or markdown.
function insertIntoCode(view: EditorView, text: string) {
  const { state } = view
  if (state.selection.$from.parent.type.spec.code) {
    view.dispatch(
      state.tr
        .insertText(text.replace(/\r\n?/g, "\n"))
        .scrollIntoView()
        .setMeta("paste", true)
    )
    return true
  }
  const marks = contextMarks(state)
  if (!marks.some((mark) => mark.type.spec.code)) return false
  insertSlice(view, lineSlice(state.schema, text, marks))
  return true
}

// "Paste as text instead" after a long paste became a file.
function pasteAsText(view: EditorView, editor: Editor, text: string) {
  if (insertIntoCode(view, text)) return
  const { state } = view
  insertSlice(
    view,
    (isMarkdown(trimBlankLines(text)) && markdownSlice(editor, text)) ||
      lineSlice(state.schema, text, contextMarks(state))
  )
}

function vscodeMode(data: DataTransfer): string | null {
  const raw = data.getData("vscode-editor-data")
  if (!raw) return null
  try {
    const mode: unknown = JSON.parse(raw).mode
    return typeof mode === "string" ? mode : null
  } catch {
    return null
  }
}

function isZero(value: string) {
  return value !== "" && Number.parseFloat(value) === 0
}

// HTML from other apps, before ProseMirror parses it. There is no heading
// node, so a heading becomes a bold line; its spans' own font-weight would
// clear the bold (Google Docs sets 400). Google Docs wraps the whole copy in
// <b style="font-weight:normal" id="docs-internal-guid-...">. Two <p> in a row
// get an empty line between, as two markdown paragraphs do on load
// (composer-markdown.ts), unless both set zero margins (Google Docs lines).
function cleanPastedHTML(html: string) {
  const fromProseMirror = html.includes("data-pm-slice")
  if (
    !/<h[1-6][\s>]|docs-internal-guid/i.test(html) &&
    (fromProseMirror || !/<\/p>\s*<p[\s>]/i.test(html))
  ) {
    return html
  }
  const doc = new window.DOMParser().parseFromString(html, "text/html")
  for (const wrapper of Array.from(
    doc.querySelectorAll('b[id^="docs-internal-guid"]')
  )) {
    wrapper.replaceWith(...Array.from(wrapper.childNodes))
  }
  for (const heading of Array.from(
    doc.body.querySelectorAll("h1, h2, h3, h4, h5, h6")
  )) {
    const paragraph = doc.createElement("p")
    for (const { name, value } of Array.from(heading.attributes)) {
      paragraph.setAttribute(name, value)
    }
    const strong = doc.createElement("strong")
    strong.append(...Array.from(heading.childNodes))
    paragraph.append(strong)
    for (const element of [
      paragraph,
      ...Array.from(paragraph.querySelectorAll<HTMLElement>("[style]")),
    ]) {
      element.style.removeProperty("font-weight")
    }
    heading.replaceWith(paragraph)
  }
  if (!fromProseMirror) {
    for (const paragraph of Array.from(
      doc.body.querySelectorAll<HTMLElement>("p")
    )) {
      const next = paragraph.nextElementSibling
      if (
        next instanceof HTMLElement &&
        next.tagName === "P" &&
        paragraph.textContent?.trim() &&
        next.textContent?.trim() &&
        !(isZero(paragraph.style.marginBottom) && isZero(next.style.marginTop))
      ) {
        paragraph.after(doc.createElement("p"))
      }
    }
  }
  const styles = Array.from(
    doc.head.querySelectorAll("style"),
    (style) => style.outerHTML
  ).join("")
  return styles + doc.body.innerHTML
}

export const ComposerPaste = Extension.create<ComposerPasteOptions>({
  name: "composerPaste",
  // Before ConnectorChip (1100), Link and CodeBlock's VS Code paste, which
  // still take every paste this one passes on.
  priority: 1200,

  addOptions() {
    return {
      attachFiles: () => false,
      detachFile: () => false,
    }
  },

  addProseMirrorPlugins() {
    const { editor, options } = this
    // Shift held (Cmd+Shift+V) means plain text, tracked the way
    // prosemirror-view does (its own flag is internal). Shift+Insert is an
    // ordinary paste.
    let shiftKey = false
    let insertKey = false

    const pasteAsFile = (view: EditorView, text: string) => {
      const file = new File([text], LARGE_PASTE_FILENAME, {
        type: "text/plain",
      })
      if (!options.attachFiles([file])) return false
      const title = `Long paste added as ${LARGE_PASTE_FILENAME}`
      if (text.length > MESSAGE_CONTENT_MAX_LENGTH) {
        toast(title, { description: "It's too long to send as a message." })
        return true
      }
      toast(title, {
        timeout: LARGE_PASTE_TOAST_MS,
        action: {
          label: "Paste as text instead",
          onClick: () => {
            if (view.isDestroyed) return
            // Inline, the draft would be over the limit, so the file stays.
            const draft = toStoredMarkdown(editor.getMarkdown()).trim()
            if (warnIfTooLong(`${draft}${text}`)) return
            // Gone once sent or removed: the text is not pasted twice.
            if (!options.detachFile(file)) return
            view.focus()
            pasteAsText(view, editor, text)
          },
        },
      })
      return true
    }

    return [
      new Plugin({
        key: new PluginKey("composerPaste"),
        props: {
          handleDOMEvents: {
            keydown: (_view, event) => {
              shiftKey = event.key === "Shift" || event.shiftKey
              insertKey = event.key === "Insert"
              return false
            },
            keyup: (_view, event) => {
              if (event.key === "Shift") shiftKey = false
              return false
            },
            mousedown: (_view, event) => {
              shiftKey = event.shiftKey
              return false
            },
          },
          transformPastedHTML: cleanPastedHTML,
          // Text with no HTML, or a plain paste. Code blocks never get here.
          clipboardTextParser: (text, $context) =>
            lineSlice($context.doc.type.schema, text, $context.marks()),
          handlePaste: (view, event) => {
            const data = event.clipboardData
            if (!data) return false
            // A screenshot copied with text, or a copied file with its name:
            // only the files.
            if (
              data.files.length &&
              options.attachFiles(Array.from(data.files))
            ) {
              return true
            }

            const text = data.getData("text/plain")
            if (!text) return false
            // A long Linear issue still becomes its card (LinearIssue).
            if (
              text.length > LARGE_PASTE_CHAR_THRESHOLD &&
              !(
                text.length <= MESSAGE_CONTENT_MAX_LENGTH &&
                hasLinearIssue(text)
              ) &&
              pasteAsFile(view, text)
            ) {
              return true
            }
            if (insertIntoCode(view, text)) return true
            if (shiftKey && !insertKey) {
              insertSlice(
                view,
                lineSlice(view.state.schema, text, contextMarks(view.state))
              )
              return true
            }
            if (hasLinearIssue(text) || SINGLE_URL.test(text.trim())) {
              return false
            }

            const mode = vscodeMode(data)
            if (mode && mode !== "markdown") {
              // Several lines: CodeBlock's VS Code paste makes a block in
              // that language. One line is inline code, or text from a
              // plain text file.
              if (trimBlankLines(text).includes("\n")) return false
              const { state } = view
              const code = state.schema.marks.code
              insertSlice(
                view,
                lineSlice(
                  state.schema,
                  text,
                  mode === "plaintext" || !code
                    ? contextMarks(state)
                    : [code.create()]
                )
              )
              return true
            }

            const html = data.getData("text/html")
            if (
              html.includes("data-pm-slice") ||
              html.includes("font-claude-response-body")
            ) {
              return false
            }
            if (mode === "markdown" || isMarkdown(trimBlankLines(text))) {
              const slice = markdownSlice(editor, text)
              if (slice) {
                insertSlice(view, slice)
                return true
              }
            }
            return false
          },
        },
      }),
    ]
  },
})
