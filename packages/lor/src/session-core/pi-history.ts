// Lor's plain history read from Pi's saved log (pi-harness-runbook.md 1.5).
// Each record keeps the Pi entry ids it came from. Phase 1 reads tool calls
// (touches); later phases add messages for fork, rewind and handoff.

// One saved chunk of the log, in order, with the run whose save wrote it.
// After a format conversion one chunk holds the whole log under the run that
// converted it.
export type PiLogChunk = { content: string; runId: string | null }

export type PiToolCallRecord = {
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
  callEntryId: string
  resultEntryId: string
  // The run whose save holds the result: a paused turn's call and its result
  // can be saved by different runs.
  runId: string | null
  // Lor's tools return JSON objects. Null for text results: Pi's built-ins,
  // and output cut at Pi's 50 KB limit for tool results.
  output: Record<string, unknown> | null
  outputText: string
  isError: boolean
}

type Rec = Record<string, unknown>

const isRec = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value)

function jsonRecord(text: string): Rec | null {
  if (!text.trim()) return null
  try {
    const value: unknown = JSON.parse(text)
    return isRec(value) ? value : null
  } catch {
    return null
  }
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return ""
  return content
    .filter(
      (part): part is { type: "text"; text: string } =>
        isRec(part) && part.type === "text" && typeof part.text === "string"
    )
    .map((part) => part.text)
    .join("\n")
}

// Every tool call that has a result, in log order.
export function piToolCalls(chunks: PiLogChunk[]): PiToolCallRecord[] {
  const calls = new Map<
    string,
    { toolName: string; input: Rec; callEntryId: string }
  >()
  const records: PiToolCallRecord[] = []

  const read = (line: string, runId: string | null) => {
    const entry = jsonRecord(line)
    if (entry?.type !== "message" || typeof entry.id !== "string") return
    const message = entry.message
    if (!isRec(message)) return
    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (
          isRec(part) &&
          part.type === "toolCall" &&
          typeof part.id === "string" &&
          typeof part.name === "string"
        ) {
          calls.set(part.id, {
            toolName: part.name,
            input: isRec(part.arguments) ? part.arguments : {},
            callEntryId: entry.id,
          })
        }
      }
      return
    }
    if (message.role !== "toolResult") return
    const toolCallId = message.toolCallId
    const call = typeof toolCallId === "string" ? calls.get(toolCallId) : null
    if (!(call && typeof toolCallId === "string")) return
    const outputText = textOf(message.content)
    records.push({
      toolCallId,
      ...call,
      resultEntryId: entry.id,
      runId,
      output: jsonRecord(outputText),
      outputText,
      isError: message.isError === true,
    })
  }

  // Saves append whole lines, but a line split across chunks still counts
  // for the chunk that completes it.
  let partial = ""
  for (const chunk of chunks) {
    const lines = `${partial}${chunk.content}`.split("\n")
    partial = lines.pop() ?? ""
    for (const line of lines) read(line, chunk.runId)
  }
  if (partial) read(partial, chunks.at(-1)?.runId ?? null)
  return records
}
