import { createHash } from "node:crypto"
import { posix } from "node:path"
import {
  HarnessAgent,
  type HarnessAgentContinueTurnState,
} from "@ai-sdk/harness/agent"
import { shellQuote } from "@ai-sdk/harness/utils"
import {
  VERSION as CLAUDE_CODE_ADAPTER_VERSION,
  createClaudeCode,
} from "@ai-sdk/harness-claude-code"
import type {
  Experimental_SandboxSession as SandboxSession,
  TextStreamPart,
  ToolApprovalResponse,
  ToolApprovalStatus,
  ToolSet,
  UserModelMessage,
} from "ai"
import {
  checkCompatibility,
  type HarnessBinding,
  type HarnessHead,
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
import { sessionWorkFolder } from "./work-dir"

// One Claude Code turn through Vercel's adapter, on the turn starter's own
// Claude subscription (reference/planned/code-sessions-runbook.md chunk 7d).
// Claude Code keeps a conversation in one append-only JSONL file under
// ~/.claude/projects; like Pi's log it is saved to Postgres per turn and
// written back before the next, so a lost sandbox keeps the conversation.

// Claude Code's own permission modes (SDK permissionMode values).
export type ClaudeCodeMode =
  | "auto"
  | "default"
  | "acceptEdits"
  | "plan"
  | "bypassPermissions"

export const CLAUDE_CODE_BINDING: HarnessBinding = {
  kind: "claude_code",
  adapterVersion: CLAUDE_CODE_ADAPTER_VERSION,
  // Claude Code's own file has no format version; this is the save layout's.
  formatVersion: 1,
}

// Claude Code's own tools that Lor switches off: worktrees leave the work
// folder that checkpoints and the Changes panel read; schedules and
// notifications would outlive the turn's process (Loops do this in Lor);
// questions need their card (chunk 7d-4c); plan mode is the sender's pick in
// the composer, so the model does not enter it itself; the rest publish
// outside Lor.
const CLAUDE_CODE_INACTIVE_TOOLS = [
  "EnterWorktree",
  "ExitWorktree",
  "CronCreate",
  "CronDelete",
  "CronList",
  "ScheduleWakeup",
  "RemoteTrigger",
  "PushNotification",
  "askUserQuestions",
  "EnterPlanMode",
  "Artifact",
  "DesignSync",
  "SendUserFile",
  "ShareOnboardingGuide",
]

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

// `logFileName` is the file's path under ~/.claude, so a restore needs no
// knowledge of how Claude Code names project folders.
function claudeHeadOf(
  text: string,
  logFileName: string,
  claudeSessionId: string
): HarnessHead | null {
  const lines = text.split("\n").filter((line) => line.trim() !== "")
  if (lines.length === 0) return null
  let lastId: unknown
  try {
    lastId = (JSON.parse(lines[lines.length - 1] ?? "") as { uuid?: unknown })
      .uuid
  } catch {}
  return {
    harnessSessionId: claudeSessionId,
    logFileName,
    entryCount: lines.length,
    headEntryId: typeof lastId === "string" ? lastId : String(lines.length),
    byteLength: Buffer.byteLength(text, "utf8"),
    sha256: sha256(text),
  }
}

export type ClaudeCodeTurnInput = {
  // Lor's session id: the harness session, and the work folder's name.
  sessionId: string
  saved: SavedHarnessState | null
  sandbox: SandboxSession
  // The bridge's port in the sandbox and how the worker reaches it.
  bridge: {
    port: number
    endpoint: { url: string; headers: Record<string, string> }
  }
  // The turn starter's token reaches Anthropic through the sandbox proxy;
  // Claude Code only ever sees this placeholder.
  tokenPlaceholder: string
  // Claude Code's own permission mode. Its prompts pause the turn as builtin
  // approvals; Bypass raises none.
  mode: ClaudeCodeMode
  // Appended to Claude Code's own system prompt (it cannot be replaced).
  instructions: string
  // A paused turn in `saved` continues first, through its bridge process,
  // with one decision per pending approval. Then `prompt`, when given, starts
  // a new turn in the same conversation.
  decisions?: ToolApprovalResponse[]
  // Drop the paused turn instead (stopped, saved by another adapter version,
  // or its bridge is gone): the conversation goes on from its file, where
  // Claude Code reads the waiting calls as interrupted (7d-4a spike).
  dropPaused?: boolean
  prompt?: UserModelMessage
  tools: ToolSet
  toolsContext?: Record<string, unknown>
  toolApproval?: Record<string, ToolApprovalStatus>
  abortSignal?: AbortSignal
  onPart: (part: TextStreamPart<ToolSet>) => void | Promise<void>
}

export async function runClaudeCodeTurn(
  input: ClaudeCodeTurnInput
): Promise<PiTurnResult> {
  const { saved, sandbox } = input
  const compatibility = saved
    ? checkCompatibility(saved, CLAUDE_CODE_BINDING)
    : null
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
  const claudeHome = `${await sandboxHome(sandbox)}/.claude`
  // Postgres is the authority: put the saved file back unless it matches. A
  // paused turn's bridge still holds the file and appends to it, so it stays.
  if (saved && !paused) {
    const path = `${claudeHome}/${saved.head.logFileName}`
    const current = await sandbox.run({
      command: `sha256sum ${shellQuote(path)} 2>/dev/null | cut -d' ' -f1`,
    })
    if (current.stdout.trim() !== saved.head.sha256) {
      await sandbox.writeTextFile({ path, content: saved.log })
    }
  }

  const agent = new HarnessAgent({
    harness: createClaudeCode({
      auth: { CLAUDE_CODE_OAUTH_TOKEN: input.tokenPlaceholder },
      port: input.bridge.port,
      portEndpoint: input.bridge.endpoint,
      // Lor's adapter patch: Claude Code decides what to ask in its own mode.
      ...(input.mode === "bypassPermissions"
        ? {}
        : { nativePermissionMode: input.mode }),
    }),
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
    inactiveTools: CLAUDE_CODE_INACTIVE_TOOLS as never,
    // With a native mode the bridge ignores this; a value other than
    // allow-all keeps the harness's builtin-approval check on.
    permissionMode:
      input.mode === "bypassPermissions" ? "allow-all" : "allow-reads",
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
      // still runs; through a dead one the continue never settles).
      ...(paused
        ? { continueFrom: paused }
        : saved
          ? {
              resumeFrom: {
                type: "resume-session" as const,
                harnessId: "claude-code",
                specificationVersion: "harness-v1" as const,
                data: { claudeSessionId: saved.head.harnessSessionId },
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
    let contextUsage: PiContextUsage | null = null
    const results: Awaited<ReturnType<typeof agent.stream>>[] = []
    const drain = async (result: Awaited<ReturnType<typeof agent.stream>>) => {
      results.push(result)
      for await (const part of result.stream) {
        if (part.type === "abort") aborted = true
        if (part.type === "finish") {
          // The harness sets it on finish; the AI SDK type does not declare it.
          contextUsage =
            claudeContextUsage(
              (part as { providerMetadata?: unknown }).providerMetadata
            ) ?? contextUsage
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
    // conversation's id; a turn resumed by id keeps it.
    const waiting = !aborted && session.hasUnfinishedTurn()
    const continuation = waiting ? await session.suspendTurn() : null
    const state = continuation ?? (await session.stop())
    settled = true
    const named = (state.data as { claudeSessionId?: unknown } | null)
      ?.claudeSessionId
    const log = await readConversation(
      sandbox,
      claudeHome,
      typeof named === "string"
        ? named
        : (saved?.head.harnessSessionId ?? null),
      input.sessionId,
      saved
    )
    return {
      aborted,
      usage,
      modelId: totals.at(-1)?.[1]?.modelId ?? null,
      responseMessages: totals.flatMap(([, , messages]) => messages),
      save: withContinuation(log, saved, continuation),
      pendingApprovals: [...(continuation?.pendingToolApprovals ?? [])],
      contextUsage,
    }
  } finally {
    // Lor supplies the sandbox, so neither leaves it running down.
    if (!settled) await session.destroy().catch(() => {})
  }
}

// A turn that pauses, or finishes or drops a paused turn, saves its
// continuation even with no new conversation bytes.
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
    binding: CLAUDE_CODE_BINDING,
    expected: saved.head,
    head: saved.head,
    log: { kind: "append", text: "" },
    continuation,
  }
}

// Claude Code's own /context count, which Lor's bridge patch puts on the
// finish part (getContextUsage "full"; patches/@ai-sdk__harness-claude-code).
// Its total is the last request's input; the window is the model's own
// (1M for Sonnet 5.5), and Claude Code compacts at its threshold.
function claudeContextUsage(metadata: unknown): PiContextUsage | null {
  const usage = (
    metadata as {
      "claude-code"?: {
        contextUsage?: {
          totalTokens?: unknown
          rawMaxTokens?: unknown
          autoCompactThreshold?: unknown
          categories?: unknown
        }
      }
    } | null
  )?.["claude-code"]?.contextUsage
  if (
    typeof usage?.totalTokens !== "number" ||
    typeof usage.rawMaxTokens !== "number" ||
    !Array.isArray(usage.categories)
  ) {
    return null
  }
  return {
    tokens: usage.totalTokens,
    windowTokens: usage.rawMaxTokens,
    compactAtTokens:
      typeof usage.autoCompactThreshold === "number"
        ? usage.autoCompactThreshold
        : usage.rawMaxTokens,
    compacted: false,
    categories: (usage.categories as { name: string; tokens: number }[]).map(
      ({ name, tokens }) => ({ name, tokens })
    ),
  }
}

// The conversation file after the turn, as the bytes to save: appended to
// the saved file, or the whole file when Claude Code rewrote it. A new
// conversation's first turn that paused has no id yet (the adapter learns it
// at the turn's end): its file is the newest in the session's project folder,
// named by the id (7d-4a spike).
async function readConversation(
  sandbox: SandboxSession,
  claudeHome: string,
  claudeSessionId: string | null,
  sessionId: string,
  saved: SavedHarnessState | null
): Promise<Omit<PiTurnSave, "continuation"> | null> {
  const find = claudeSessionId
    ? `find projects -maxdepth 2 -name ${shellQuote(`${claudeSessionId}.jsonl`)} | head -1`
    : `ls -t projects/*${shellQuote(sessionWorkFolder(sessionId))}/*.jsonl 2>/dev/null | head -1`
  const logFileName =
    claudeSessionId && saved?.head.harnessSessionId === claudeSessionId
      ? saved.head.logFileName
      : (
          await sandbox.run({
            command: `cd ${shellQuote(claudeHome)} && ${find}`,
          })
        ).stdout.trim()
  const text = logFileName
    ? await sandbox.readTextFile({ path: `${claudeHome}/${logFileName}` })
    : null
  if (text === null) {
    // Claude Code never wrote: a turn stopped before it started.
    if (!saved) return null
    throw new SessionCoreError(
      "corrupt_state",
      "Claude Code's conversation file is missing after the turn"
    )
  }
  const head = claudeHeadOf(
    text,
    logFileName,
    claudeSessionId ?? posix.basename(logFileName, ".jsonl")
  )
  if (!head) return null
  if (saved && text === saved.log) return null
  const appended = saved !== null && text.startsWith(saved.log)
  return {
    binding: CLAUDE_CODE_BINDING,
    expected: saved?.head ?? null,
    head,
    log: appended
      ? { kind: "append", text: text.slice(saved.log.length) }
      : saved
        ? { kind: "replace", text }
        : { kind: "append", text },
  }
}
