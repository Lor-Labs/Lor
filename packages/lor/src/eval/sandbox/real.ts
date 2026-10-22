import { and, asc, db, eq, isNotNull, schema } from "@repo/db"
import type { ClassifierCall } from "../../sandbox/classifier"
import { deniedReason } from "../../sandbox/pi-events"
import type { SandboxCase } from "./cases"

// Real sandbox calls for `pnpm eval:sandbox`, read from every saved Pi log
// (harness_log) and labeled by what happened: a call a person rejected is
// "overeager" (expect stop); a call that ran is "real" (expect run). Calls
// the policy refused or that never got a result are left out: nobody judged
// them. The request is the turn's last user message, which is Lor's built
// prompt rather than only the person's words. A call set aside because
// someone sent a new message is stored as rejected too, so it counts as
// overeager here.

const SANDBOX_TOOLS = new Set(["bash", "write", "edit"])
const MAX_REQUEST_CHARS = 4_000
const RECENT_CALLS = 6

type LogEntry = {
  type?: string
  cwd?: string
  message?: {
    role?: string
    content?: unknown
    toolCallId?: string
  }
}

type ToolCallBlock = {
  type: "toolCall"
  id: string
  name: string
  arguments: Record<string, unknown>
}

function text(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .flatMap((part: { type?: unknown; text?: unknown }) =>
      part?.type === "text" && typeof part.text === "string" ? [part.text] : []
    )
    .join("\n")
}

function arg(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  return typeof value === "string" ? value : ""
}

function subjectOf(call: ToolCallBlock): string {
  if (call.name === "bash") return arg(call.arguments, "command")
  if (SANDBOX_TOOLS.has(call.name)) return arg(call.arguments, "file_path")
  return JSON.stringify(call.arguments).slice(0, 1_000)
}

function casesFromLog(
  log: string,
  stateId: string,
  rejected: Set<string>
): SandboxCase[] {
  const entries = log
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as LogEntry)
  const workDir = entries[0]?.type === "session" ? entries[0].cwd : undefined
  const denied = new Set<string>()
  for (const entry of entries) {
    const message = entry.message
    if (message?.role !== "toolResult" || !message.toolCallId) continue
    if (deniedReason(text(message.content)) !== null) {
      denied.add(message.toolCallId)
    }
  }
  const results = new Set(
    entries.flatMap((e) =>
      e.message?.role === "toolResult" && e.message.toolCallId
        ? [e.message.toolCallId]
        : []
    )
  )

  const cases: SandboxCase[] = []
  let request = ""
  let recentCalls: ClassifierCall[] = []
  let denials: string[] = []
  for (const entry of entries) {
    const message = entry.message
    if (entry.type !== "message" || !message) continue
    if (message.role === "user") {
      request = text(message.content).slice(-MAX_REQUEST_CHARS)
      recentCalls = []
      denials = []
      continue
    }
    if (message.role !== "assistant" || !Array.isArray(message.content)) {
      continue
    }
    for (const block of message.content as ToolCallBlock[]) {
      if (block?.type !== "toolCall") continue
      const subject = subjectOf(block)
      if (SANDBOX_TOOLS.has(block.name) && subject) {
        const label = rejected.has(block.id)
          ? ("stop" as const)
          : denied.has(block.id) || !results.has(block.id)
            ? null
            : ("run" as const)
        if (label) {
          cases.push({
            id: `real:${stateId.slice(0, 8)}:${block.id}`,
            category: label === "stop" ? "overeager" : "real",
            expect: label,
            toolName: block.name as SandboxCase["toolName"],
            subject,
            content:
              block.name === "write"
                ? arg(block.arguments, "content")
                : block.name === "edit"
                  ? arg(block.arguments, "new_string")
                  : undefined,
            request,
            recentCalls: recentCalls.slice(-RECENT_CALLS),
            denials: [...denials],
            ...(workDir ? { workDir } : {}),
          })
        }
        if (denied.has(block.id)) denials.push(`${block.name}: ${subject}`)
      }
      recentCalls.push({ toolName: block.name, subject })
    }
  }
  return cases
}

export async function loadRealCases(): Promise<SandboxCase[]> {
  const rejected = await db
    .select({ toolCallId: schema.approval.toolCallId })
    .from(schema.approval)
    .where(
      and(
        eq(schema.approval.kind, "sandbox"),
        eq(schema.approval.status, "rejected"),
        isNotNull(schema.approval.resolvedBy)
      )
    )
  const rejectedIds = new Set(
    rejected.flatMap((row) => (row.toolCallId ? [row.toolCallId] : []))
  )
  const states = await db
    .select({ id: schema.harnessState.id })
    .from(schema.harnessState)
  const cases: SandboxCase[] = []
  for (const state of states) {
    const chunks = await db
      .select({ content: schema.harnessLog.content })
      .from(schema.harnessLog)
      .where(eq(schema.harnessLog.harnessStateId, state.id))
      .orderBy(asc(schema.harnessLog.seq))
    const log = chunks.map((chunk) => chunk.content).join("")
    cases.push(...casesFromLog(log, state.id, rejectedIds))
  }
  return cases
}
