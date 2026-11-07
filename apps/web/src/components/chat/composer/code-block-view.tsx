import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select"
import type { NodeViewProps } from "@tiptap/react"
import { NodeViewContent, NodeViewWrapper } from "@tiptap/react"
import { useRef } from "react"

type LanguageItem = { value: string | null; label: string }

// A null language is a bare ``` fence: plain text, no highlighting.
const CODE_BLOCK_LANGUAGES: readonly LanguageItem[] = [
  { value: null, label: "Plain text" },
  { value: "typescript", label: "TypeScript" },
  { value: "javascript", label: "JavaScript" },
  { value: "python", label: "Python" },
  { value: "json", label: "JSON" },
  { value: "yaml", label: "YAML" },
  { value: "bash", label: "Bash" },
  { value: "css", label: "CSS" },
  { value: "html", label: "HTML" },
  { value: "sql", label: "SQL" },
  { value: "rust", label: "Rust" },
  { value: "go", label: "Go" },
  { value: "java", label: "Java" },
]

const PICKER_LANGUAGES = new Set(CODE_BLOCK_LANGUAGES.map((l) => l.value))

// Fence aliases that name the same Shiki grammar. Distinct grammars (tsx,
// jsx, xml) keep their own name so the sent fence still highlights them.
const LANGUAGE_ALIASES: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  sh: "bash",
  shell: "bash",
  shellscript: "bash",
  zsh: "bash",
  yml: "yaml",
  rs: "rust",
  golang: "go",
}

const PLAIN_TEXT_LANGUAGES = new Set(["plaintext", "plain", "text", "txt"])

// One code block language for the picker label, Shiki highlighting and the
// markdown fence info string, whatever the fence, paste or draft stored.
export function normalizeCodeLanguage(language: unknown): string | null {
  if (typeof language !== "string") return null
  const trimmed = language.trim()
  const lower = trimmed.toLowerCase()
  if (!lower || PLAIN_TEXT_LANGUAGES.has(lower)) return null
  // An info string with metadata ("ts title=a.ts") round-trips verbatim.
  if (/\s/.test(trimmed)) return trimmed
  return LANGUAGE_ALIASES[lower] ?? lower
}

export function CodeBlockView({
  editor,
  getPos,
  node,
  updateAttributes,
}: NodeViewProps) {
  const language = normalizeCodeLanguage(node.attrs.language)
  const items = PICKER_LANGUAGES.has(language)
    ? CODE_BLOCK_LANGUAGES
    : [...CODE_BLOCK_LANGUAGES, { value: language, label: language ?? "" }]
  const pickedRef = useRef(false)

  // After a pick, keep the caret where it was in this block, else its end.
  const focusCode = () => {
    const pos = getPos()
    if (editor.isDestroyed || typeof pos !== "number") return
    const block = editor.state.doc.nodeAt(pos)
    if (!block) return
    const end = pos + block.nodeSize - 1
    const { from, to } = editor.state.selection
    editor.commands.focus(from > pos && to <= end ? null : end)
  }

  return (
    <NodeViewWrapper className="mt-1 mb-0 overflow-hidden rounded-md border border-border/70 bg-muted/50">
      <div
        className="flex items-center border-b border-border/70 bg-muted/80 px-2 py-1"
        contentEditable={false}
      >
        <Select
          items={items}
          value={language}
          onValueChange={(value) => updateAttributes({ language: value })}
          onOpenChange={(open, { reason }) => {
            if (open || reason !== "item-press") return
            pickedRef.current = true
            // Deferred so the picking Enter key never reaches the code.
            requestAnimationFrame(focusCode)
          }}
        >
          <SelectTrigger className="h-6 w-auto gap-1 border-none bg-transparent px-1.5 text-[11px] shadow-none focus:ring-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            finalFocus={() => {
              const picked = pickedRef.current
              pickedRef.current = false
              return !picked
            }}
          >
            {items.map((item) => (
              <SelectItem key={item.value ?? ""} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <pre className="!mt-0 !mb-0 !rounded-none !border-0 px-3 py-2 font-mono text-[0.92em] leading-6">
        <NodeViewContent spellCheck={false} />
      </pre>
    </NodeViewWrapper>
  )
}
