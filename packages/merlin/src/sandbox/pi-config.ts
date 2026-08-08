const DEFAULT_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1"
const PI_PROVIDER = "vercel-ai-gateway"
const MODEL_ID = /^[a-zA-Z0-9._:/-]+$/

export function buildPiModelConfig(options: {
  baseUrl?: string
  model: string
}) {
  return {
    providers: {
      [PI_PROVIDER]: {
        baseUrl: options.baseUrl ?? DEFAULT_GATEWAY_BASE_URL,
        api: "openai-completions",
        apiKey: "$AI_GATEWAY_API_KEY",
        models: [
          {
            id: options.model,
            name: options.model,
            reasoning: true,
            input: ["text"],
            // Billing rates live in @repo/db. Keeping Pi's rates at zero avoids
            // maintaining a second price table inside the sandbox config.
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 1_048_576,
            // Code investigations should never need an unbounded final answer.
            maxTokens: 32_000,
            compat: {
              supportsDeveloperRole: false,
              supportsStrictMode: false,
              requiresReasoningContentOnAssistantMessages: true,
            },
          },
        ],
      },
    },
  }
}

// Read-only exploration (code investigations).
export const READ_ONLY_PI_TOOLS = ["read", "grep", "find", "ls"] as const
// Full workbench: the agent writes files and runs scripts to produce
// deliverables. Verified against the sandbox image by sandbox:smoke.
export const WORKBENCH_PI_TOOLS = [
  "read",
  "grep",
  "find",
  "ls",
  "write",
  "edit",
  "bash",
] as const

const TOOL_NAME = /^[a-z_-]+$/
const PROMPT_FILE = /^\/[a-zA-Z0-9._/-]+$/

export function buildPiCommand(
  model: string,
  opts?: { tools?: readonly string[]; promptFile?: string }
): string {
  if (!MODEL_ID.test(model)) {
    throw new Error(`Invalid Pi model id: ${model}`)
  }
  const tools = opts?.tools ?? READ_ONLY_PI_TOOLS
  for (const t of tools) {
    if (!TOOL_NAME.test(t)) throw new Error(`Invalid Pi tool name: ${t}`)
  }
  const promptFile = opts?.promptFile ?? "/investigation.txt"
  if (!PROMPT_FILE.test(promptFile)) {
    throw new Error(`Invalid Pi prompt file: ${promptFile}`)
  }

  return [
    "pi",
    "--mode json",
    "--no-session",
    `--provider ${PI_PROVIDER}`,
    `--model ${model}`,
    "--thinking max",
    `--tools ${tools.join(",")}`,
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--no-approve",
    `@${promptFile}`,
  ].join(" ")
}
