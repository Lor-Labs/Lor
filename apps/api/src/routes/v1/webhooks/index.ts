import { randomUUID, timingSafeEqual } from "node:crypto"
import { and, db, eq, schema } from "@repo/db"
import { env } from "@repo/env/server"
import { decryptSecret } from "@repo/utils/crypto"
import {
  dispatchConnectorEvent,
  type RememberDraft,
} from "@/lib/connector-triggers"
import { createRouter } from "@/lib/helpers/app/create-app"
import { logger } from "@/lib/logger"
import {
  dialectHint,
  discordWebhookBodySchema,
  renderDiscordWebhookBody,
  renderSlackWebhookBody,
  slackWebhookBodySchema,
} from "@/lib/webhook-payloads"
import { rateLimiter } from "@/middleware/rate-limit"
import * as handlers from "@/routes/v1/webhooks/handlers"
import * as routes from "@/routes/v1/webhooks/routes"
import { executeWebhookBodySchema } from "@/routes/v1/webhooks/schema"

const webhooksRouter = createRouter()
  .openapi(routes.listChannelWebhooks, handlers.listChannelWebhooks)
  .openapi(routes.createChannelWebhook, handlers.createChannelWebhook)
  .openapi(routes.updateChannelWebhook, handlers.updateChannelWebhook)
  .openapi(routes.deleteChannelWebhook, handlers.deleteChannelWebhook)

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const MAX_EXECUTE_BYTES = 512 * 1024
const REMEMBER_CONTENT_MAX = 64 * 1024
const TITLE_MAX = 120

function tokensMatch(candidate: string, expected: string) {
  const a = Buffer.from(candidate)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

const executeRateLimit = rateLimiter({
  prefix: "webhook-exec",
  max: 60,
  keyExtractor: (c) => c.req.param("webhookId") ?? "unknown",
})

type ResolvedWebhook = {
  externalId: string
  name: string
  avatarUrl: string | undefined
}

// Shared credential resolution for every execute dialect. The token in the URL
// is the credential, not a session; a webhook is a `webhook`-provider
// connection and its effects run through the trigger dispatch.
async function resolveWebhook(
  webhookId: string,
  token: string
): Promise<
  | { ok: true; value: ResolvedWebhook }
  | { ok: false; status: 401 | 404 | 503; message: string }
> {
  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!key) {
    return { ok: false, status: 503, message: "Webhooks are unavailable" }
  }
  if (!UUID_RE.test(webhookId)) {
    return { ok: false, status: 404, message: "Unknown webhook" }
  }
  const hook = await db
    .select({
      externalId: schema.integrationConnection.externalId,
      name: schema.integrationConnection.accountLogin,
      avatarUrl: schema.integrationConnection.avatarUrl,
      accessToken: schema.integrationConnection.accessToken,
    })
    .from(schema.integrationConnection)
    .where(
      and(
        eq(schema.integrationConnection.provider, "webhook"),
        eq(schema.integrationConnection.externalId, webhookId),
        eq(schema.integrationConnection.status, "active")
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!hook?.accessToken) {
    return { ok: false, status: 404, message: "Unknown webhook" }
  }
  let expected: string
  try {
    expected = decryptSecret(hook.accessToken, key)
  } catch {
    return { ok: false, status: 404, message: "Unknown webhook" }
  }
  if (!tokensMatch(token, expected)) {
    return { ok: false, status: 401, message: "Invalid token" }
  }
  return {
    ok: true,
    value: {
      externalId: hook.externalId,
      name: hook.name ?? "Webhook",
      avatarUrl: hook.avatarUrl ?? undefined,
    },
  }
}

// The Remember draft for a delivery: heuristic title (first rendered line),
// upsert key honoring a sender-supplied `external_id`/`id`, and the rendered
// markdown as content. Summarization (hint-steered) happens in ingestSource.
function deliveryRememberDraft(
  body: unknown,
  content: string,
  fallbackTitle: string
): RememberDraft {
  const record =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {}
  const externalKey =
    typeof record.external_id === "string" && record.external_id
      ? record.external_id
      : typeof record.id === "string" && record.id
        ? record.id
        : randomUUID()
  const firstLine = content
    .split("\n")
    .map((line) => line.replace(/[#*>`_~[\]()]/g, "").trim())
    .find(Boolean)
  const title = (firstLine || fallbackTitle).slice(0, TITLE_MAX)
  return {
    kind: "delivery",
    externalId: `delivery#${externalKey}`,
    title,
    url: null,
    author: null,
    occurredAt: new Date(),
    content: content.slice(0, REMEMBER_CONTENT_MAX),
  }
}

type ExecuteBody =
  | { ok: true; raw: string; body: unknown }
  | { ok: false; status: 400 | 413 }

async function readExecuteBody(c: {
  req: {
    header: (name: string) => string | undefined
    text: () => Promise<string>
  }
}): Promise<ExecuteBody> {
  if (Number(c.req.header("content-length") ?? 0) > MAX_EXECUTE_BYTES) {
    return { ok: false, status: 413 }
  }
  const raw = await c.req.text()
  if (Buffer.byteLength(raw) > MAX_EXECUTE_BYTES) {
    return { ok: false, status: 413 }
  }
  try {
    return { ok: true, raw, body: JSON.parse(raw) }
  } catch {
    return { ok: false, status: 400 }
  }
}

// Plain routes: the base URL speaks Lor's native shape; /discord and /slack
// accept those providers' payloads unmodified so senders switch by repointing
// a URL (reference/automation-primitives.md §3). All three normalize to
// markdown and fan out through the webhook's trigger effects.
webhooksRouter.post(
  "/webhooks/:webhookId/:token",
  executeRateLimit,
  async (c) => {
    const read = await readExecuteBody(c)
    if (!read.ok) return c.json({ success: false }, read.status)
    const parsed = executeWebhookBodySchema.safeParse(read.body)
    if (!parsed.success) {
      const hint = dialectHint(read.body)
      return c.json(
        {
          success: false,
          message: hint
            ? `Invalid body: expected { content }. This looks like a ${hint === "discord" ? "Discord" : "Slack"} payload — POST it to this URL with /${hint} appended.`
            : "Invalid body: expected { content }",
        },
        400
      )
    }

    const resolved = await resolveWebhook(
      c.req.param("webhookId") ?? "",
      c.req.param("token") ?? ""
    )
    if (!resolved.ok) {
      return c.json(
        { success: false, message: resolved.message },
        resolved.status
      )
    }

    try {
      const outcome = await dispatchConnectorEvent({
        provider: "webhook",
        externalId: resolved.value.externalId,
        event: "data_received",
        label: parsed.data.username ?? resolved.value.name,
        avatarUrl: resolved.value.avatarUrl,
        text: parsed.data.content,
        remember: deliveryRememberDraft(
          read.body,
          parsed.data.content,
          resolved.value.name
        ),
        payload: read.raw,
      })
      return c.json({ success: true, messageId: outcome?.posted ?? null })
    } catch (err) {
      logger.error({ err }, "Webhook execution failed")
      return c.json({ success: false, message: "Failed to post message" }, 500)
    }
  }
)

// Discord-compatible dialect. Mirrors Discord's execute contract, including
// the 204 No Content success (what Discord returns without ?wait=true).
webhooksRouter.post(
  "/webhooks/:webhookId/:token/discord",
  executeRateLimit,
  async (c) => {
    const read = await readExecuteBody(c)
    if (!read.ok) return c.json({ success: false }, read.status)
    const parsed = discordWebhookBodySchema.safeParse(read.body)
    if (!parsed.success) {
      return c.json(
        { success: false, message: "Invalid body: expected content or embeds" },
        400
      )
    }

    const resolved = await resolveWebhook(
      c.req.param("webhookId") ?? "",
      c.req.param("token") ?? ""
    )
    if (!resolved.ok) {
      return c.json(
        { success: false, message: resolved.message },
        resolved.status
      )
    }

    const content = renderDiscordWebhookBody(parsed.data)
    if (!content) {
      return c.json({ success: false, message: "Nothing to post" }, 400)
    }

    try {
      await dispatchConnectorEvent({
        provider: "webhook",
        externalId: resolved.value.externalId,
        event: "data_received",
        label: parsed.data.username ?? resolved.value.name,
        avatarUrl: resolved.value.avatarUrl,
        text: content,
        remember: deliveryRememberDraft(
          read.body,
          content,
          resolved.value.name
        ),
        payload: read.raw,
      })
      return c.body(null, 204)
    } catch (err) {
      logger.error({ err }, "Webhook execution failed")
      return c.json({ success: false, message: "Failed to post message" }, 500)
    }
  }
)

// Slack-compatible dialect. Mirrors Slack's incoming-webhook contract,
// including the plain-text "ok" success some Slack SDKs assert on. Slack has
// no username override — identity is the webhook's stored config.
webhooksRouter.post(
  "/webhooks/:webhookId/:token/slack",
  executeRateLimit,
  async (c) => {
    const read = await readExecuteBody(c)
    if (!read.ok) return c.text("invalid_payload", read.status)
    const parsed = slackWebhookBodySchema.safeParse(read.body)
    if (!parsed.success) {
      return c.text("invalid_payload", 400)
    }

    const resolved = await resolveWebhook(
      c.req.param("webhookId") ?? "",
      c.req.param("token") ?? ""
    )
    if (!resolved.ok) {
      return c.text("no_service", resolved.status)
    }

    const content = renderSlackWebhookBody(parsed.data)
    if (!content) {
      return c.text("invalid_payload", 400)
    }

    try {
      await dispatchConnectorEvent({
        provider: "webhook",
        externalId: resolved.value.externalId,
        event: "data_received",
        label: resolved.value.name,
        avatarUrl: resolved.value.avatarUrl,
        text: content,
        remember: deliveryRememberDraft(
          read.body,
          content,
          resolved.value.name
        ),
        payload: read.raw,
      })
      return c.text("ok")
    } catch (err) {
      logger.error({ err }, "Webhook execution failed")
      return c.text("internal_error", 500)
    }
  }
)

export default webhooksRouter
