import { Fragment, type Node as PMNode } from "@tiptap/pm/model"
import {
  type EditorState,
  Plugin,
  type PluginKey,
  TextSelection,
} from "@tiptap/pm/state"
import type { EditorView } from "@tiptap/pm/view"
import { type Command, Extension } from "@tiptap/react"
import { exitSuggestion } from "@tiptap/suggestion"

// Above HardBreak, ListItem, CodeBlock and the core keymap (all 100), so the
// composer decides Enter, Shift+Enter, Mod+Enter, Tab and Escape. Keys go
// through ProseMirror's keydown path, so IME composition never sends.
const COMPOSER_KEYMAP_PRIORITY = 101
// Suggestion plugins (@, /, $) run before the keymap: an open menu gets
// Enter, Tab, the arrows and Escape first.
export const SUGGESTION_PRIORITY = COMPOSER_KEYMAP_PRIORITY + 1

// A line that is only a code fence: ```, ```ts, ~~~.
const FENCE_LINE = /^\s*(?:`{3,}|~{3,})([\w#+.-]*)\s*$/

export interface ComposerKeymapOptions {
  // Suggestion plugins whose open menu owns Enter, Tab and Escape. A plugin
  // is active only while its menu has results (see `shouldShow`).
  suggestionKeys: readonly PluginKey[]
  // Enter sends; Cmd/Ctrl+Enter sends with `stay`.
  onSubmit: (stay: boolean) => void
  // Escape with no menu open. Returns whether it consumed the key.
  onEscape: () => boolean
  // Shift+Tab outside lists and code blocks (Claude Code's mode cycle).
  onShiftTab: () => boolean
  // Opens the link popover. Returns whether it opened.
  onLink: () => boolean
  // Up arrow in an empty editor. Returns whether it opened an edit.
  onEditLast: () => boolean
}

function isMenuOpen(state: EditorState, keys: readonly PluginKey[]) {
  return keys.some((key) => key.getState(state)?.active === true)
}

function closeMenus(view: EditorView, keys: readonly PluginKey[]) {
  for (const key of keys) {
    if (key.getState(view.state)?.active === true) exitSuggestion(view, key)
  }
}

// Enter or Shift+Enter on a line that is only a fence makes a code block in
// that language; the CodeBlock input rule needs a space after the fence. A
// line is a paragraph, or part of one split by hard breaks (pasted HTML).
const fenceToCodeBlock: Command = ({ tr, dispatch }) => {
  const codeBlock = tr.doc.type.schema.nodes.codeBlock
  const { $from, empty } = tr.selection
  const block = $from.parent
  if (!codeBlock || !empty || !block.isTextblock || block.type.spec.code) {
    return false
  }

  const start = $from.start()
  const end = $from.end()
  let lineStart = start
  let lineEnd = end
  block.forEach((child, offset) => {
    if (child.type.name !== "hardBreak") return
    const pos = start + offset
    if (pos < $from.pos) lineStart = pos + child.nodeSize
    else if (lineEnd === end) lineEnd = pos
  })
  const fence = FENCE_LINE.exec(
    tr.doc.textBetween(lineStart, lineEnd, "\n", "￼")
  )
  if (!fence) return false

  // Lines before and after the fence stay paragraphs around the block.
  const before = block.content.cut(0, Math.max(0, lineStart - 1 - start))
  const after =
    lineEnd < end ? block.content.cut(lineEnd + 1 - start) : Fragment.empty
  const code = codeBlock.create({ language: fence[1] || null })
  const nodes: PMNode[] = [
    ...(before.size ? [block.copy(before)] : []),
    code,
    ...(after.size ? [block.copy(after)] : []),
  ]
  const parent = $from.node(-1)
  const index = $from.index(-1)
  // A list item must open with a paragraph, so an empty one stays.
  if (!parent.canReplace(index, index + 1, Fragment.from(nodes))) {
    nodes.unshift(block.copy())
  }
  if (!parent.canReplace(index, index + 1, Fragment.from(nodes))) return false

  if (dispatch) {
    const from = $from.before()
    let codeStart = from
    for (const node of nodes) {
      if (node === code) break
      codeStart += node.nodeSize
    }
    tr.replaceWith(from, from + block.nodeSize, nodes)
    tr.setSelection(TextSelection.create(tr.doc, codeStart + 1))
    tr.scrollIntoView()
  }
  return true
}

// A third Shift+Enter at the end of a code block (two empty lines) leaves it
// for a paragraph below, as CodeBlock's exitOnTripleEnter does for Enter.
// With no trailing node, this and Arrow Down are how to get under a last block.
const exitCodeOnTripleEnter: Command = ({ tr, dispatch }) => {
  const { $from, empty } = tr.selection
  const block = $from.parent
  if (!empty || !block.type.spec.code) return false
  if ($from.parentOffset !== block.content.size) return false
  if (!block.textContent.endsWith("\n\n")) return false
  const paragraph = tr.doc.type.schema.nodes.paragraph
  if (!paragraph) return false

  if (dispatch) {
    const after = $from.after()
    tr.delete($from.pos - 2, $from.pos)
    const insertAt = tr.mapping.map(after)
    tr.insert(insertAt, paragraph.create())
    tr.setSelection(TextSelection.create(tr.doc, insertAt + 1))
    tr.scrollIntoView()
  }
  return true
}

// The chat composers' keys: Enter sends (in code blocks too) unless a
// suggestion menu with results is open, Shift+Enter is the editor's
// structural Enter, Cmd+Enter always sends.
export const ComposerKeymap = Extension.create<ComposerKeymapOptions>({
  name: "composerKeymap",
  priority: COMPOSER_KEYMAP_PRIORITY,

  addOptions() {
    return {
      suggestionKeys: [],
      onSubmit: () => undefined,
      onEscape: () => false,
      onShiftTab: () => false,
      onLink: () => false,
      onEditLast: () => false,
    }
  },

  addKeyboardShortcuts() {
    const menuOpen = () =>
      isMenuOpen(this.editor.state, this.options.suggestionKeys)
    const submit = () => {
      // The open menu picks its item before this runs. Never send a
      // half-typed mention.
      if (menuOpen()) return true
      if (this.editor.commands.command(fenceToCodeBlock)) return true
      this.options.onSubmit(false)
      return true
    }
    const submitAndStay = () => {
      // Sends past an open menu without picking from it.
      closeMenus(this.editor.view, this.options.suggestionKeys)
      this.options.onSubmit(true)
      return true
    }

    return {
      Enter: submit,
      "Alt-Enter": submit,
      "Mod-Enter": submitAndStay,
      // Mac: Ctrl+Enter stays too, as Cmd+Enter does.
      "Ctrl-Enter": submitAndStay,
      // A new line in code (inside a list item too), the next list item, an
      // empty item ends the list. Otherwise the editor's own Enter: a new
      // paragraph, so each line is its own and line-start shortcuts work on
      // every line (composer-markdown.ts stores them as lines); an empty line
      // in a quote leaves it.
      "Shift-Enter": () =>
        this.editor.commands.first(({ commands }) => [
          () => commands.command(exitCodeOnTripleEnter),
          () => commands.newlineInCode(),
          () => commands.command(fenceToCodeBlock),
          () => commands.splitListItem("listItem"),
          () => commands.liftListItem("listItem"),
          () => commands.createParagraphNear(),
          () => commands.liftEmptyBlock(),
          () => commands.splitBlock(),
        ]),
      // Code blocks indent themselves (enableTabIndentation). In a list Tab
      // stays in the editor even when the item can't indent (a first item).
      Tab: () => {
        if (this.editor.isActive("codeBlock")) return false
        if (!this.editor.isActive("listItem")) return false
        this.editor.commands.sinkListItem("listItem")
        return true
      },
      "Shift-Tab": () => {
        if (this.editor.isActive("codeBlock")) return false
        if (this.editor.isActive("listItem")) {
          this.editor.commands.liftListItem("listItem")
          return true
        }
        return this.options.onShiftTab()
      },
      Escape: () => !menuOpen() && this.options.onEscape(),
      // Cmd+K links a selection or edits the link at the caret; otherwise it
      // stays the workspace palette's, which skips handled (defaultPrevented)
      // keys. Cmd+Shift+U is Slack's link shortcut and works anywhere.
      "Mod-k": () => {
        const { empty } = this.editor.state.selection
        if (empty && !this.editor.isActive("link")) return false
        return this.options.onLink()
      },
      "Mod-Shift-u": () => this.options.onLink(),
      // Slack's and Discord's Up arrow: edit your last message, only from a
      // single empty line (an empty list item is still a draft).
      ArrowUp: () => {
        const { doc, selection } = this.editor.state
        const line = doc.firstChild
        if (menuOpen() || !selection.empty || doc.childCount !== 1) {
          return false
        }
        if (line?.type.name !== "paragraph" || line.content.size > 0) {
          return false
        }
        return this.options.onEditLast()
      },
    }
  },

  addProseMirrorPlugins() {
    const { editor } = this
    const keys = this.options.suggestionKeys
    return [
      new Plugin({
        props: {
          // Cmd/Ctrl+B bolds, and must not also reach the sidebar's Cmd+B
          // toggle on window (packages/ui sidebar.tsx).
          handleKeyDown: (_view, event) => {
            if (!(event.metaKey || event.ctrlKey)) return false
            if (event.key.toLowerCase() !== "b") return false
            event.stopPropagation()
            editor.commands.toggleBold()
            return true
          },
          handleDOMEvents: {
            // A menu left open here would float over, and hold keys from,
            // the next editor focused.
            blur: (view) => {
              closeMenus(view, keys)
              return false
            },
          },
        },
      }),
    ]
  },
})
