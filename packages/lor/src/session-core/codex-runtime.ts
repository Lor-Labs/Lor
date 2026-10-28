import {
  HarnessAgent,
  type HarnessAgentContinueTurnState,
} from "@ai-sdk/harness/agent"
import { shellQuote } from "@ai-sdk/harness/utils"
import {
  VERSION as CODEX_ADAPTER_VERSION,
  type CodexHarnessSettings,
  createCodex,
} from "@ai-sdk/harness-codex"
import type { ReportedHarnessModel } from "@repo/db/schema"
import type {
  Experimental_SandboxSession as SandboxSession,
  TextStreamPart,
  ToolApprovalResponse,
  ToolApprovalStatus,
  ToolSet,
  UserModelMessage,
} from "ai"
import { codexHeadOf } from "./codex-branch"
import {
  checkCompatibility,
  type HarnessBinding,
  type SavedHarnessState,
  SessionCoreError,
} from "./harness-state"
import {
  missingToolStubs,
  type PiContextUsage,
  type PiTurnResult,
  type PiTurnSave,
  prepareTools,
  sandboxHome,
} from "./pi-runtime"
import { reportedModels } from "./reported-models"
import { sessionWorkFolder } from "./work-dir"

// One Codex turn through Vercel's adapter, on Lor credits through the AI
// Gateway (reference/planned/code-sessions-runbook.md chunk 8d). Codex keeps a
// thread in one append-only rollout file under ~/.codex/sessions; like Claude
// Code's file it is saved to Postgres per turn and written back before the
// next, and Codex resumes the thread from that file alone (8d-1 spike).

export const CODEX_BINDING: HarnessBinding = {
  kind: "codex",
  adapterVersion: CODEX_ADAPTER_VERSION,
  // Codex's rollout has no format version of its own; this is the save
  // layout's.
  formatVersion: 1,
}

// A Codex session's model when the sender picked none.
export const CODEX_DEFAULT_MODEL = "gpt-6.1-sol"

type CodexEffort = NonNullable<CodexHarnessSettings["reasoningEffort"]>
// The adapter's effort names; which ones a model takes comes from Codex's
// own model list.
const CODEX_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const
export const isCodexEffort = (
  value: string | undefined
): value is CodexEffort => CODEX_EFFORTS.some((effort) => effort === value)

export type CodexTurnInput = {
  // Lor's session id: the harness session, and the work folder's name.
  sessionId: string
  saved: SavedHarnessState | null
  sandbox: SandboxSession
  // The bridge's port in the sandbox and how the worker reaches it.
  bridge: {
    port: number
    endpoint: { url: string; headers: Record<string, string> }
  }
  // Lor's Gateway key reaches the Gateway through the sandbox proxy; Codex
  // only ever sees this placeholder.
  keyPlaceholder: string
  // The model the sender picked, as Codex names it ("gpt-6.1-sol"); unset:
  // GPT-6.1 Sol.
  model?: string
  // The sender's reasoning effort pick; one Codex doesn't name is dropped.
  effort?: string
  // Codex's developer instructions; its own base prompt stays.
  instructions: string
  // A paused turn in `saved` continues first, through its bridge process,
  // with one decision per pending approval. Then `prompt`, when given, starts
  // a new turn in the same thread.
  decisions?: ToolApprovalResponse[]
  // Drop the paused turn instead (stopped, saved by another adapter version,
  // or its bridge is gone): the thread goes on from its rollout, where Codex
  // reads the waiting calls as not run (8d-1 spike).
  dropPaused?: boolean
  prompt?: UserModelMessage
  tools: ToolSet
  toolsContext?: Record<string, unknown>
  toolApproval?: Record<string, ToolApprovalStatus>
  abortSignal?: AbortSignal
  onPart: (part: TextStreamPart<ToolSet>) => void | Promise<void>
  // Codex's own model list (model/list), which Lor's bridge patch puts on
  // the turn's finish part.
  onModels?: (models: ReportedHarnessModel[]) => void
}

export async function runCodexTurn(
  input: CodexTurnInput
): Promise<PiTurnResult> {
  const { saved, sandbox } = input
  const compatibility = saved ? checkCompatibility(saved, CODEX_BINDING) : null
  if (compatibility?.continuation === "expire" && !input.dropPaused) {
    throw new SessionCoreError(
      "incompatible_state",
      "The paused turn was saved by another adapter version"
    )
  }
  const paused =
    compatibility?.continuation === "resume" && !input.dropPaused
      ? (saved?.continuation as HarnessAgentContinueTurnState)
      : null
  const notStarted: PiTurnResult = {
    aborted: true,
    usage: null,
    modelId: null,
    responseMessages: [],
    save: null,
    pendingApprovals: [],
    contextUsage: null,
  }
  // A dropped paused turn with no new prompt has nothing to run: only its
  // saved continuation is cleared.
  if (!paused && !input.prompt) {
    return {
      ...notStarted,
      aborted: false,
      save: withContinuation(null, saved, null),
    }
  }
  const codexHome = `${await sandboxHome(sandbox)}/.codex`
  // Postgres is the authority: put the saved rollout back unless it matches.
  // A paused turn's bridge still holds the thread and appends to it.
  if (saved && !paused) {
    const path = `${codexHome}/${saved.head.logFileName}`
    const current = await sandbox.run({
      command: `sha256sum ${shellQuote(path)} 2>/dev/null | cut -d' ' -f1`,
    })
    if (current.stdout.trim() !== saved.head.sha256) {
      await sandbox.writeTextFile({ path, content: saved.log })
    }
  }

  const agent = new HarnessAgent({
    harness: createCodex({
      auth: { AI_GATEWAY_API_KEY: input.keyPlaceholder },
      port: input.bridge.port,
      portEndpoint: input.bridge.endpoint,
      ...(isCodexEffort(input.effort) ? { reasoningEffort: input.effort } : {}),
    }),
    model: input.model ?? CODEX_DEFAULT_MODEL,
    instructions: input.instructions,
    tools: prepareTools(
      { ...missingToolStubs(paused, input.tools), ...input.tools },
      input.toolsContext,
      sandbox
    ),
    // The core takes a generic ToolSet; respond() builds the matching
    // per-tool context, so the inferred type is bridged here.
    ...(input.toolsContext
      ? { toolsContext: input.toolsContext as never }
      : {}),
    ...(input.toolApproval ? { toolApproval: input.toolApproval } : {}),
    // The adapter has no approvals for Codex's own tools.
    permissionMode: "allow-all",
    // The session's own work folder, shared with clone, checkpoints and the
    // Changes panel.
    sandboxConfig: { workDir: sessionWorkFolder(input.sessionId) },
  })

  const abort = input.abortSignal ? { abortSignal: input.abortSignal } : {}
  const session = await agent
    .createSession({
      sessionId: input.sessionId,
      sandboxSession: sandbox,
      // A paused turn reattaches to its waiting bridge (respond() checks it
      // still runs).
      ...(paused
        ? { continueFrom: paused }
        : saved
          ? {
              resumeFrom: {
                type: "resume-session" as const,
                harnessId: "codex",
                specificationVersion: "harness-v1" as const,
                data: { threadId: saved.head.harnessSessionId },
              },
            }
          : {}),
      ...abort,
    })
    .catch((err: unknown) => {
      if (input.abortSignal?.aborted) return null
      throw err
    })
  if (!session) return notStarted

  // Set once stop() or suspendTurn() ran; otherwise the session is destroyed.
  let settled = false
  try {
    let aborted = false
    const results: Awaited<ReturnType<typeof agent.stream>>[] = []
    const drain = async (result: Awaited<ReturnType<typeof agent.stream>>) => {
      results.push(result)
      for await (const part of result.stream) {
        if (part.type === "abort") aborted = true
        if (part.type === "finish") {
          // The harness sets it on finish; the AI SDK type does not declare it.
          const models = reportedModels(
            (part as { providerMetadata?: unknown }).providerMetadata,
            "codex"
          )
          if (models) input.onModels?.(models)
        }
        await input.onPart(part)
      }
    }
    if (paused) {
      await drain(
        await agent.continueStream({
          session,
          toolApprovalContinuations: input.decisions ?? [],
          ...abort,
        })
      )
    }
    // A continued turn that paused again leaves the prompt for a later turn.
    if (input.prompt && !aborted && !session.hasUnfinishedTurn()) {
      await drain(
        await agent.stream({ session, messages: [input.prompt], ...abort })
      )
    }
    aborted ||= Boolean(input.abortSignal?.aborted)
    const totals = await Promise.all(
      results.map((result) =>
        Promise.all([
          Promise.resolve(result.totalUsage).catch(() => null),
          Promise.resolve(result.response).catch(() => null),
          Promise.resolve(result.responseMessages).catch(() => []),
        ])
      )
    )
    // Codex reports usage at the turn's end only (a paused turn's early
    // finish carries none), so Lor charges the whole turn then.
    const usage = totals.every(([turnUsage]) => turnUsage)
      ? totals.reduce(
          (total, [turnUsage]) => ({
            inputTokens: total.inputTokens + (turnUsage?.inputTokens ?? 0),
            cachedInputTokens:
              total.cachedInputTokens +
              (turnUsage?.inputTokenDetails?.cacheReadTokens ?? 0),
            outputTokens: total.outputTokens + (turnUsage?.outputTokens ?? 0),
            reasoningTokens:
              total.reasoningTokens +
              (turnUsage?.outputTokenDetails?.reasoningTokens ?? 0),
          }),
          {
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
          }
        )
      : null

    // A turn waiting on approvals parks in its bridge: suspendTurn() keeps
    // the process and returns how to reattach. Otherwise stop() returns the
    // thread's id.
    const waiting = !aborted && session.hasUnfinishedTurn()
    const continuation = waiting ? await session.suspendTurn() : null
    const state = continuation ?? (await session.stop())
    settled = true
    const threadId = (state.data as { threadId?: unknown } | null)?.threadId
    const rollout = await readRollout(
      sandbox,
      codexHome,
      typeof threadId === "string"
        ? threadId
        : (saved?.head.harnessSessionId ?? null),
      saved
    )
    return {
      aborted,
      usage,
      modelId: totals.at(-1)?.[1]?.modelId ?? null,
      responseMessages: totals.flatMap(([, , messages]) => messages),
      save: withContinuation(rollout.save, saved, continuation),
      pendingApprovals: [...(continuation?.pendingToolApprovals ?? [])],
      pendingToolResults: [...(continuation?.pendingToolResults ?? [])],
      contextUsage: rollout.text ? codexContextUsage(rollout.text) : null,
    }
  } finally {
    // Lor supplies the sandbox, so neither leaves it running down.
    if (!settled) await session.destroy().catch(() => {})
  }
}

// A turn that pauses, or finishes or drops a paused turn, saves its
// continuation even with no new rollout bytes.
function withContinuation(
  log: Omit<PiTurnSave, "continuation"> | null,
  saved: SavedHarnessState | null,
  continuation: HarnessAgentContinueTurnState | null
): PiTurnSave | null {
  if (log) return { ...log, continuation }
  if (!saved || (saved.continuation === null && continuation === null)) {
    return null
  }
  return {
    binding: CODEX_BINDING,
    expected: saved.head,
    head: saved.head,
    log: { kind: "append", text: "" },
    continuation,
  }
}

// Codex's own count after the turn, from the rollout's last token_count
// event: the last request's tokens are what fills the window (its
// tokens_in_context_window). Codex compacts at about 90% of the window.
function codexContextUsage(text: string): PiContextUsage | null {
  const lines = text.split("\n")
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? ""
    if (!line.includes('"token_count"')) continue
    try {
      const entry = JSON.parse(line) as {
        payload?: {
          type?: unknown
          info?: {
            last_token_usage?: { total_tokens?: unknown }
            model_context_window?: unknown
          } | null
        }
      }
      if (entry.payload?.type !== "token_count") continue
      const tokens = entry.payload.info?.last_token_usage?.total_tokens
      const window = entry.payload.info?.model_context_window
      if (typeof tokens !== "number" || typeof window !== "number") continue
      if (window <= 0) continue
      return {
        tokens,
        windowTokens: window,
        compactAtTokens: Math.round(window * 0.9),
        compacted: false,
      }
    } catch {}
  }
  return null
}

// The rollout after the turn, as the bytes to save: appended to the saved
// file, or the whole file when Codex rewrote it. Its name ends in the
// thread's id; the path saved is relative to ~/.codex.
async function readRollout(
  sandbox: SandboxSession,
  codexHome: string,
  threadId: string | null,
  saved: SavedHarnessState | null
): Promise<{
  save: Omit<PiTurnSave, "continuation"> | null
  text: string | null
}> {
  const none = { save: null, text: null }
  if (!threadId) {
    // Codex never started a thread: a turn stopped before it started.
    if (!saved) return none
    throw new SessionCoreError(
      "corrupt_state",
      "Codex's thread id is missing after the turn"
    )
  }
  const logFileName =
    saved?.head.harnessSessionId === threadId
      ? saved.head.logFileName
      : (
          await sandbox.run({
            command: `cd ${shellQuote(codexHome)} && find sessions -name ${shellQuote(`*-${threadId}.jsonl`)} | head -1`,
          })
        ).stdout.trim()
  const text = logFileName
    ? await sandbox.readTextFile({ path: `${codexHome}/${logFileName}` })
    : null
  if (text === null) {
    if (!saved) return none
    throw new SessionCoreError(
      "corrupt_state",
      "Codex's rollout file is missing after the turn"
    )
  }
  const head = codexHeadOf(text, logFileName, threadId)
  if (!head || (saved && text === saved.log)) return { save: null, text }
  const appended = saved !== null && text.startsWith(saved.log)
  return {
    save: {
      binding: CODEX_BINDING,
      expected: saved?.head ?? null,
      head,
      log: appended
        ? { kind: "append", text: text.slice(saved.log.length) }
        : saved
          ? { kind: "replace", text }
          : { kind: "append", text },
    },
    text,
  }
}
