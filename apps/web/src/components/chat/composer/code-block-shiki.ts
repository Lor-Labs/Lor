import { CodeBlock } from "@tiptap/extension-code-block"
import type { Node as PMNode } from "@tiptap/pm/model"
import {
  type EditorState,
  Plugin,
  PluginKey,
  type Transaction,
} from "@tiptap/pm/state"
import { AttrStep } from "@tiptap/pm/transform"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import { ReactNodeViewRenderer } from "@tiptap/react"
import type { BundledLanguage, Highlighter, ThemedToken } from "shiki"
import {
  CodeBlockView,
  normalizeCodeLanguage,
} from "@/components/chat/composer/code-block-view"
import { CODE_THEMES } from "@/lib/code-themes"

// Composer code highlighting with the same Shiki themes, regex engine, and
// token styling as sent messages (nexus-ui/codeblock.tsx).
const TOKEN_CLASS =
  "text-(--sdm-c,inherit) dark:text-(--shiki-dark,var(--sdm-c,inherit))"

// Typing re-tokenizes after this pause, never inside the keystroke; the old
// colors are mapped through the edit meanwhile.
const RETOKENIZE_DELAY_MS = 100

type TokenSpec = { from: number; to: number; style: string }

type ShikiState = {
  decorations: DecorationSet
  // Start positions of code blocks waiting to be tokenized.
  pending: readonly number[]
  // A changed block shows no colors at all, so tokenize on the next frame.
  urgent: boolean
}

// Tokens for one block, computed against the state the meta is dispatched on.
type BlockResult = {
  pos: number
  node: PMNode | null
  decorations: Decoration[]
}

const shikiPluginKey = new PluginKey<ShikiState>("codeBlockShiki")

let highlighter: Highlighter | null = null
let highlighterPromise: Promise<Highlighter> | null = null
const loadedLanguages = new Set<string>()
const loadingLanguages = new Set<string>()
const failedLanguages = new Set<string>()
const refreshers = new Set<() => void>()

// ProseMirror reuses unchanged nodes across transactions, so a block that was
// only moved or refreshed keeps its tokens.
const tokenCache = new WeakMap<PMNode, TokenSpec[]>()

// Shiki loads on composer focus or with the first highlighted code block.
function loadHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= Promise.all([
    import("shiki"),
    import("shiki/engine/javascript"),
  ])
    .then(([{ createHighlighter }, { createJavaScriptRegexEngine }]) =>
      createHighlighter({
        themes: CODE_THEMES,
        langs: [],
        engine: createJavaScriptRegexEngine({ forgiving: true }),
      })
    )
    .then((instance) => {
      highlighter = instance
      return instance
    })
    .catch((error: unknown) => {
      // A failed chunk load (offline) may be retried by the next caller.
      highlighterPromise = null
      throw error
    })
  return highlighterPromise
}

function preloadHighlighter() {
  if (!highlighter) loadHighlighter().catch(() => undefined)
}

function ensureLanguage(lang: string) {
  if (loadingLanguages.has(lang)) return
  loadingLanguages.add(lang)
  loadHighlighter()
    .then((instance) => instance.loadLanguage(lang as BundledLanguage))
    .then(() => {
      loadedLanguages.add(lang)
    })
    .catch(() => {
      failedLanguages.add(lang)
    })
    .finally(() => {
      loadingLanguages.delete(lang)
      for (const refresh of refreshers) refresh()
    })
}

function highlightLanguage(node: PMNode): string | null {
  const lang = normalizeCodeLanguage(node.attrs.language)
  return lang && !failedLanguages.has(lang) ? lang : null
}

function tokenStyle(token: ThemedToken): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(token.htmlStyle ?? {})) {
    if (!value || key.includes("background") || key.endsWith("-bg")) continue
    parts.push(`${key === "color" ? "--sdm-c" : key}: ${value}`)
  }
  return parts.join("; ")
}

// Null while Shiki or the grammar loads; the load then refreshes editors.
function blockTokens(node: PMNode, lang: string): TokenSpec[] | null {
  const cached = tokenCache.get(node)
  if (cached) return cached
  if (!highlighter || !loadedLanguages.has(lang)) {
    ensureLanguage(lang)
    return null
  }
  const { tokens } = highlighter.codeToTokens(node.textContent, {
    lang: lang as BundledLanguage,
    themes: { light: CODE_THEMES[0], dark: CODE_THEMES[1] },
  })
  const specs: TokenSpec[] = []
  for (const line of tokens) {
    for (const token of line) {
      const style = tokenStyle(token)
      if (!style || !token.content) continue
      specs.push({
        from: token.offset,
        to: token.offset + token.content.length,
        style,
      })
    }
  }
  tokenCache.set(node, specs)
  return specs
}

function codeBlockPositions(doc: PMNode, typeName: string): number[] {
  const positions: number[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === typeName && highlightLanguage(node))
      positions.push(pos)
    return !node.isTextblock
  })
  return positions
}

// Textblocks a transaction touched, keyed by position in the new doc. Ranges
// grow by one so node-boundary steps (setNodeMarkup, joins) catch the block.
function touchedTextblocks(tr: Transaction): Map<number, PMNode> {
  const touched = new Map<number, PMNode>()
  const size = tr.doc.content.size
  const visit = (from: number, to: number) => {
    tr.doc.nodesBetween(
      Math.max(0, from - 1),
      Math.min(size, to + 1),
      (node, pos) => {
        if (!node.isTextblock) return true
        touched.set(pos, node)
        return false
      }
    )
  }
  tr.mapping.maps.forEach((map, index) => {
    const rest = tr.mapping.slice(index + 1)
    const step = tr.steps[index]
    // setNodeAttribute changes a node without a position map.
    if (step instanceof AttrStep) {
      const pos = rest.map(step.pos, 1)
      visit(pos, pos)
      return
    }
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      visit(rest.map(newStart, -1), rest.map(newEnd, 1))
    })
  })
  return touched
}

function applyTransaction(
  tr: Transaction,
  prev: ShikiState,
  typeName: string
): ShikiState {
  const results = tr.getMeta(shikiPluginKey) as BlockResult[] | undefined
  if (!tr.docChanged && !results) return prev

  let { decorations, pending } = prev
  let urgent = false
  if (tr.docChanged) {
    decorations = decorations.map(tr.mapping, tr.doc)
    const next = new Set(pending.map((pos) => tr.mapping.map(pos, 1)))
    for (const [pos, node] of touchedTextblocks(tr)) {
      const lang = node.type.name === typeName ? highlightLanguage(node) : null
      const current = decorations.find(pos + 1, pos + node.nodeSize - 1)
      // Drop colors from another language, and from text that is no longer
      // in a highlighted code block (toggled to a paragraph, joined, …).
      const stale = lang
        ? current.filter((deco) => deco.spec.lang !== lang)
        : current
      if (stale.length) decorations = decorations.remove(stale)
      if (!lang) continue
      next.add(pos)
      if (stale.length === current.length) urgent = true
    }
    pending = [...next]
  }

  if (results) {
    const done = new Set<number>()
    for (const result of results) {
      // Discard tokens for a block that changed after they were computed.
      if (result.node && tr.doc.nodeAt(result.pos) !== result.node) continue
      done.add(result.pos)
      if (!result.node) continue
      const start = result.pos + 1
      const end = result.pos + result.node.nodeSize - 1
      decorations = decorations
        .remove(decorations.find(start, end))
        .add(tr.doc, result.decorations)
    }
    pending = pending.filter((pos) => !done.has(pos))
  }

  return { decorations, pending, urgent }
}

function tokenizePending(state: EditorState, typeName: string): BlockResult[] {
  const results: BlockResult[] = []
  const pending = shikiPluginKey.getState(state)?.pending ?? []
  for (const pos of new Set(pending)) {
    const node = state.doc.nodeAt(pos)
    if (node?.type.name !== typeName) {
      results.push({ pos, node: null, decorations: [] })
      continue
    }
    const lang = highlightLanguage(node)
    const specs = lang ? blockTokens(node, lang) : []
    // Still loading: stays pending until the load refreshes this editor.
    if (!specs) continue
    results.push({
      pos,
      node,
      decorations: specs.map((spec) =>
        Decoration.inline(
          pos + 1 + spec.from,
          pos + 1 + spec.to,
          { class: TOKEN_CLASS, style: spec.style },
          { lang }
        )
      ),
    })
  }
  return results
}

// Use as-is (configure only, never .extend()): Tiptap's extend() copies the
// parent config, so a child would run addProseMirrorPlugins twice and register
// the keyed Shiki plugin twice ("Adding different instances of a keyed plugin").
export const CodeBlockShiki = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView, {
      // Typing replaces the node on every keystroke; only the language shows
      // in the header, so content edits skip the React render.
      update: ({ oldNode, newNode, updateProps }) => {
        if (oldNode.attrs.language !== newNode.attrs.language) updateProps()
        return true
      },
    })
  },
  renderMarkdown(node, helpers, ctx) {
    const language = normalizeCodeLanguage(node.attrs?.language)
    return (
      this.parent?.(
        { ...node, attrs: { ...node.attrs, language } },
        helpers,
        ctx
      ) ?? ""
    )
  },
  addProseMirrorPlugins() {
    const typeName = this.name
    return [
      ...(this.parent?.() ?? []),
      new Plugin<ShikiState>({
        key: shikiPluginKey,
        state: {
          init: (_, { doc }) => ({
            decorations: DecorationSet.empty,
            pending: codeBlockPositions(doc, typeName),
            urgent: true,
          }),
          apply: (tr, prev) => applyTransaction(tr, prev, typeName),
        },
        props: {
          decorations: (state) => shikiPluginKey.getState(state)?.decorations,
          handleDOMEvents: {
            focus: () => {
              preloadHighlighter()
              return false
            },
          },
        },
        view: (view) => {
          let frame = 0
          let timer: ReturnType<typeof setTimeout> | undefined
          const cancel = () => {
            if (frame) cancelAnimationFrame(frame)
            clearTimeout(timer)
            frame = 0
            timer = undefined
          }
          const flush = () => {
            cancel()
            if (view.isDestroyed) return
            // Wait out IME composition so a cosmetic redraw never touches the
            // text being composed.
            if (view.composing) {
              timer = setTimeout(flush, RETOKENIZE_DELAY_MS)
              return
            }
            const results = tokenizePending(view.state, typeName)
            if (results.length)
              view.dispatch(view.state.tr.setMeta(shikiPluginKey, results))
          }
          const schedule = (urgent: boolean) => {
            if (frame) return
            clearTimeout(timer)
            if (urgent) frame = requestAnimationFrame(flush)
            else timer = setTimeout(flush, RETOKENIZE_DELAY_MS)
          }
          // A grammar finished loading: tokenize the blocks waiting on it.
          refreshers.add(flush)
          if (shikiPluginKey.getState(view.state)?.pending.length)
            schedule(true)
          return {
            update: (_view, prevState) => {
              const state = shikiPluginKey.getState(view.state)
              if (
                state?.pending.length &&
                state !== shikiPluginKey.getState(prevState)
              )
                schedule(state.urgent)
            },
            destroy: () => {
              cancel()
              refreshers.delete(flush)
            },
          }
        },
      }),
    ]
  },
})
