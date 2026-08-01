export type PiInvestigationUsage = {
  model?: string
  requestedModel?: string
  inputTokens?: number
  cachedInputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
}

export type PiCodeStep = { toolName: string; label: string }

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
    default:
      return name
  }
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

export function createPiEventCollector(onStep?: (step: PiCodeStep) => void) {
  let findings = ""
  let error: string | undefined
  let usage: PiInvestigationUsage | undefined

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
      onStep?.({
        toolName,
        label: piToolLabel(toolName, event.args),
      })
      return
    }

    if (type !== "message_end") return
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
    result(): PiEventResult {
      return { findings, usage, error }
    },
  }
}
