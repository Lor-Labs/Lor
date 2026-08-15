import { timingSafeEqual } from "node:crypto"
import { APP_USER_ID, db, schema } from "@repo/db"
import { eq } from "drizzle-orm"
import { postBotMessage } from "@/lib/bot-messages"
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
  hook: { id: string; name: string; avatarUrl: string | null }
  channel: { id: string; workspaceId: string | null; name: string | null }
}

// Shared credential + target resolution for every execute dialect. The token
// in the URL is the credential, not a session.
async function resolveWebhook(
  webhookId: string,
  token: string
): Promise<
  | { ok: true; value: ResolvedWebhook }
  | { ok: false; status: 401 | 404; message: string }
> {
  if (!UUID_RE.test(webhookId)) {
    return { ok: false, status: 404, message: "Unknown webhook" }
  }
  const hook = await db
    .select({
      id: schema.channelWebhook.id,
      name: schema.channelWebhook.name,
      avatarUrl: schema.channelWebhook.avatarUrl,
      token: schema.channelWebhook.token,
      channelId: schema.channelWebhook.channelId,
    })
    .from(schema.channelWebhook)
    .where(eq(schema.channelWebhook.id, webhookId))
    .limit(1)
    .then((rows) => rows[0])
  if (!hook) {
    return { ok: false, status: 404, message: "Unknown webhook" }
  }
  if (!tokensMatch(token, hook.token)) {
    return { ok: false, status: 401, message: "Invalid token" }
  }
  const channel = await db
    .select({
      id: schema.channel.id,
      workspaceId: schema.channel.workspaceId,
      name: schema.channel.name,
    })
    .from(schema.channel)
    .where(eq(schema.channel.id, hook.channelId))
    .limit(1)
    .then((rows) => rows[0])
  if (!channel) {
    return { ok: false, status: 404, message: "Unknown webhook" }
  }
  return {
    ok: true,
    value: {
      hook: { id: hook.id, name: hook.name, avatarUrl: hook.avatarUrl },
      channel,
    },
  }
}

async function postWebhookMessage(
  resolved: ResolvedWebhook,
  content: string,
  username?: string
) {
  return postBotMessage({
    channel: resolved.channel,
    authorId: APP_USER_ID,
    content,
    overrideName: username ?? resolved.hook.name,
    overrideAvatarUrl: resolved.hook.avatarUrl ?? undefined,
  })
}

// Plain routes: the posted message is canonical chat content (searchable),
// unlike connector notifications. The base URL speaks Lor's native shape;
// /discord and /slack accept those providers' payloads unmodified so senders
// switch by repointing a URL (reference/automation-primitives.md §3).
webhooksRouter.post(
  "/webhooks/:webhookId/:token",
  executeRateLimit,
  async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = executeWebhookBodySchema.safeParse(body)
    if (!parsed.success) {
      const hint = dialectHint(body)
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
      const message = await postWebhookMessage(
        resolved.value,
        parsed.data.content,
        parsed.data.username
      )
      return c.json({ success: true, messageId: message.id })
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
    const body = await c.req.json().catch(() => null)
    const parsed = discordWebhookBodySchema.safeParse(body)
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
      await postWebhookMessage(resolved.value, content, parsed.data.username)
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
    const body = await c.req.json().catch(() => null)
    const parsed = slackWebhookBodySchema.safeParse(body)
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
      await postWebhookMessage(resolved.value, content)
      return c.text("ok")
    } catch (err) {
      logger.error({ err }, "Webhook execution failed")
      return c.text("internal_error", 500)
    }
  }
)

export default webhooksRouter
