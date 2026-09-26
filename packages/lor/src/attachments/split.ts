// Recursive text splitter for document chunking: paragraph → line → sentence
// → word, packing pieces up to `target` chars. No overlap (see the chunking
// research notes in reference/attachment-search.md).
const SEPARATORS: [RegExp, string][] = [
  [/\n\s*\n/, "\n\n"],
  [/\n/, "\n"],
  [/(?<=[.!?])\s+/, " "],
  [/\s+/, " "],
]

export function splitText(text: string, target: number, level = 0): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (trimmed.length <= target) return [trimmed]
  const separator = SEPARATORS[level]
  if (!separator) {
    const out: string[] = []
    for (let i = 0; i < trimmed.length; i += target) {
      out.push(trimmed.slice(i, i + target))
    }
    return out
  }

  const [pattern, joiner] = separator
  const out: string[] = []
  let buffer = ""
  const flush = () => {
    if (buffer.trim()) out.push(buffer.trim())
    buffer = ""
  }
  for (const part of trimmed.split(pattern)) {
    if (part.length > target) {
      flush()
      out.push(...splitText(part, target, level + 1))
      continue
    }
    const next = buffer ? buffer + joiner + part : part
    if (next.length > target) {
      flush()
      buffer = part
    } else {
      buffer = next
    }
  }
  flush()
  return out
}
