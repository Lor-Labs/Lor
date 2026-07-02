// Gateway model slugs (creator/model). Fallbacks are tried by the gateway
// when every provider for the model ahead of them fails.
export const MERLIN_MODEL = "anthropic/claude-sonnet-4.6"
export const MERLIN_FALLBACK_MODEL = "openai/gpt-5.5"

// Small tier: gate, reply placement, source summaries.
export const MERLIN_SMALL_MODEL = "anthropic/claude-haiku-4.5"
export const MERLIN_SMALL_FALLBACK_MODEL = "openai/gpt-5.4-nano"
