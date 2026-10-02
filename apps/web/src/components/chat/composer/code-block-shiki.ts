import { CodeBlock } from "@tiptap/extension-code-block"
import type { Node as PMNode } from "@tiptap/pm/model"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import type { BundledLanguage, Highlighter, ThemedToken } from "shiki"
import { LANGUAGE_ALIAS_MAP } from "@/components/chat/composer/code-block-view"
import { CODE_THEMES } from "@/lib/code-themes"

// Composer code highlighting with the same Shiki themes, regex engine, and
// token styling as sent messages (nexus-ui/codeblock.tsx).
const TOKEN_CLASS =
  "text-(--sdm-c,inherit) dark:text-(--shiki-dark,var(--sdm-c,inherit))"

type TokenSpec = { from: number; to: number; style: string }

let highlighter: Highlighter | null = null
let highlighterPromise: Promise<Highlighter> | null = null
const loadingLanguages = new Set<string>()
const failedLanguages = new Set<string>()
const refreshers = new Set<() => void>()

// ProseMirror reuses unchanged nodes across transactions, so typing
// re-tokenizes only the code block being edited.
const tokenCache = new WeakMap<PMNode, TokenSpec[]>()

// Shiki loads with the first highlighted code block, not with the composer.
function ensureLanguage(lang: string) {
  if (loadingLanguages.has(lang)) return
  loadingLanguages.add(lang)
  highlighterPromise ??= Promise.all([
    import("shiki"),
    import("shiki/engine/javascript"),
  ]).then(([{ createHighlighter }, { createJavaScriptRegexEngine }]) =>
    createHighlighter({
      themes: CODE_THEMES,
      langs: [],
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    })
  )
  highlighterPromise
    .then(async (instance) => {
      highlighter = instance
      await instance.loadLanguage(lang as BundledLanguage)
    })
    .catch(() => failedLanguages.add(lang))
    .finally(() => {
      loadingLanguages.delete(lang)
      for (const refresh of refreshers) refresh()
    })
}

function resolveLanguage(node: PMNode): string | null {
  const raw = (node.attrs.language as string | null)?.toLowerCase()
  if (!raw) return null
  const lang = LANGUAGE_ALIAS_MAP[raw] ?? raw
  if (lang === "plaintext" || lang === "text" || failedLanguages.has(lang))
    return null
  return lang
}

function tokenStyle(token: ThemedToken): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(token.htmlStyle ?? {})) {
    if (!value || key.includes("background") || key.endsWith("-bg")) continue
    parts.push(`${key === "color" ? "--sdm-c" : key}: ${value}`)
  }
  return parts.join("; ")
}

function blockTokens(node: PMNode, lang: string): TokenSpec[] | null {
  const cached = tokenCache.get(node)
  if (cached) return cached
  if (!highlighter?.getLoadedLanguages().includes(lang)) {
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

function buildDecorations(doc: PMNode, typeName: string): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== typeName) return true
    const lang = resolveLanguage(node)
    const specs = lang ? blockTokens(node, lang) : null
    for (const spec of specs ?? []) {
      decorations.push(
        Decoration.inline(pos + 1 + spec.from, pos + 1 + spec.to, {
          class: TOKEN_CLASS,
          style: spec.style,
        })
      )
    }
    return false
  })
  return DecorationSet.create(doc, decorations)
}

const shikiPluginKey = new PluginKey<DecorationSet>("codeBlockShiki")

export const CodeBlockShiki = CodeBlock.extend({
  addProseMirrorPlugins() {
    const typeName = this.name
    return [
      ...(this.parent?.() ?? []),
      new Plugin<DecorationSet>({
        key: shikiPluginKey,
        state: {
          init: (_, { doc }) => buildDecorations(doc, typeName),
          apply: (tr, decorations, _oldState, newState) =>
            tr.docChanged || tr.getMeta(shikiPluginKey)
              ? buildDecorations(newState.doc, typeName)
              : decorations,
        },
        props: {
          decorations: (state) => shikiPluginKey.getState(state),
        },
        // A language finished loading: rebuild decorations for this editor.
        view: (view) => {
          const refresh = () => {
            if (!view.isDestroyed)
              view.dispatch(view.state.tr.setMeta(shikiPluginKey, true))
          }
          refreshers.add(refresh)
          return { destroy: () => refreshers.delete(refresh) }
        },
      }),
    ]
  },
})
