import { z } from "zod"
import { blankToUndefined, sharedServerFields } from "./server-fields.js"

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

const defaultedString = (fallback: string) =>
  z.preprocess(blankToUndefined, z.string().min(1).default(fallback))

const serverSchema = z.object({
  ...sharedServerFields,
  // Throwaway database for the Lor eval harness (`pnpm --filter @repo/lor
  // eval`). When unset, the eval is skipped. Read by the eval bootstrap before
  // @repo/db loads, so it can point the shared client here instead of prod.
  EVAL_DB_URL: z.string().url().optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  REALTIME_PORT: z.coerce.number().int().min(1).max(65535).default(8000),
  REALTIME_CORS_ORIGIN: z.string().default(DEFAULT_REALTIME_CORS_ORIGIN),
  BETTER_AUTH_SECRET: z.string().min(1),
  // Optional server-only destination for account signup and waitlist notifications.
  SIGNUP_WEBHOOK_URL: z.preprocess(
    blankToUndefined,
    z
      .url({ protocol: /^https$/ })
      .or(
        z.url({
          protocol: /^http$/,
          hostname: /^(?:localhost|.*\.localhost|127(?:\.\d{1,3}){3}|\[::1\])$/,
        })
      )
      .optional()
  ),
  AI_GATEWAY_BASE_URL: z.preprocess(
    blankToUndefined,
    z.string().url().optional()
  ),
  // Main agent model (LOR-104), picked on the long-task eval
  // (`pnpm --filter @repo/lor eval:long`). GLM 5.3 Flash stays on small tasks:
  // it truncates citation ids and degenerates in long multi-tool runs.
  LOR_MODEL: defaultedString("deepseek/deepseek-v4.1-flash"),
  LOR_MODEL_FALLBACKS: defaultedString("moonshotai/kimi-k3"),
  // Gateway provider order for the main model and its fallbacks; a provider
  // that doesn't serve a model is skipped. DeepInfra serves DeepSeek with
  // ~97% cache hits. Kimi K3 streams stalled on DeepInfra, so Moonshot first.
  LOR_MODEL_PROVIDER_ORDER: defaultedString("moonshotai,deepinfra"),
  LOR_SMALL_MODEL: defaultedString("zai/glm-5.3-flash"),
  LOR_SMALL_MODEL_FALLBACKS: defaultedString("moonshotai/kimi-k3"),
  // Smallest real context window across LOR_MODEL and its fallbacks — the
  // one that actually binds, since the gateway may route to any of them
  // mid-run. Verified 2026-10-14 (gateway endpoints): mimo-v2.6-pro routes
  // list 1,048,576 to 1,050,000, kimi-k3 routes 1,000,000 to 1,048,576. Pi
  // gets every model's window capped at this, so it compacts in time for
  // all of them (pi-harness-runbook.md §4.4).
  LOR_CONTEXT_WINDOW: z.coerce.number().int().positive().default(1_000_000),
  // Agent-run limits (pi-harness-runbook.md §4.5): spend is the real limit,
  // the wall clock a backstop for a stuck run, and the per-call output cap
  // protects the context. Wall clock and credits are snapshotted onto each
  // agent_run row at creation, so a change never alters an in-flight run.
  AGENT_RUN_MAX_TOOL_OUTPUT_BYTES_PER_CALL: z.coerce
    .number()
    .int()
    .positive()
    .default(262_144),
  AGENT_RUN_MAX_WALL_MS: z.coerce.number().int().positive().default(7_200_000),
  AGENT_RUN_MAX_PROVIDER_RETRIES: z.coerce.number().int().min(0).default(3),
  AGENT_RUN_MAX_CREDITS: z.coerce.number().int().positive().default(2_000),
  // Bounds one file share_file copies from a session sandbox into artifacts.
  LOR_WORKBENCH_MAX_FILE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(104_857_600),
  // Blaxel sandbox provider — the only one. Session sandboxes run on it. The
  // BL_* names are fixed — @blaxel/core reads them from process.env directly.
  BL_API_KEY: z.string().min(1).optional(),
  BL_WORKSPACE: z.string().min(1).optional(),
  // Where session sandboxes are created. It must offer ephemeral volumes and
  // the egress proxy (us-pdx-1 checked 2026-10-23).
  BL_REGION: defaultedString("us-pdx-1"),
  // Custom sandbox image (pushed via `bl push` from packages/lor/sandbox-image).
  LOR_WORKBENCH_IMAGE: defaultedString("sandbox/workbench:latest"),
  LOR_WORKBENCH_MEMORY_MB: z.coerce.number().int().positive().default(4096),
  // Session sandboxes (one per Lor session or call). Blaxel caps the account's
  // total ephemeral volume size (40 GB on Tier 1), and idle sandboxes keep
  // theirs, so the disk is small and sandboxes are deleted after this long
  // idle. Blaxel expiration policies accept hours, days, or weeks only.
  LOR_SESSION_DISK_MB: z.coerce.number().int().positive().default(2048),
  LOR_SESSION_SANDBOX_TTL: z
    .string()
    .regex(/^\d+[hdw]$/, "must be a duration like 24h, 7d, or 2w")
    .default("7d"),
  LOR_EMBED_MODEL: defaultedString("alibaba/qwen3-embedding-4b"),
  LOR_EMBED_DIMENSIONS: z.coerce.number().int().positive().default(2560),
  // Reranks retrieval candidates; on by default, "false" turns it off.
  LOR_RERANK_MODEL: defaultedString("voyage/rerank-2.5"),
  LOR_RERANK_ENABLED: z.preprocess(
    (v) => v !== "false" && v !== "0",
    z.boolean()
  ),
  // Results scoring below this are dropped. rerank-2.5 scored real answers
  // 0.52+ and unrelated ones 0.40 or less (Step 5 live QA,
  // reference/attachment-search.md).
  LOR_RERANK_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.45),
  // Oldest phone app version (app.json "version") the server still works
  // with; older apps show "Update Lor". Raise it only after the new build is
  // in TestFlight. Unset = no app is blocked.
  MOBILE_MIN_VERSION: z.preprocess(
    blankToUndefined,
    z
      .string()
      .regex(/^\d+\.\d+\.\d+$/)
      .optional()
  ),
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
