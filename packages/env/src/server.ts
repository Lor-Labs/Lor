import { resolve } from "node:path"
import { config as dotenvConfig } from "dotenv"
import { z } from "zod"

// In development, load .env files. In production, env vars are set by the platform.
if (process.env.NODE_ENV !== "production") {
  dotenvConfig({ path: resolve(process.cwd(), ".env") })
  dotenvConfig({ path: resolve(process.cwd(), "../../.env") })
}

/** Adds a protocol to a URL if missing. Defaults to http:// for localhost/loopback, https:// otherwise. */
const addProtocol = (url: string) => {
  const trimmed = url.trim()
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://"))
    return trimmed
  const isLocal =
    trimmed.startsWith("localhost") || trimmed.startsWith("127.0.0.1")
  return isLocal ? `http://${trimmed}` : `https://${trimmed}`
}

/** 20 MB default — keep in sync with client.ts */
const DEFAULT_MAX_FILE_UPLOAD_SIZE = 20 * 1024 * 1024
const DEFAULT_REALTIME_CORS_ORIGIN =
  "http://localhost:3000,http://localhost:3001,tauri://localhost"

const serverSchema = z.object({
  NODE_ENV: z
    .enum(["development", "staging", "production", "test"])
    .default("production"),
  DATABASE_URL: z.string().url(),
  // Throwaway database for the Merlin eval harness (`pnpm --filter @repo/merlin
  // eval`). When unset, the eval is skipped. Read by the eval bootstrap before
  // @repo/db loads, so it can point the shared client here instead of prod.
  EVAL_DB_URL: z.string().url().optional(),
  // Railway Sandboxes (ephemeral code-exec for GitHub code intelligence, §7.4).
  // Optional: sandbox features are skipped when unset. The `railway` SDK reads
  // these from the environment directly.
  RAILWAY_API_TOKEN: z.string().min(1).optional(),
  RAILWAY_ENVIRONMENT_ID: z.string().min(1).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  REALTIME_PORT: z.coerce.number().int().min(1).max(65535).default(8000),
  REALTIME_CORS_ORIGIN: z.string().default(DEFAULT_REALTIME_CORS_ORIGIN),
  REDIS_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(1),
  // Claude Code CLI in the code-investigation sandbox only; all other
  // inference and embeddings go through the AI Gateway.
  ANTHROPIC_API_KEY: z.string().min(1),
  // Vercel AI Gateway key — routes every model + embedding call.
  AI_GATEWAY_API_KEY: z.string().min(1),
  // Gateway model slug (creator/model). The model MUST output 1536-dim
  // vectors to match the brain_node.embedding column.
  MERLIN_EMBED_MODEL: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().default("openai/text-embedding-3-small")
  ),
  GITHUB_WEBHOOK_SECRET: z.string().min(1).optional(),
  // GitHub App identity for installation-authed REST (fetch_source). Optional:
  // fetch_source falls back to the stored summary when unset.
  GITHUB_APP_ID: z.string().min(1).optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1).optional(),
  // The GitHub App's public slug (github.com/apps/<slug>), for the install link.
  GITHUB_APP_SLUG: z.string().min(1).optional(),
  LINEAR_CLIENT_ID: z.string().min(1).optional(),
  LINEAR_CLIENT_SECRET: z.string().min(1).optional(),
  LINEAR_WEBHOOK_SECRET: z.string().min(1).optional(),
  INTEGRATION_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i)
    .optional(),
  NEXT_PUBLIC_SELF_HOSTED: z
    .preprocess((v) => v === "true" || v === "1", z.boolean())
    .default(false),
  // Autumn billing. Optional: when unset, billing is disabled and all usage
  // is free (dev/self-hosted mode).
  AUTUMN_SECRET_KEY: z.string().min(1).optional(),
  AUTUMN_WEBHOOK_SECRET: z.string().min(1).optional(),
  MAX_FILE_UPLOAD_SIZE: z.coerce.number().default(DEFAULT_MAX_FILE_UPLOAD_SIZE),
  NEXT_PUBLIC_API_URL: z.string().min(1).transform(addProtocol),
  // Public origin of the web app — the base for OAuth redirect URIs (e.g.
  // Linear's callback). Must match the callback URL registered with the
  // provider. Defaults to the dev web server.
  APP_BASE_URL: z
    .string()
    .min(1)
    .default("http://localhost:3000")
    .transform(addProtocol)
    // Drop trailing slashes so callback builders (e.g. `${APP_BASE_URL}/…`)
    // don't produce a double slash in the redirect URI.
    .transform((url) => url.replace(/\/+$/, "")),
  S3_ENDPOINT: z.string().url(),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET_NAME: z.string().min(1),
  S3_REGION: z.string().default("auto"),
  S3_PUBLIC_URL: z.string().url(),
  RESEND_API_KEY: z.string().min(1),
  EMAIL_FROM: z.string().default("Lor <noreply@team.lor.chat>"),
  TRUSTED_ORIGINS: z.string().default(""),
  COOKIE_DOMAIN: z.string().default(""),
})

const refinedServerSchema = serverSchema.superRefine((val, ctx) => {
  if (Boolean(val.RAILWAY_API_TOKEN) !== Boolean(val.RAILWAY_ENVIRONMENT_ID)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "RAILWAY_API_TOKEN and RAILWAY_ENVIRONMENT_ID must be set together",
      path: [
        val.RAILWAY_API_TOKEN ? "RAILWAY_ENVIRONMENT_ID" : "RAILWAY_API_TOKEN",
      ],
    })
  }
  if (Boolean(val.LINEAR_CLIENT_ID) !== Boolean(val.LINEAR_CLIENT_SECRET)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "LINEAR_CLIENT_ID and LINEAR_CLIENT_SECRET must be set together",
      path: [
        val.LINEAR_CLIENT_ID ? "LINEAR_CLIENT_SECRET" : "LINEAR_CLIENT_ID",
      ],
    })
  }
  if (val.LINEAR_CLIENT_ID && !val.INTEGRATION_ENCRYPTION_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "INTEGRATION_ENCRYPTION_KEY is required when Linear (a token-persisting connector) is configured",
      path: ["INTEGRATION_ENCRYPTION_KEY"],
    })
  }
  // Webhooks carry the billing notifications users never trigger themselves
  // (auto top-up receipts/failures, portal-side subscription changes) —
  // production must not ship billing without them. Dev can (no tunnel needed).
  if (
    val.NODE_ENV === "production" &&
    val.AUTUMN_SECRET_KEY &&
    !val.AUTUMN_WEBHOOK_SECRET
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "AUTUMN_WEBHOOK_SECRET is required in production when Autumn billing is enabled",
      path: ["AUTUMN_WEBHOOK_SECRET"],
    })
  }
})

export const env = refinedServerSchema.parse(process.env)
