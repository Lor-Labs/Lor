import {
  jsonRecord,
  type PiLogChunk,
  type PiToolCallRecord,
  readLogLines,
} from "./pi-history"

// Tool calls read from Claude Code's saved conversation file, in the same
// shape as Pi's (touches). Assistant lines hold tool_use parts, user lines
// their tool_result parts. Lor's own tools reach Claude Code through the
// adapter's MCP server, so they are named mcp__harness-tools__<name>.

const LOR_TOOL_PREFIX = "mcp__harness-tools__"

type Rec = Record<string, unknown>

const isRec = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value)

// A tool_result's content is a string or text and image blocks.
function textOf(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .filter(
      (part): part is { type: "text"; text: string } =>
        isRec(part) && part.type === "text" && typeof part.text === "string"
    )
    .map((part) => part.text)
    .join("\n")
}

// Every tool call that has a result, in file order.
export function claudeToolCalls(chunks: PiLogChunk[]): PiToolCallRecord[] {
  const calls = new Map<
    string,
    { toolName: string; input: Rec; callEntryId: string }
  >()
  const records: PiToolCallRecord[] = []

  readLogLines(chunks, (line, runId) => {
    const entry = jsonRecord(line)
    if (!entry || typeof entry.uuid !== "string") return
    const message = entry.message
    if (!isRec(message) || !Array.isArray(message.content)) return
    for (const part of message.content) {
      if (!isRec(part)) continue
      if (
        entry.type === "assistant" &&
        part.type === "tool_use" &&
        typeof part.id === "string" &&
        typeof part.name === "string"
      ) {
        calls.set(part.id, {
          toolName: part.name.startsWith(LOR_TOOL_PREFIX)
            ? part.name.slice(LOR_TOOL_PREFIX.length)
            : part.name,
          input: isRec(part.input) ? part.input : {},
          callEntryId: entry.uuid,
        })
      } else if (
        entry.type === "user" &&
        part.type === "tool_result" &&
        typeof part.tool_use_id === "string"
      ) {
        const call = calls.get(part.tool_use_id)
        if (!call) continue
        const outputText = textOf(part.content)
        records.push({
          toolCallId: part.tool_use_id,
          ...call,
          resultEntryId: entry.uuid,
          runId,
          output: jsonRecord(outputText),
          outputText,
          isError: part.is_error === true,
        })
      }
    }
  })
  return records
}
