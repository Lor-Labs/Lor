import { createHash } from "node:crypto"
import { readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { HarnessAgent } from "@ai-sdk/harness/agent"
import { shellQuote } from "@ai-sdk/harness/utils"
import {
  createPi,
  VERSION as PI_ADAPTER_VERSION,
  type PiHarnessExtensionFactory,
} from "@ai-sdk/harness-pi"
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all"
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent"
import type {
  LanguageModelUsage,
  ModelMessage,
  Experimental_SandboxSession as SandboxSession,
  TextStreamPart,
  ToolApprovalStatus,
  ToolSet,
  UserModelMessage,
} from "ai"
import {
  checkCompatibility,
  type HarnessBinding,
  type HarnessHead,
  type SavedHarnessState,
  type SaveHarnessStateInput,
  SessionCoreError,
} from "./harness-state"

// One Pi turn through Vercel's adapter: restore the saved log into the
// sandbox, run the turn, and return what to save. The caller saves inside its
// own transaction (reference/planned/pi-harness-runbook.md §4.3).

export const PI_BINDING: HarnessBinding = {
  kind: "pi",
  adapterVersion: PI_ADAPTER_VERSION,
  formatVersion: CURRENT_SESSION_VERSION,
}

const GATEWAY_PROVIDER = "vercel-ai-gateway"

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

// Where the adapter keeps Pi's session file: a private sandbox folder named by
// the session id, and a worker copy during the turn. Adapter internals of
// @ai-sdk/harness-pi 1.0.160 — recheck on upgrade.
function sandboxStateRoot(home: string): string {
  return `${home}/.ai-sdk/harness-pi`
}

function hostStateRoot(sessionId: string): string {
  return join(
    tmpdir(),
    "ai-sdk-harness",
    "pi",
    sessionId.replace(/[\\/: ]/g, "-")
  )
}

// The conversation's work folder: the harness default `<pwd>/pi-<sessionId>`
// (sessionWorkDir in @ai-sdk/harness 1.0.158), never a shared fixed folder.
export function piWorkDir(sandboxPwd: string, sessionId: string): string {
  return `${sandboxPwd}/pi-${encodeURIComponent(sessionId)}`
}

async function sandboxHome(sandbox: SandboxSession): Promise<string> {
  const result = await sandbox.run({ command: 'printf %s "$HOME"' })
  const home = result.stdout.trim()
  if (result.exitCode !== 0 || !home) {
    throw new Error("Could not resolve the sandbox home directory")
  }
  return home
}

// Postgres is the authority: overwrite the sandbox copy unless it already
// matches the saved head (standby usually keeps it).
async function restoreLog(
  sandbox: SandboxSession,
  home: string,
  sessionId: string,
  saved: SavedHarnessState
): Promise<void> {
  const path = `${sandboxStateRoot(home)}/${sha256(sessionId)}/${saved.head.logFileName}`
  const current = await sandbox.run({
    command: `sha256sum ${shellQuote(path)} 2>/dev/null | cut -d' ' -f1`,
  })
  if (current.stdout.trim() === saved.head.sha256) return
  await sandbox.writeTextFile({ path, content: saved.log })
}

// Pi's catalog with each window capped at the smallest window in Lor's
// fallback chain, so a fallback model never receives an oversize request.
// This list replaces the provider's whole model list.
function gatewayModels(ids: string[], contextWindow: number) {
  const catalog = getBuiltinModels(GATEWAY_PROVIDER)
  return ids.map((id) => {
    const model = catalog.find((entry) => entry.id === id)
    if (!model) throw new Error(`Model ${id} is not in Pi's gateway catalog`)
    return {
      ...model,
      contextWindow: Math.min(model.contextWindow, contextWindow),
    }
  })
}

// HarnessAgent passes a tool's description through unresolved, and the Pi
// adapter cannot clone an AI SDK v7 dynamic description (a function of the
// tool's context). Resolve it the way streamText does.
function resolveToolDescriptions(
  tools: ToolSet,
  toolsContext: Record<string, unknown> | undefined,
  sandbox: SandboxSession
): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => {
      const description: unknown = tool.description
      if (typeof description !== "function") return [name, tool]
      return [
        name,
        {
          ...tool,
          description: String(
            description({
              context: toolsContext?.[name],
              experimental_sandbox: sandbox,
            })
          ),
        },
      ]
    })
  )
}

function withGatewayOptions(
  payload: unknown,
  gateway: Record<string, unknown>
): unknown {
  if (!payload || typeof payload !== "object") return undefined
  const body = payload as { providerOptions?: Record<string, unknown> }
  const existing = (body.providerOptions?.gateway ?? {}) as Record<
    string,
    unknown
  >
  return {
    ...body,
    providerOptions: {
      ...body.providerOptions,
      gateway: { ...existing, ...gateway },
    },
  }
}

type TurnProbe = { logFile?: string; loadMismatch?: boolean }

// Trusted inline extension: gateway routing on every agent-loop request, and
// the load check. Handler errors are swallowed by Pi, so a mismatch sets a
// flag and aborts instead of throwing.
function lorPiExtension(input: {
  gateway: Record<string, unknown>
  expected: HarnessHead | null
  convertsFormat: boolean
  probe: TurnProbe
}): PiHarnessExtensionFactory {
  return (pi) => {
    pi.on("before_provider_request", (event) =>
      withGatewayOptions(event.payload, input.gateway)
    )
    pi.on("agent_start", (_event, ctx) => {
      input.probe.logFile = ctx.sessionManager.getSessionFile()
      const expected = input.expected
      if (!expected) return
      const entries = ctx.sessionManager.getEntries()
      // A format conversion may rewrite ids; only the count must hold then.
      const matches = input.convertsFormat
        ? entries.length >= expected.entryCount
        : ctx.sessionManager.getHeader()?.id === expected.harnessSessionId &&
          entries.length >= expected.entryCount &&
          entries[expected.entryCount - 1]?.id === expected.headEntryId
      if (!matches) {
        input.probe.loadMismatch = true
        ctx.abort()
      }
    })
  }
}

function headOf(text: string, logFileName: string): HarnessHead | null {
  const lines = text.split("\n").filter((line) => line.trim() !== "")
  if (lines.length < 2) return null
  const header = JSON.parse(lines[0] ?? "") as { id?: unknown }
  const last = JSON.parse(lines[lines.length - 1] ?? "") as { id?: unknown }
  if (typeof header.id !== "string" || typeof last.id !== "string") return null
  return {
    harnessSessionId: header.id,
    logFileName,
    entryCount: lines.length - 1,
    headEntryId: last.id,
    byteLength: Buffer.byteLength(text, "utf8"),
    sha256: sha256(text),
  }
}

export type PiTurnSave = Omit<
  SaveHarnessStateInput,
  "owner" | "workspaceId" | "claim"
>

// Read the worker copy before any lifecycle call deletes it. The saved part
// must be unchanged unless Pi converted an older format.
async function readSave(
  probe: TurnProbe,
  saved: SavedHarnessState | null,
  convertsFormat: boolean
): Promise<PiTurnSave | null> {
  const text = probe.logFile
    ? await readFile(probe.logFile, "utf8").catch((err: unknown) => {
        if ((err as { code?: unknown }).code === "ENOENT") return null
        throw err
      })
    : null
  if (text === null) {
    if (saved) {
      throw new SessionCoreError(
        "corrupt_state",
        "Pi's session file is missing after the turn"
      )
    }
    return null
  }
  if (saved && text === saved.log) return null
  if (saved && !convertsFormat && !text.startsWith(saved.log)) {
    throw new SessionCoreError(
      "corrupt_state",
      "The saved part of Pi's session file changed during the turn"
    )
  }
  const head = probe.logFile ? headOf(text, basename(probe.logFile)) : null
  if (!head) return null
  return {
    binding: PI_BINDING,
    expected: saved?.head ?? null,
    head,
    log:
      saved && convertsFormat
        ? { kind: "replace", text }
        : { kind: "append", text: saved ? text.slice(saved.log.length) : text },
    continuation: null,
  }
}

export type PiTurnInput = {
  // Stable per conversation: names the adapter's session folders.
  sessionId: string
  // The Lor session or call id, sent to the Gateway for session affinity.
  sessionKey: string
  saved: SavedHarnessState | null
  sandbox: SandboxSession
  systemPrompt: string
  // Text first, then images (the adapter rejects text after an image).
  prompt: UserModelMessage
  tools: ToolSet
  toolsContext?: Record<string, unknown>
  // Fixed per turn; tools absent from the map run without approval.
  toolApproval?: Record<string, ToolApprovalStatus>
  model: { id: string; fallbacks: string[]; contextWindow: number }
  gatewayAuth: Record<string, string>
  gatewayOptions: Record<string, unknown>
  abortSignal?: AbortSignal
  onPart: (part: TextStreamPart<ToolSet>) => void | Promise<void>
}

export type PiTurnResult = {
  aborted: boolean
  usage: LanguageModelUsage | null
  modelId: string | null
  // The turn's assistant and tool messages, for write-back.
  responseMessages: ModelMessage[]
  // Null when the turn wrote nothing new.
  save: PiTurnSave | null
}

export async function runPiTurn(input: PiTurnInput): Promise<PiTurnResult> {
  const compatibility = input.saved
    ? checkCompatibility(input.saved, PI_BINDING)
    : null
  const convertsFormat = compatibility?.convertsFormat ?? false

  await rm(hostStateRoot(input.sessionId), { recursive: true, force: true })
  const home = await sandboxHome(input.sandbox)
  if (input.saved) {
    await restoreLog(input.sandbox, home, input.sessionId, input.saved)
  }

  const probe: TurnProbe = {}
  const agent = new HarnessAgent({
    harness: createPi({
      auth: input.gatewayAuth,
      reattachInProcess: false,
      providers: {
        [GATEWAY_PROVIDER]: {
          models: gatewayModels(
            [input.model.id, ...input.model.fallbacks],
            input.model.contextWindow
          ),
        },
      },
      systemPrompt: () => input.systemPrompt,
      contextFiles: false,
      skills: false,
      fileToolPathPolicy: { deniedRoots: [sandboxStateRoot(home)] },
      extensionFactories: [
        lorPiExtension({
          gateway: { ...input.gatewayOptions, sessionId: input.sessionKey },
          expected: input.saved?.head ?? null,
          convertsFormat,
          probe,
        }),
      ],
      thinkingLevel: "high",
    }),
    model: input.model.id,
    tools: resolveToolDescriptions(
      input.tools,
      input.toolsContext,
      input.sandbox
    ),
    // The core takes a generic ToolSet; respond() builds the per-tool context
    // that matches it, so the inferred context type is bridged here.
    ...(input.toolsContext
      ? { toolsContext: input.toolsContext as never }
      : {}),
    ...(input.toolApproval ? { toolApproval: input.toolApproval } : {}),
    headers: { "x-session-id": input.sessionKey },
    // No fixed workDir: the adapter's fs redirect is process-wide and keyed by
    // sandbox path, so each session keeps its own `/workspace/pi-<sessionId>`.
  })

  const session = await agent.createSession({
    sessionId: input.sessionId,
    sandboxSession: input.sandbox,
    ...(input.saved
      ? {
          resumeFrom: {
            type: "resume-session",
            harnessId: "pi",
            specificationVersion: "harness-v1",
            data: { sessionFileName: input.saved.head.logFileName },
          },
        }
      : {}),
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
  })

  try {
    const result = await agent.stream({
      session,
      messages: [input.prompt],
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    })
    let aborted = false
    for await (const part of result.stream) {
      if (part.type === "abort") aborted = true
      await input.onPart(part)
    }
    if (probe.loadMismatch) {
      throw new SessionCoreError(
        "corrupt_state",
        "Pi did not load the saved conversation"
      )
    }
    const [usage, response, responseMessages] = await Promise.all([
      Promise.resolve(result.totalUsage).catch(() => null),
      Promise.resolve(result.response).catch(() => null),
      Promise.resolve(result.responseMessages).catch(() => []),
    ])
    return {
      aborted,
      usage,
      modelId: response?.modelId ?? null,
      responseMessages,
      save: await readSave(probe, input.saved, convertsFormat),
    }
  } finally {
    // Lor supplies the sandbox, so destroy leaves it alone.
    await session.destroy().catch(() => {})
  }
}
