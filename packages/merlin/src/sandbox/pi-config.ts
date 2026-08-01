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

export function buildPiCommand(model: string): string {
  if (!MODEL_ID.test(model)) {
    throw new Error(`Invalid Pi model id: ${model}`)
  }

  return [
    "pi",
    "--mode json",
    "--no-session",
    `--provider ${PI_PROVIDER}`,
    `--model ${model}`,
    "--thinking max",
    "--tools read,grep,find,ls",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--no-approve",
    "@/investigation.txt",
  ].join(" ")
}
