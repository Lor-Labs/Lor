import { resolve } from "node:path"
import { config as dotenvConfig } from "dotenv"
import { z } from "zod"

// In development, load .env files. In production, env vars are set by the platform.
if (process.env.NODE_ENV !== "production") {
  dotenvConfig({ path: resolve(process.cwd(), ".env") })
  dotenvConfig({ path: resolve(process.cwd(), "../../.env") })
}

export const blankToUndefined = (value: unknown) => {
  if (typeof value !== "string") return value
  const trimmed = value.trim()
  return trimmed === "" ? undefined : trimmed
}

// The server variables that shared packages (the database client, the voice
// package) read for themselves. They validate only what they use, so the
// transcriber runs with just its own few variables instead of every server
// secret. The full server schema (server.ts) includes all of these.
export const sharedServerFields = {
  BETTERSTACK_ERRORS_DSN: z.preprocess(
    blankToUndefined,
    z.string().url().optional()
  ),
  BETTERSTACK_ALERT_WEBHOOK_ID: z.preprocess(
    blankToUndefined,
    z.string().uuid().optional()
  ),
  NODE_ENV: z
    .enum(["development", "staging", "production", "test"])
    .default("production"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  // Vercel AI Gateway is Lor's explicit transport. Model-role selection
  // remains provider-neutral through the LOR_* model ids.
  AI_GATEWAY_API_KEY: z.string().min(1),
  // LiveKit Cloud carries voice channel media. When unset, voice join returns
  // 503 instead of failing at boot.
  LIVEKIT_URL: z.preprocess(blankToUndefined, z.string().url().optional()),
  LIVEKIT_API_KEY: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  LIVEKIT_API_SECRET: z.preprocess(
    blankToUndefined,
    z.string().min(1).optional()
  ),
  // Voice transcription (apps/transcriber only).
  DEEPGRAM_API_KEY: z.preprocess(
    blankToUndefined,
    z.string().min(1).optional()
  ),
}

type SharedServerFields = typeof sharedServerFields

// Validates and returns only the named variables:
// readServerEnv("DATABASE_URL", "REDIS_URL").
export function readServerEnv<K extends keyof SharedServerFields>(
  ...keys: K[]
) {
  const shape = Object.fromEntries(
    keys.map((key) => [key, sharedServerFields[key]])
  ) as Pick<SharedServerFields, K>
  return z.object(shape).parse(process.env)
}
