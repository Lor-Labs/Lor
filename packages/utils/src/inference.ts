export type InferenceFunding =
  | { source: "lor"; model?: string; modelResolved?: boolean }
  | {
      source: "byok"
      keyId: string
      provider: "anthropic" | "openai"
      modelResolved?: boolean
      model: string
    }
