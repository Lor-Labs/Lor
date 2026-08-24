import { createHash } from "node:crypto"
import { env } from "@repo/env/server"
import { logger } from "./logger"
import type { RunToolResultStore } from "./run"

// Tools whose effects land outside the run (memory writes, Linear mutations,
// billed sandbox investigations). Their executions are recorded per run and
// replayed from the store on a retried step, so a recovery never repeats a
// completed action or re-bills an investigation. Doubles as the durable
// account of "what did that run actually do" for the Act handoff briefing
// (reference/automation-primitives.md §5).
const SIDE_EFFECT_TOOLS = new Set([
  "write",
  "mkdir",
  "move",
  "link",
  "create_linear_issue",
  "update_linear_issue",
  "comment_linear",
  "investigate_code",
  // Pushes a branch and opens/updates a draft PR — replay must never re-push
  // or file a duplicate.
  "propose_code_change",
  "propose_instructions",
  "create_artifacts",
  "react_to_message",
  // Triggered dispositions: without these a retried step posts the same
  // message (or opens the same task) twice.
  "post_channel_message",
  "create_task",
  // Loop runs: a retried step must not double-complete the loop.
  "complete_loop",
  // Creates a draft loop row + card message; replay must not duplicate them.
  "propose_loop",
])

// Canonical JSON (sorted object keys) so the same logical input always hashes
// to the same key regardless of property order.
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    return `{${entries.join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

// Identity of one tool execution within a run. toolCallIds regenerate when a
// step is retried; tool name + canonical input doesn't.
export function toolExecutionKey(toolName: string, input: unknown): string {
  return createHash("sha256")
    .update(`${toolName}\n${stableStringify(input)}`)
    .digest("hex")
}

export type ToolGuard = {
  // Bytes produced by tools since the last step boundary.
  takeStepBytes: () => number
  exhausted: () => boolean
}

type AnyToolExecute = (
  input: unknown,
  options: unknown
) => Promise<unknown> | unknown

type WrappableTool = { execute?: AnyToolExecute }

// Wraps every tool's execute with output-size caps and (for side-effecting
// tools) the per-run idempotency store. Returns the same toolset type — only
// execute is replaced.
export function guardTools<T extends Record<string, unknown>>(
  tools: T,
  opts: {
    priorBytes: number
    totalBudgetBytes: number
    store: RunToolResultStore | null
  }
): { tools: T; guard: ToolGuard } {
  const perCallBytes = env.AGENT_RUN_MAX_TOOL_OUTPUT_BYTES_PER_CALL
  let totalBytes = opts.priorBytes
  let stepBytes = 0

  const guard: ToolGuard = {
    takeStepBytes: () => {
      const n = stepBytes
      stepBytes = 0
      return n
    },
    exhausted: () => totalBytes >= opts.totalBudgetBytes,
  }

  const wrapped = Object.fromEntries(
    Object.entries(tools).map(([name, t]) => {
      const original = (t as WrappableTool).execute
      if (typeof original !== "function") return [name, t]
      const execute: AnyToolExecute = async (input, options) => {
        if (guard.exhausted()) {
          return {
            error: "tool output budget exhausted; answer with what you have",
          }
        }
        const sideEffect = SIDE_EFFECT_TOOLS.has(name)
        const key = sideEffect ? toolExecutionKey(name, input) : null
        if (key && opts.store) {
          const cached = await opts.store.get(key).catch(() => undefined)
          if (cached !== undefined) {
            logger.info({ tool: name }, "Tool result served from run cache")
            // A replayed output still enters the context (and its original
            // count lives in an un-checkpointed step), so it counts here too.
            const cachedSize = Math.min(
              Buffer.byteLength(JSON.stringify(cached) ?? ""),
              perCallBytes
            )
            totalBytes += cachedSize
            stepBytes += cachedSize
            return cached
          }
        }
        let output = await original(input, options)
        const size = Buffer.byteLength(JSON.stringify(output) ?? "")
        if (size > perCallBytes) {
          logger.warn(
            { tool: name, size, cap: perCallBytes },
            "Tool output exceeded per-call cap; dropped"
          )
          output = {
            error: `tool output was too large (${size} bytes) and was dropped; narrow the request`,
          }
        }
        const counted = Math.min(size, perCallBytes)
        totalBytes += counted
        stepBytes += counted
        // Error results are not cached: the side effect didn't complete, so a
        // retry with the same input must re-attempt, not replay the failure.
        const failed =
          typeof output === "object" && output !== null && "error" in output
        if (key && opts.store && !failed) {
          await opts.store.put(key, name, output).catch((err) => {
            logger.warn({ err, tool: name }, "Tool result store write failed")
          })
        }
        return output
      }
      return [name, { ...(t as object), execute }]
    })
  ) as T

  return { tools: wrapped, guard }
}
