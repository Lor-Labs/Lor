import { createHash } from "node:crypto"
import { HarnessAgent } from "@ai-sdk/harness/agent"
import { shellQuote } from "@ai-sdk/harness/utils"
import {
  VERSION as CLAUDE_CODE_ADAPTER_VERSION,
  createClaudeCode,
} from "@ai-sdk/harness-claude-code"
import type {
  Experimental_SandboxSession as SandboxSession,
  TextStreamPart,
  ToolApprovalStatus,
  ToolSet,
  UserModelMessage,
} from "ai"
import {
  type HarnessBinding,
  type HarnessHead,
  type SavedHarnessState,
  SessionCoreError,
} from "./harness-state"
import {
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

export const CLAUDE_CODE_BINDING: HarnessBinding = {
  kind: "claude_code",
  adapterVersion: CLAUDE_CODE_ADAPTER_VERSION,
  // Claude Code's own file has no format version; this is the save layout's.
  formatVersion: 1,
}

// Claude Code's own tools that Lor switches off: worktrees leave the work
// folder that checkpoints and the Changes panel read; schedules and
// notifications would outlive the turn's process (Loops do this in Lor);
// questions and plan mode need the approval cards of chunk 7d-4; the rest
// publish outside Lor.
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
  "ExitPlanMode",
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
  // Appended to Claude Code's own system prompt (it cannot be replaced).
  instructions: string
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
  if (saved && saved.binding.kind !== "claude_code") {
    throw new SessionCoreError(
      "incompatible_state",
      `This conversation runs on ${saved.binding.kind}, not claude_code`
    )
  }
  const claudeHome = `${await sandboxHome(sandbox)}/.claude`
  // Postgres is the authority: put the saved file back unless it matches.
  if (saved) {
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
    }),
    instructions: input.instructions,
    tools: prepareTools(input.tools, input.toolsContext, sandbox),
    // The core takes a generic ToolSet; respond() builds the matching
    // per-tool context, so the inferred type is bridged here.
    ...(input.toolsContext
      ? { toolsContext: input.toolsContext as never }
      : {}),
    ...(input.toolApproval ? { toolApproval: input.toolApproval } : {}),
    inactiveTools: CLAUDE_CODE_INACTIVE_TOOLS as never,
    // Claude Code's own modes come in chunk 7d-4; until then it works freely
    // in its sandbox, as it does with Bypass permissions.
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
      ...(saved
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
  if (!session) {
    return {
      aborted: true,
      usage: null,
      modelId: null,
      responseMessages: [],
      save: null,
      pendingApprovals: [],
      contextUsage: null,
    }
  }

  let stopped = false
  try {
    let aborted = false
    let contextUsage: PiContextUsage | null = null
    const result = input.prompt
      ? await agent.stream({ session, messages: [input.prompt], ...abort })
      : null
    if (result) {
      for await (const part of result.stream) {
        if (part.type === "abort") aborted = true
        if (part.type === "finish") {
          // The harness sets it on finish; the AI SDK type does not declare it.
          contextUsage = claudeContextUsage(
            (part as { providerMetadata?: unknown }).providerMetadata
          )
        }
        await input.onPart(part)
      }
    }
    aborted ||= Boolean(input.abortSignal?.aborted)
    if (!aborted && session.hasUnfinishedTurn()) {
      throw new Error("Claude Code paused for an approval, which needs 7d-4")
    }
    const [usage, response, responseMessages] = result
      ? await Promise.all([
          Promise.resolve(result.totalUsage).catch(() => null),
          Promise.resolve(result.response).catch(() => null),
          Promise.resolve(result.responseMessages).catch(() => []),
        ])
      : [null, null, []]

    // stop() returns the conversation's id; a turn resumed by id keeps it.
    const state = await session.stop()
    stopped = true
    const claudeSessionId =
      (state.data as { claudeSessionId?: unknown } | null)?.claudeSessionId ??
      saved?.head.harnessSessionId
    const save =
      typeof claudeSessionId === "string"
        ? await readConversation(sandbox, claudeHome, claudeSessionId, saved)
        : null
    return {
      aborted,
      usage: usage
        ? {
            inputTokens: usage.inputTokens ?? 0,
            cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
            reasoningTokens: usage.outputTokenDetails?.reasoningTokens ?? 0,
          }
        : null,
      modelId: response?.modelId ?? null,
      responseMessages,
      save,
      pendingApprovals: [],
      contextUsage,
    }
  } finally {
    // Lor supplies the sandbox, so neither leaves it running down.
    if (!stopped) await session.destroy().catch(() => {})
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
// the saved file, or the whole file when Claude Code rewrote it.
async function readConversation(
  sandbox: SandboxSession,
  claudeHome: string,
  claudeSessionId: string,
  saved: SavedHarnessState | null
): Promise<PiTurnSave | null> {
  const logFileName =
    saved?.head.harnessSessionId === claudeSessionId
      ? saved.head.logFileName
      : (
          await sandbox.run({
            command: `cd ${shellQuote(claudeHome)} && find projects -maxdepth 2 -name ${shellQuote(`${claudeSessionId}.jsonl`)} | head -1`,
          })
        ).stdout.trim()
  if (!logFileName) {
    throw new SessionCoreError(
      "corrupt_state",
      "Claude Code's conversation file is missing after the turn"
    )
  }
  const text = await sandbox.readTextFile({
    path: `${claudeHome}/${logFileName}`,
  })
  if (text === null) {
    throw new SessionCoreError(
      "corrupt_state",
      "Claude Code's conversation file is missing after the turn"
    )
  }
  const head = claudeHeadOf(text, logFileName, claudeSessionId)
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
    continuation: null,
  }
}
