// Stable id for the global Lor bot user (seeded in seeds/lor.ts).
// Referenced across services without a lookup.
export const LOR_USER_ID = "00000000-0000-4000-8000-000000000001"

// Stable id for the shared app bot user that authors webhook and connector
// notification messages (seeded in seeds/app.ts). The displayed identity comes
// from the message's overrideName/overrideAvatarUrl, not this user.
export const APP_USER_ID = "00000000-0000-4000-8000-000000000002"

// Qwen3 Embedding 4B's native output size. Keep this as the single compile-time
// source of truth for pgvector columns and runtime validation. Changing it
// requires a schema migration and a full re-embed.
export const LOR_EMBED_DIMENSIONS = 2560 as const

// Deprecated Merlin→Lor rename aliases — removed in cleanup (LOR-87 C9).
export const MERLIN_USER_ID = LOR_USER_ID
export const MERLIN_EMBED_DIMENSIONS = LOR_EMBED_DIMENSIONS
