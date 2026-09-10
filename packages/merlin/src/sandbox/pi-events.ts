import type { MerlinToolCall } from "@repo/db/schema"

export type PiInvestigationUsage = {
  model?: string
  requestedModel?: string
  inputTokens?: number
  cachedInputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
}

export type PiFileDiff = NonNullable<MerlinToolCall["diff"]>

// One sub-tool frame. Pi's toolCallId is stable across the start/end events
// of a call, so consumers can upsert: start sets the label, end adds status
// (and the computed diff for edits).
export type PiCodeStep = {
  toolCallId: string
  toolName: string
  label: string
  status?: "ok" | "error"
  diff?: PiFileDiff
}

export type PiCodeHandlers = {
  onStep?: (step: PiCodeStep) => void
  // Snapshot of the assistant message currently streaming (resets on each new
  // message) — drives the parent tool's live summary.
  onAssistantText?: (text: string) => void
}

export type PiEventResult = {
  findings: string
  usage?: PiInvestigationUsage
  error?: string
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined
}

function sum(current: number | undefined, next: number | undefined) {
  return next === undefined ? current : (current ?? 0) + next
}

export function piToolLabel(name: string, input: unknown): string {
  const args = asRecord(input)
  const path = asString(args?.path)
  const pattern = asString(args?.pattern)

  switch (name.toLowerCase()) {
    case "read":
      return path ? `Read ${path}` : "Read a file"
    case "grep":
      return pattern ? `Searched for “${pattern}”` : "Searched the code"
    case "find":
      return pattern ? `Listed files: ${pattern}` : "Listed files"
    case "ls":
      return path ? `Listed ${path}` : "Listed a directory"
    case "write":
      return path ? `Wrote ${path}` : "Wrote a file"
    case "edit":
      return path ? `Edited ${path}` : "Edited a file"
    case "bash": {
      const command = asString(args?.command)
      return command ? `Ran ${command}` : "Ran a command"
    }
    default:
      return name
  }
}

const MAX_PATCH_CHARS = 12_000

// Bound a patch for transport/persistence, cutting on a line boundary.
function boundPatch(patch: string): Pick<PiFileDiff, "patch" | "truncated"> {
  if (patch.length <= MAX_PATCH_CHARS) return { patch }
  const cut = patch.lastIndexOf("\n", MAX_PATCH_CHARS)
  return {
    patch: patch.slice(0, cut > 0 ? cut : MAX_PATCH_CHARS),
    truncated: true,
  }
}

function countPatchLines(patch: string): {
  additions: number
  deletions: number
} {
  let additions = 0
  let deletions = 0
  // Only count inside @@ hunks: the ---/+++ file headers sit before the first
  // hunk, and a prefix check alone would also swallow real changes to source
  // lines that start with ++/--. A headerless patch has no hunk markers
  // either — then every +/- line counts.
  const lines = patch.split("\n")
  let inHunk = !lines.some((line) => line.startsWith("@@"))
  for (const line of lines) {
    if (line.startsWith("@@")) {
      inHunk = true
      continue
    }
    if (!inHunk) continue
    if (line.startsWith("+")) additions++
    else if (line.startsWith("-")) deletions++
  }
  return { additions, deletions }
}

// `write` carries the full file content in its start args — present it as an
// all-added diff, Codex-style.
function writeDiff(args: unknown): PiFileDiff | undefined {
  const rec = asRecord(args)
  const path = asString(rec?.path)
  const content = typeof rec?.content === "string" ? rec.content : undefined
  if (!path || content === undefined) return undefined
  const lines = content.split("\n")
  if (lines.at(-1) === "") lines.pop()
  return {
    path,
    additions: lines.length,
    deletions: 0,
    ...boundPatch(lines.map((l) => `+${l}`).join("\n")),
  }
}

// `edit` computes a standard unified patch itself, returned in the end
// event's result details.
function editDiff(args: unknown, result: unknown): PiFileDiff | undefined {
  const path = asString(asRecord(args)?.path)
  const patch = asString(asRecord(asRecord(result)?.details)?.patch)
  if (!path || !patch) return undefined
  return { path, ...countPatchLines(patch), ...boundPatch(patch) }
}

function messageText(message: Record<string, unknown>): string {
  const content = message.content
  if (!Array.isArray(content)) return ""
  return content
    .map(asRecord)
    .filter((block) => asString(block?.type) === "text")
    .map((block) => asString(block?.text) ?? "")
    .join("")
    .trim()
}

export function createPiEventCollector(handlers?: PiCodeHandlers) {
  let findings = ""
  let error: string | undefined
  let usage: PiInvestigationUsage | undefined
  // Args by Pi toolCallId, so the end event (which carries none) can rebuild
  // the label and locate the edited path.
  const startedTools = new Map<string, { toolName: string; args: unknown }>()
  // Gateway backends can omit tool-call ids (pi-ai defaults them to "").
  // Synthesize ids and correlate id-less end events in FIFO order — the
  // agent loop executes a message's tool calls sequentially.
  const syntheticIds: string[] = []
  let syntheticSeq = 0
  let assistantStreaming = false
  let assistantText = ""

  const consume = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return

    let event: Record<string, unknown> | undefined
    try {
      event = asRecord(JSON.parse(trimmed))
    } catch {
      return
    }
    if (!event) return

    const type = asString(event.type)
    if (type === "tool_execution_start") {
      const toolName = asString(event.toolName) ?? "tool"
      let toolCallId = asString(event.toolCallId)
      if (!toolCallId) {
        toolCallId = `pi-${++syntheticSeq}`
        syntheticIds.push(toolCallId)
      }
      startedTools.set(toolCallId, { toolName, args: event.args })
      handlers?.onStep?.({
        toolCallId,
        toolName,
        label: piToolLabel(toolName, event.args),
      })
      return
    }

    if (type === "tool_execution_end") {
      const toolCallId = asString(event.toolCallId) ?? syntheticIds.shift()
      const started = toolCallId && startedTools.get(toolCallId)
      if (!toolCallId || !started) return
      startedTools.delete(toolCallId)
      // Diffs only for completed changes — a failed write/edit changed nothing.
      const diff =
        event.isError === true
          ? undefined
          : started.toolName === "edit"
            ? editDiff(started.args, event.result)
            : started.toolName === "write"
              ? writeDiff(started.args)
              : undefined
      handlers?.onStep?.({
        toolCallId,
        toolName: started.toolName,
        label: piToolLabel(started.toolName, started.args),
        status: event.isError === true ? "error" : "ok",
        ...(diff ? { diff } : {}),
      })
      return
    }

    if (type === "message_start") {
      assistantStreaming =
        asString(asRecord(event.message)?.role) === "assistant"
      if (assistantStreaming && assistantText) {
        // Signal the message boundary so consumers drop the previous
        // message's snapshot instead of throttling against its length.
        assistantText = ""
        handlers?.onAssistantText?.("")
      }
      return
    }

    if (type === "message_update") {
      if (!assistantStreaming) return
      const inner = asRecord(event.assistantMessageEvent)
      if (asString(inner?.type) !== "text_delta") return
      if (typeof inner?.delta !== "string" || !inner.delta) return
      assistantText += inner.delta
      handlers?.onAssistantText?.(assistantText)
      return
    }

    if (type !== "message_end") return
    assistantStreaming = false
    const message = asRecord(event.message)
    if (!message || asString(message.role) !== "assistant") return

    const text = messageText(message)
    if (text) findings = text
    error = asString(message.errorMessage) ?? error

    const rawUsage = asRecord(message.usage)
    if (!rawUsage) return
    const cost = asRecord(rawUsage.cost)
    const cachedInput = asNumber(rawUsage.cacheRead)
    const reasoning = asNumber(rawUsage.reasoning)
    const billedOutput = sum(asNumber(rawUsage.output), reasoning)
    const next: PiInvestigationUsage = {
      model:
        asString(message.responseModel) ??
        asString(message.model) ??
        usage?.model,
      requestedModel: asString(message.model) ?? usage?.requestedModel,
      inputTokens: sum(usage?.inputTokens, asNumber(rawUsage.input)),
      cachedInputTokens: sum(usage?.cachedInputTokens, cachedInput),
      outputTokens: sum(usage?.outputTokens, billedOutput),
      reasoningTokens: sum(usage?.reasoningTokens, reasoning),
    }

    // Townhall's billing ledger owns pricing. Pi still receives zero-valued
    // rates in models.json so it can satisfy its model schema without creating
    // a second pricing source of truth.
    if (
      Object.values(next).some((value) => value !== undefined) ||
      asNumber(cost?.total) !== undefined
    ) {
      usage = next
    }
  }

  return {
    consume,
    // Blaxel's live-log callback is line-framed and strips the trailing newline.
    // Also accept multiple lines so completed stdout can use the same path.
    consumeOutput(output: string) {
      for (const line of output.split(/\r?\n/)) consume(line)
    },
    result(): PiEventResult {
      return { findings, usage, error }
    },
  }
}
