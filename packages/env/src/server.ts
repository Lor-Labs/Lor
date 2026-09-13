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

/** 100 MB default — keep in sync with client.ts */
const DEFAULT_MAX_FILE_UPLOAD_SIZE = 100 * 1024 * 1024
const DEFAULT_REALTIME_CORS_ORIGIN =
  "http://localhost:3000,http://localhost:3001,tauri://localhost"

const blankToUndefined = (value: unknown) => {
  if (typeof value !== "string") return value
  const trimmed = value.trim()
  return trimmed === "" ? undefined : trimmed
}

const defaultedString = (fallback: string) =>
  z.preprocess(blankToUndefined, z.string().min(1).default(fallback))

const serverSchema = z.object({
  NODE_ENV: z
    .enum(["development", "staging", "production", "test"])
    .default("production"),
  DATABASE_URL: z.string().url(),
  // Throwaway database for the Lor eval harness (`pnpm --filter @repo/lor
  // eval`). When unset, the eval is skipped. Read by the eval bootstrap before
  // @repo/db loads, so it can point the shared client here instead of prod.
  EVAL_DB_URL: z.string().url().optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  REALTIME_PORT: z.coerce.number().int().min(1).max(65535).default(8000),
  REALTIME_CORS_ORIGIN: z.string().default(DEFAULT_REALTIME_CORS_ORIGIN),
  REDIS_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(1),
  // Vercel AI Gateway is Lor's explicit transport. Model-role selection
  // remains provider-neutral through the LOR_* model ids below.
  AI_GATEWAY_API_KEY: z.string().min(1),
  AI_GATEWAY_BASE_URL: z.preprocess(
    blankToUndefined,
    z.string().url().optional()
  ),
  LOR_MODEL: defaultedString("zai/glm-5.3-flash"),
  LOR_MODEL_FALLBACKS: defaultedString("moonshotai/kimi-k3"),
  LOR_SMALL_MODEL: defaultedString("zai/glm-5.3-flash"),
  LOR_SMALL_MODEL_FALLBACKS: defaultedString("moonshotai/kimi-k3"),
  // Per-request input size above which older tool calls are compacted into
  // rolling working notes (packages/lor/src/compaction.ts). MUST stay well
  // under the real context window of EVERY model in the chain — primary and
  // gateway fallbacks — or compaction stops being graceful and the request
  // hard-fails on length.
  LOR_COMPACT_INPUT_TOKENS: z.coerce.number().int().positive().default(700_000),
  // Smallest real context window across LOR_MODEL and its fallbacks — the
  // one that actually binds, since the gateway may route to any of them
  // mid-run. Verified: zai/glm-5.3-flash 1,310,720; moonshotai/kimi-k3
  // 1,048,576. Also bounds request preparation, with headroom reserved for
  // instructions, tools, and output even if the compaction threshold is higher.
  LOR_CONTEXT_WINDOW: z.coerce.number().int().positive().default(1_048_576),
  // HMAC secret binding a tool approval to the exact call/input (AI SDK
  // experimental_toolApprovalSecret). Must match across worker + API.
  // Optional: approval gates enforce without it; setting it hardens resume.
  LOR_TOOL_APPROVAL_SECRET: z.preprocess(
    blankToUndefined,
    z.string().min(32).optional()
  ),
  // Agent-run hard ceilings (reference/agent-harness.md, budgets). Snapshotted
  // onto each agent_run row at creation, so changing these never alters an
  // in-flight run. Emergency rails, not normal stopping targets.
  AGENT_RUN_MAX_STEPS: z.coerce.number().int().positive().default(500),
  AGENT_RUN_MAX_INPUT_TOKENS: z.coerce
    .number()
    .int()
    .positive()
    .default(10_000_000),
  AGENT_RUN_MAX_OUTPUT_TOKENS: z.coerce
    .number()
    .int()
    .positive()
    .default(1_000_000),
  AGENT_RUN_MAX_TOOL_CALLS: z.coerce.number().int().positive().default(1_000),
  AGENT_RUN_MAX_TOOL_OUTPUT_BYTES_PER_CALL: z.coerce
    .number()
    .int()
    .positive()
    .default(262_144),
  AGENT_RUN_MAX_TOOL_OUTPUT_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(16_777_216),
  AGENT_RUN_MAX_WALL_MS: z.coerce.number().int().positive().default(7_200_000),
  AGENT_RUN_MAX_PROVIDER_RETRIES: z.coerce.number().int().min(0).default(3),
  AGENT_RUN_MAX_CREDITS: z.coerce.number().int().positive().default(2_000),
  // Workbench sandbox sessions (create_artifacts): a coding agent produces
  // deliverable files. The timeout bounds one session; the byte/file caps
  // bound what gets harvested out of the sandbox into artifact storage.
  LOR_WORKBENCH_TIMEOUT_SEC: z.coerce.number().int().positive().default(1200),
  LOR_WORKBENCH_MAX_FILE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(104_857_600),
  LOR_WORKBENCH_MAX_TOTAL_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(524_288_000),
  LOR_WORKBENCH_MAX_FILES: z.coerce.number().int().positive().default(20),
  // Blaxel sandbox provider — the only one. When both are set, the workbench
  // runs on Blaxel (per-task persistent sandboxes with standby); when unset,
  // sandbox tools (create_artifacts, investigate_code) are not bound. The BL_*
  // names are fixed — @blaxel/core reads them from process.env directly.
  BL_API_KEY: z.string().min(1).optional(),
  BL_WORKSPACE: z.string().min(1).optional(),
  // Custom sandbox image (pushed via `bl push` from packages/lor/sandbox-image).
  LOR_WORKBENCH_IMAGE: defaultedString("sandbox/workbench:latest"),
  // Idle lifetimes for persistent Blaxel sandboxes. Task contents are durable
  // in R2, while code sandboxes retain unpublished diffs awaiting approval.
  // Blaxel expiration policies accept hours, days, or weeks only.
  LOR_WORKBENCH_SANDBOX_TTL: z
    .string()
    .regex(/^\d+[hdw]$/, "must be a duration like 24h, 7d, or 2w")
    .default("24h"),
  LOR_CODE_SANDBOX_TTL: z
    .string()
    .regex(/^\d+[hdw]$/, "must be a duration like 24h, 7d, or 2w")
    .default("7d"),
  LOR_WORKBENCH_MEMORY_MB: z.coerce.number().int().positive().default(4096),
  // Disk-backed /workspace volume for clones, dependencies, caches, and outputs.
  LOR_WORKBENCH_DISK_MB: z.coerce.number().int().positive().default(8192),
  LOR_EMBED_MODEL: defaultedString("alibaba/qwen3-embedding-4b"),
  LOR_EMBED_DIMENSIONS: z.coerce.number().int().positive().default(2560),
  // Exa, backing Lor's search_web/fetch_web tools. Optional: the tools are
  // omitted when unset.
  EXA_API_KEY: z.string().min(1).optional(),
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
  ATTIO_CLIENT_ID: z.string().min(1).optional(),
  ATTIO_CLIENT_SECRET: z.string().min(1).optional(),
  NOTION_CLIENT_ID: z.string().min(1).optional(),
  NOTION_CLIENT_SECRET: z.string().min(1).optional(),
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
  if (Boolean(val.BL_API_KEY) !== Boolean(val.BL_WORKSPACE)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "BL_API_KEY and BL_WORKSPACE must be set together",
      path: [val.BL_API_KEY ? "BL_WORKSPACE" : "BL_API_KEY"],
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
  if (Boolean(val.ATTIO_CLIENT_ID) !== Boolean(val.ATTIO_CLIENT_SECRET)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "ATTIO_CLIENT_ID and ATTIO_CLIENT_SECRET must be set together",
      path: [val.ATTIO_CLIENT_ID ? "ATTIO_CLIENT_SECRET" : "ATTIO_CLIENT_ID"],
    })
  }
  if (val.ATTIO_CLIENT_ID && !val.INTEGRATION_ENCRYPTION_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "INTEGRATION_ENCRYPTION_KEY is required when Attio (a token-persisting connector) is configured",
      path: ["INTEGRATION_ENCRYPTION_KEY"],
    })
  }
  if (Boolean(val.NOTION_CLIENT_ID) !== Boolean(val.NOTION_CLIENT_SECRET)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "NOTION_CLIENT_ID and NOTION_CLIENT_SECRET must be set together",
      path: [
        val.NOTION_CLIENT_ID ? "NOTION_CLIENT_SECRET" : "NOTION_CLIENT_ID",
      ],
    })
  }
  if (val.NOTION_CLIENT_ID && !val.INTEGRATION_ENCRYPTION_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "INTEGRATION_ENCRYPTION_KEY is required when Notion (a token-persisting connector) is configured",
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
