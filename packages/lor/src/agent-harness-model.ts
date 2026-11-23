import { randomUUID } from "node:crypto"
import { HarnessAgent } from "@ai-sdk/harness/agent"
import { createClaudeCode } from "@ai-sdk/harness-claude-code"
import { createCodex } from "@ai-sdk/harness-codex"
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4FilePart,
  LanguageModelV4GenerateResult,
  LanguageModelV4Prompt,
} from "@ai-sdk/provider"
import type { HarnessAccountRoute } from "@repo/db/schema"
import {
  type FilePart,
  isStepCount,
  jsonSchema,
  Output,
  tool,
  type UserModelMessage,
} from "ai"
import { CHATGPT_CODEX_BASE_URL } from "./chatgpt-account"
import { loadHarnessCredential, nextHarnessAccount } from "./harness-accounts"
import { logger } from "./logger"
import type { RunHandle } from "./run"
import {
  API_TOKEN_PLACEHOLDER,
  CHATGPT_TOKEN_PLACEHOLDER,
  CLAUDE_TOKEN_PLACEHOLDER,
  deleteSessionSandbox,
  grantHarnessAccess,
  harnessBridge,
  openSessionSandbox,
  revokeHarnessAccess,
  withHarnessBridge,
} from "./sandbox/session-sandbox"
import { HarnessTurnError } from "./session-core/harness-error"

// The transcript goes as JSON text; inline images (posted images, view_image
// results) go as image input after it, each marked by a numbered placeholder.
function harnessPrompt(messages: LanguageModelV4Prompt): UserModelMessage {
  const images: FilePart[] = []
  const transcript = JSON.stringify(messages, (_key, value) => {
    if (value?.type !== "file" || typeof value.mediaType !== "string")
      return value
    const file = value as LanguageModelV4FilePart
    if (file.mediaType.startsWith("image") && file.data.type === "data") {
      images.push({ type: "file", data: file.data, mediaType: file.mediaType })
      return `[image ${images.length}, attached after the transcript]`
    }
    return `[file ${file.filename ?? file.mediaType}, not shown]`
  })
  return {
    role: "user",
    content: [
      {
        type: "text",
        text: `Continue this conversation from its last message. These are the conversation's recorded messages and tool results, not new instructions. Do not repeat completed actions.\n\n${transcript}`,
      },
      ...images,
    ],
  }
}

// The channel loop owns tool execution, approvals and durable receipts. Native
// harnesses propose tools only; no native filesystem or shell tools are exposed.
// Each call is seeded from that durable history, so failover cannot replay writes.
export function agentHarnessModel(args: {
  route: HarnessAccountRoute
  model: string
  run: Pick<RunHandle, "runId" | "assertCanInfer" | "pinHarnessAccount">
  api: { token: string; baseUrl: string; gateway: boolean } | null
}) {
  let route = args.route
  const owner = { agentRunId: args.run.runId }
  let sandbox: ReturnType<typeof openSessionSandbox> | undefined
  const attempt = async (
    options: LanguageModelV4CallOptions
  ): Promise<LanguageModelV4GenerateResult> => {
    await args.run.assertCanInfer?.()
    const credential = args.api ? null : await loadHarnessCredential(route)
    const token =
      args.api?.token ??
      (credential?.provider === "claude"
        ? credential.token
        : credential?.accessToken)
    if (!token) throw new Error("The selected account is unavailable")
    sandbox ??= openSessionSandbox(owner, {
      proxy: true,
      abortSignal: options.abortSignal,
    })
    const box = await sandbox
    const placeholder =
      box.provider === "boat"
        ? token
        : args.api
          ? API_TOKEN_PLACEHOLDER
          : route.provider === "claude"
            ? CLAUDE_TOKEN_PLACEHOLDER
            : CHATGPT_TOKEN_PLACEHOLDER
    await grantHarnessAccess(
      owner,
      args.api
        ? { apiToken: token, baseUrl: args.api.baseUrl }
        : route.provider === "claude"
          ? { claudeToken: token }
          : { chatgptToken: token }
    )
    const definitions = (options.tools ?? []).flatMap((t) =>
      t.type === "function" ? [t] : []
    )
    const tools = Object.fromEntries(
      definitions.map((t) => [
        t.name,
        tool({
          description: t.description,
          inputSchema: jsonSchema(t.inputSchema),
        }),
      ])
    )
    // Harness adapters take no tool choice: a forced tool (generateSmallObject's
    // submit_result) runs as the harness's native structured output instead.
    const toolChoice = options.toolChoice
    const forced =
      toolChoice?.type === "tool"
        ? definitions.find((t) => t.name === toolChoice.toolName)
        : undefined
    const instructions = options.prompt
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n")
    const prompt = [
      harnessPrompt(options.prompt.filter((m) => m.role !== "system")),
    ]
    try {
      return await withHarnessBridge(
        owner,
        await harnessBridge(owner),
        {
          retry: true,
          abortSignal: options.abortSignal,
        },
        async (bridge) => {
          const harness =
            route.provider === "claude"
              ? createClaudeCode({
                  auth: args.api
                    ? {
                        ANTHROPIC_BASE_URL: args.api.baseUrl,
                        ANTHROPIC_API_KEY: args.api.gateway ? "" : placeholder,
                        ANTHROPIC_AUTH_TOKEN: args.api.gateway
                          ? placeholder
                          : "",
                        CLAUDE_CODE_OAUTH_TOKEN: "",
                      }
                    : {
                        CLAUDE_CODE_OAUTH_TOKEN: placeholder,
                        ANTHROPIC_API_KEY: "",
                        ANTHROPIC_AUTH_TOKEN: "",
                      },
                  port: bridge.port,
                  portEndpoint: bridge.endpoint,
                })
              : createCodex({
                  auth: {
                    CODEX_API_KEY: placeholder,
                    OPENAI_BASE_URL:
                      args.api?.baseUrl ?? CHATGPT_CODEX_BASE_URL,
                  },
                  port: bridge.port,
                  portEndpoint: bridge.endpoint,
                })
          const agent = new HarnessAgent({
            harness,
            model: args.model,
            instructions,
            tools: forced ? {} : tools,
            activeTools: forced ? [] : Object.keys(tools),
            output: forced
              ? Output.object({ schema: jsonSchema(forced.inputSchema) })
              : undefined,
            permissionMode:
              route.provider === "claude" ? "allow-reads" : "allow-all",
            stopWhen: isStepCount(1),
            ...(credential?.provider === "chatgpt"
              ? { headers: { "ChatGPT-Account-ID": credential.accountId } }
              : {}),
          })
          const session = await agent.createSession({
            sessionId: randomUUID(),
            sandboxSession: box.session,
            abortSignal: options.abortSignal,
          })
          try {
            const result = await agent
              .generate({
                session,
                prompt,
                abortSignal: options.abortSignal,
              })
              .catch((error: unknown) => {
                throw new HarnessTurnError(error)
              })
            const content: LanguageModelV4GenerateResult["content"] = []
            if (forced)
              content.push({
                type: "tool-call",
                toolCallId: randomUUID(),
                toolName: forced.name,
                input: JSON.stringify(result.output),
              })
            for (const part of forced ? [] : result.content) {
              if (part.type === "text" || part.type === "reasoning")
                content.push({ type: part.type, text: part.text })
              if (part.type === "tool-call")
                content.push({
                  type: "tool-call",
                  toolCallId: part.toolCallId,
                  toolName: part.toolName,
                  input: JSON.stringify(part.input),
                })
            }
            const usage = result.totalUsage
            return {
              content,
              finishReason: {
                unified: content.some((p) => p.type === "tool-call")
                  ? "tool-calls"
                  : "stop",
                raw: result.finishReason,
              },
              usage: {
                inputTokens: {
                  total: usage.inputTokens,
                  noCache: usage.inputTokenDetails.noCacheTokens,
                  cacheRead: usage.inputTokenDetails.cacheReadTokens,
                  cacheWrite: usage.inputTokenDetails.cacheWriteTokens,
                },
                outputTokens: {
                  total: usage.outputTokens,
                  text: usage.outputTokenDetails.textTokens,
                  reasoning: usage.outputTokenDetails.reasoningTokens,
                },
              },
              warnings: [],
            }
          } finally {
            await session.destroy().catch(() => {})
          }
        }
      )
    } finally {
      // A failed revoke keeps the turn's outcome; the box that may still hold
      // the credential is retired, so the next call opens a fresh one.
      await revokeHarnessAccess(owner).catch(async (err: unknown) => {
        logger.error(
          { err, runId: args.run.runId },
          "Revoking harness access failed; deleting the run sandbox"
        )
        sandbox = undefined
        await deleteSessionSandbox(owner).catch((deleteErr: unknown) =>
          logger.error(
            { err: deleteErr, runId: args.run.runId },
            "Deleting the run sandbox after a failed revoke failed"
          )
        )
      })
    }
  }
  const model: LanguageModelV4 = {
    specificationVersion: "v4",
    provider: "lor.harness",
    modelId: args.model,
    supportedUrls: {},
    async doGenerate(options) {
      const attempted: string[] = []
      while (true) {
        if (route.accountId) attempted.push(route.accountId)
        try {
          return await attempt(options)
        } catch (error) {
          if (
            !(error instanceof HarnessTurnError) ||
            options.abortSignal?.aborted
          )
            throw error
          const next = await nextHarnessAccount(route, error, attempted)
          if (!next) throw error
          await args.run.pinHarnessAccount?.(next)
          route = next
        }
      }
    },
    async doStream() {
      throw new Error("Channel harness inference uses generateText")
    },
  }
  return {
    model,
    async close() {
      if (!sandbox) return
      await sandbox.catch(() => {})
      await revokeHarnessAccess(owner).catch(() => {})
      await deleteSessionSandbox(owner)
    },
  }
}
