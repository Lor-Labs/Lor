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
const PATH_ARG = /^\/[a-zA-Z0-9._/-]+$/
const SESSION_ID = /^[a-f0-9-]{36}$/

export function buildPiCommand(
  model: string,
  opts?: {
    tools?: readonly string[]
    promptFile?: string
    // Persistent session (conversation continuity): the session file lives under
    // `dir` and --session-id creates it if missing (restored in pi 0.84 —
    // 0.71–0.73 could only resume by id). Verified: resuming does not
    // re-emit prior events (no double usage). Omit for ephemeral
    // --no-session runs.
    session?: { dir: string; id: string }
    // Explicit non-interactive mode, required by pi ≥0.71 (the Blaxel image,
    // pinned 0.84.1). Railway's older pi build predates the flag and runs
    // non-interactively without it.
    print?: boolean
  }
): string {
  if (!MODEL_ID.test(model)) {
    throw new Error(`Invalid Pi model id: ${model}`)
  }
  const tools = opts?.tools ?? READ_ONLY_PI_TOOLS
  for (const t of tools) {
    if (!TOOL_NAME.test(t)) throw new Error(`Invalid Pi tool name: ${t}`)
  }
  const promptFile = opts?.promptFile ?? "/investigation.txt"
  if (!PATH_ARG.test(promptFile)) {
    throw new Error(`Invalid Pi prompt file: ${promptFile}`)
  }
  const session = opts?.session
  if (session) {
    if (!PATH_ARG.test(session.dir)) {
      throw new Error(`Invalid Pi session dir: ${session.dir}`)
    }
    if (!SESSION_ID.test(session.id)) {
      throw new Error(`Invalid Pi session id: ${session.id}`)
    }
  }

  return [
    "pi",
    "--mode json",
    ...(opts?.print ? ["-p"] : []),
    session
      ? `--session-dir ${session.dir} --session-id ${session.id}`
      : "--no-session",
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
