import {
  jsonRecord,
  type PiLogChunk,
  type PiToolCallRecord,
  readLogLines,
} from "./pi-history"

// Tool calls read from Codex's saved rollout, in the same shape as Pi's
// (touches). Lor's tools reach Codex as dynamic tools under their own names;
// its paginated rollout (its default) records each finished call as an
// item_completed DynamicToolCall event with arguments, output and success
// (Codex 0.160.1, protocol items.rs). Its function_call lines carry no
// success flag, so they are not read.

type Rec = Record<string, unknown>

const isRec = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value)

// A dynamic tool's output is inputText and inputImage items.
function textOf(items: unknown): string {
  if (!Array.isArray(items)) return ""
  return items
    .filter(
      (part): part is { type: "inputText"; text: string } =>
        isRec(part) &&
        part.type === "inputText" &&
        typeof part.text === "string"
    )
    .map((part) => part.text)
    .join("\n")
}

// Every finished dynamic tool call, in rollout order.
export function codexToolCalls(chunks: PiLogChunk[]): PiToolCallRecord[] {
  const records: PiToolCallRecord[] = []
  readLogLines(chunks, (line, runId) => {
    const entry = jsonRecord(line)
    const event =
      entry?.type === "event_msg" && isRec(entry.payload) ? entry.payload : null
    const item =
      event?.type === "item_completed" && isRec(event.item) ? event.item : null
    if (
      !entry ||
      item?.type !== "DynamicToolCall" ||
      typeof item.id !== "string" ||
      typeof item.tool !== "string"
    ) {
      return
    }
    // Codex's lines carry no ids; a paginated rollout numbers them.
    const lineId =
      typeof entry.ordinal === "number" ? String(entry.ordinal) : item.id
    const outputText = textOf(item.content_items)
    records.push({
      toolCallId: item.id,
      toolName: item.tool,
      input: isRec(item.arguments) ? item.arguments : {},
      callEntryId: lineId,
      resultEntryId: lineId,
      runId,
      output: jsonRecord(outputText),
      outputText,
      isError: item.success !== true,
    })
  })
  return records
}
