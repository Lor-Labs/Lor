"use client"

// Vendored from the tool-ui registry (@tool-ui/code-block), collapsed to a
// single file: schema/contract layers dropped (props are plain types), Radix
// swapped for this repo's Base UI button/collapsible, themes in
// ./pierre-themes.
import { Button } from "@repo/ui/components/button"
import {
  Collapsible,
  CollapsibleTrigger,
} from "@repo/ui/components/collapsible"
import { cn } from "@repo/ui/lib/utils"
import { Check, ChevronDown, ChevronUp, Copy } from "lucide-react"
import {
  type CSSProperties,
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useState,
} from "react"
import {
  createHighlighter,
  createJavaScriptRegexEngine,
  type Highlighter,
  type ThemedToken,
} from "shiki"
import { pierreDarkTheme, pierreLightTheme } from "./pierre-themes.js"

export type CodeBlockLineNumbersMode = "visible" | "hidden"

export type CodeBlockProps = {
  id: string
  code: string
  language?: string
  lineNumbers?: CodeBlockLineNumbersMode
  filename?: string
  highlightLines?: number[]
  maxCollapsedLines?: number
  className?: string
}

const COPY_ID = "codeblock-code"
const MAX_TOKEN_CACHE_ENTRIES = 64

function fallbackCopyToClipboard(text: string): boolean {
  const textArea = document.createElement("textarea")
  try {
    textArea.value = text
    textArea.setAttribute("readonly", "")
    textArea.style.position = "fixed"
    textArea.style.top = "-9999px"
    textArea.style.left = "-9999px"
    document.body.appendChild(textArea)
    textArea.select()
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    if (textArea.parentNode) {
      textArea.parentNode.removeChild(textArea)
    }
  }
}

function useCopyToClipboard(options?: { resetAfterMs?: number }): {
  copiedId: string | null
  copy: (text: string, id?: string) => Promise<boolean>
} {
  const resetAfterMs = options?.resetAfterMs ?? 2000
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const copy = useCallback(async (text: string, id: string = "default") => {
    let ok = false
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        ok = true
      } else {
        ok = fallbackCopyToClipboard(text)
      }
    } catch {
      ok = fallbackCopyToClipboard(text)
    }

    if (ok) {
      setCopiedId(id)
    }

    return ok
  }, [])

  useEffect(() => {
    if (!copiedId) return
    const timeout = setTimeout(() => setCopiedId(null), resetAfterMs)
    return () => clearTimeout(timeout)
  }, [copiedId, resetAfterMs])

  return { copiedId, copy }
}

let highlighterPromise: Promise<Highlighter> | null = null

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    const created = createHighlighter({
      themes: [pierreDarkTheme, pierreLightTheme],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    })
    highlighterPromise = created
    // Drop a failed creation so the next highlight can retry instead of
    // caching the rejection forever.
    created.catch(() => {
      if (highlighterPromise === created) highlighterPromise = null
    })
  }
  return highlighterPromise
}

// Token lines instead of shiki's HTML string: rendered as React elements so
// nothing goes through dangerouslySetInnerHTML.
type TokenLines = ThemedToken[][]

const tokenCache = new Map<string, TokenLines>()

function getCacheKey(code: string, language: string, theme: string): string {
  return JSON.stringify({ code, language, theme })
}

function setCachedTokens(cacheKey: string, tokens: TokenLines): void {
  if (tokenCache.has(cacheKey)) {
    tokenCache.set(cacheKey, tokens)
    return
  }

  if (tokenCache.size >= MAX_TOKEN_CACHE_ENTRIES) {
    const oldestKey = tokenCache.keys().next().value
    if (typeof oldestKey === "string") {
      tokenCache.delete(oldestKey)
    }
  }

  tokenCache.set(cacheKey, tokens)
}

// Plain-text fallback when a language fails to load: one uncolored token per line.
function plainTokens(code: string): TokenLines {
  return code.split("\n").map((line) => [{ content: line, offset: 0 }])
}

const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  python: "Python",
  tsx: "TSX",
  jsx: "JSX",
  json: "JSON",
  bash: "Bash",
  shell: "Shell",
  css: "CSS",
  html: "HTML",
  markdown: "Markdown",
  sql: "SQL",
  yaml: "YAML",
  go: "Go",
  rust: "Rust",
  text: "Plain Text",
}

function getLanguageDisplayName(lang: string): string {
  return LANGUAGE_DISPLAY_NAMES[lang.toLowerCase()] || lang.toUpperCase()
}

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light"
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"
}

function getDocumentTheme(): "light" | "dark" | null {
  if (typeof document === "undefined") return null
  const root = document.documentElement
  const dataTheme = root.getAttribute("data-theme")?.toLowerCase()
  if (dataTheme === "dark") return "dark"
  if (dataTheme === "light") return "light"
  if (root.classList.contains("dark")) return "dark"
  if (root.classList.contains("light")) return "light"
  return null
}

function useResolvedTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    return getDocumentTheme() ?? getSystemTheme()
  })

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return
    }

    const update = () => setTheme(getDocumentTheme() ?? getSystemTheme())

    const mql = window.matchMedia?.("(prefers-color-scheme: dark)")
    mql?.addEventListener("change", update)

    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    })

    return () => {
      mql?.removeEventListener("change", update)
      observer.disconnect()
    }
  }, [])

  return theme
}

export type CodeBlockRootProps = CodeBlockProps & {
  children: ReactNode
  expanded?: boolean
  defaultExpanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
}

type CodeBlockSharedState = {
  id: string
  code: string
  language: string
  filename?: string
  tokens: TokenLines | null
  showLineNumbers: boolean
  highlightLines?: number[]
  resolvedTheme: "light" | "dark"
  isCopied: boolean
  copyCode: () => void
  lineCount: number
  isCollapsed: boolean
  shouldCollapse: boolean
  toggleExpanded: () => void
}

const CodeBlockContext = createContext<CodeBlockSharedState | null>(null)

function useCodeBlock(): CodeBlockSharedState {
  const context = use(CodeBlockContext)
  if (!context) {
    throw new Error(
      "CodeBlock subcomponents must be used within <CodeBlock.Root>."
    )
  }
  return context
}

function CodeBlockRoot({
  id,
  code,
  language = "text",
  lineNumbers = "visible",
  filename,
  highlightLines,
  maxCollapsedLines,
  className,
  children,
  expanded: expandedProp,
  defaultExpanded = false,
  onExpandedChange,
}: CodeBlockRootProps) {
  const resolvedTheme = useResolvedTheme()
  const [expandedState, setExpandedState] = useState(defaultExpanded)
  const { copiedId, copy } = useCopyToClipboard()
  const isCopied = copiedId === COPY_ID

  const expanded = expandedProp ?? expandedState
  const setExpanded = useCallback(
    (nextExpanded: boolean) => {
      if (expandedProp === undefined) {
        setExpandedState(nextExpanded)
      }
      onExpandedChange?.(nextExpanded)
    },
    [expandedProp, onExpandedChange]
  )

  const theme = resolvedTheme === "dark" ? "pierre-dark" : "pierre-light"
  const cacheKey = getCacheKey(code, language, theme)

  const [tokens, setTokens] = useState<TokenLines | null>(
    () => tokenCache.get(cacheKey) ?? null
  )

  useEffect(() => {
    const cached = tokenCache.get(cacheKey)
    if (cached) {
      setTokens(cached)
      return
    }

    let cancelled = false

    async function highlight() {
      if (!code) {
        if (!cancelled) setTokens([])
        return
      }

      try {
        const highlighter = await getHighlighter()
        const loadedLangs = highlighter.getLoadedLanguages()

        if (!loadedLangs.includes(language)) {
          await highlighter.loadLanguage(
            language as Parameters<Highlighter["loadLanguage"]>[0]
          )
        }

        const result = highlighter.codeToTokens(code, {
          lang: language as Parameters<Highlighter["codeToTokens"]>[1]["lang"],
          theme,
        })
        if (!cancelled) {
          setCachedTokens(cacheKey, result.tokens)
          setTokens(result.tokens)
        }
      } catch {
        if (!cancelled) {
          setTokens(plainTokens(code))
        }
      }
    }
    void highlight()
    return () => {
      cancelled = true
    }
  }, [cacheKey, code, language, theme])

  const lineCount = code.split("\n").length
  const shouldCollapse = !!maxCollapsedLines && lineCount > maxCollapsedLines
  const isCollapsed = shouldCollapse && !expanded

  const copyCode = useCallback(() => {
    void copy(code, COPY_ID)
  }, [code, copy])

  const toggleExpanded = useCallback(() => {
    setExpanded(!expanded)
  }, [expanded, setExpanded])

  const state: CodeBlockSharedState = {
    id,
    code,
    language,
    filename,
    tokens,
    showLineNumbers: lineNumbers === "visible",
    highlightLines,
    resolvedTheme,
    isCopied,
    copyCode,
    lineCount,
    shouldCollapse,
    isCollapsed,
    toggleExpanded,
  }

  return (
    <CodeBlockContext.Provider value={state}>
      <div
        className={cn(
          "@container flex w-full min-w-80 flex-col gap-3",
          className
        )}
        data-tool-ui-id={id}
        data-slot="code-block"
      >
        <div className="border-border bg-card overflow-hidden rounded-lg border shadow-xs">
          <Collapsible open={!isCollapsed}>{children}</Collapsible>
        </div>
      </div>
    </CodeBlockContext.Provider>
  )
}

export type CodeBlockSectionProps = {
  className?: string
}

function CodeBlockHeader({ className }: CodeBlockSectionProps) {
  const { language, filename, isCopied, copyCode } = useCodeBlock()
  return (
    <div
      className={cn(
        "bg-card flex items-center justify-between border-b px-4 py-2",
        className
      )}
    >
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground text-sm">
          {getLanguageDisplayName(language)}
        </span>
        {filename && (
          <>
            <span className="text-muted-foreground/50">•</span>
            <span className="text-foreground text-sm font-medium">
              {filename}
            </span>
          </>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={copyCode}
        className="h-7 w-7 p-0"
        aria-label={isCopied ? "Copied" : "Copy code"}
      >
        {isCopied ? (
          <Check className="h-4 w-4 text-green-700 dark:text-green-400" />
        ) : (
          <Copy className="text-muted-foreground h-4 w-4" />
        )}
      </Button>
    </div>
  )
}

// Shiki FontStyle bitmask: 1 italic, 2 bold, 4 underline.
function tokenStyle(token: ThemedToken): CSSProperties | undefined {
  const style: CSSProperties = {}
  if (token.color) style.color = token.color
  if (typeof token.fontStyle === "number" && token.fontStyle > 0) {
    if (token.fontStyle & 1) style.fontStyle = "italic"
    if (token.fontStyle & 2) style.fontWeight = "bold"
    if (token.fontStyle & 4) style.textDecoration = "underline"
  }
  return Object.keys(style).length > 0 ? style : undefined
}

function CodeBlockContent({ className }: CodeBlockSectionProps) {
  const {
    tokens,
    isCollapsed,
    showLineNumbers,
    highlightLines,
    resolvedTheme,
    lineCount,
    filename,
    language,
  } = useCodeBlock()

  const lineNumberWidth = `${String(lineCount).length + 0.5}ch`
  const highlightBg =
    resolvedTheme === "dark" ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.05)"

  return (
    // Focusable labelled region so keyboard users can reach it and scroll
    // long lines horizontally with the arrow keys.
    <section
      aria-label={filename ?? `${language} code`}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be keyboard-focusable to be scrollable without a mouse
      tabIndex={0}
      className={cn(
        // px-4 because shiki tokens carry no layout of their own. w-max +
        // min-w-full so the pre (and any line-highlight backgrounds) spans the
        // full scrollable width instead of stopping at the visible edge.
        "overflow-x-auto overflow-y-clip text-[13px] leading-[1.4] [&_pre]:w-max [&_pre]:min-w-full [&_pre]:px-4 [&_pre]:py-4",
        isCollapsed && "max-h-[200px]",
        className
      )}
    >
      {tokens && (
        <pre>
          <code>
            {tokens.map((line, lineIndex) => {
              const lineNumber = lineIndex + 1
              return (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: token lines are static positional content
                  key={lineIndex}
                  data-line={lineNumber}
                  style={
                    highlightLines?.includes(lineNumber)
                      ? { background: highlightBg }
                      : undefined
                  }
                >
                  {showLineNumbers && (
                    <span
                      aria-hidden="true"
                      className="mr-6 inline-block select-none text-right opacity-50"
                      style={{ width: lineNumberWidth }}
                    >
                      {lineNumber}
                    </span>
                  )}
                  {line.map((token, tokenIndex) => (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: tokens are static positional content
                      key={tokenIndex}
                      style={tokenStyle(token)}
                    >
                      {token.content}
                    </span>
                  ))}
                  {lineIndex < tokens.length - 1 ? "\n" : null}
                </span>
              )
            })}
          </code>
        </pre>
      )}
    </section>
  )
}

function CodeBlockCollapseToggle({ className }: CodeBlockSectionProps) {
  const { shouldCollapse, isCollapsed, toggleExpanded, lineCount } =
    useCodeBlock()

  if (!shouldCollapse) return null

  return (
    // Base UI collapsible: composition is `render`, not Radix's `asChild`.
    <CollapsibleTrigger
      render={
        <Button
          variant="ghost"
          onClick={toggleExpanded}
          className={cn(
            "text-muted-foreground w-full rounded-none border-t font-normal",
            className
          )}
        >
          {isCollapsed ? (
            <>
              <ChevronDown className="mr-1 size-4" />
              Show all {lineCount} lines
            </>
          ) : (
            <>
              <ChevronUp className="mr-2 h-4 w-4" />
              Collapse
            </>
          )}
        </Button>
      }
    />
  )
}

export type CodeBlockComposedProps = Omit<CodeBlockRootProps, "children">

function CodeBlockComposed(props: CodeBlockComposedProps) {
  return (
    <CodeBlockRoot {...props}>
      <CodeBlockHeader />
      <CodeBlockContent />
      <CodeBlockCollapseToggle />
    </CodeBlockRoot>
  )
}

type CodeBlockComponent = typeof CodeBlockComposed & {
  Root: typeof CodeBlockRoot
  Header: typeof CodeBlockHeader
  Content: typeof CodeBlockContent
  CollapseToggle: typeof CodeBlockCollapseToggle
}

export const CodeBlock = Object.assign(CodeBlockComposed, {
  Root: CodeBlockRoot,
  Header: CodeBlockHeader,
  Content: CodeBlockContent,
  CollapseToggle: CodeBlockCollapseToggle,
}) as CodeBlockComponent
