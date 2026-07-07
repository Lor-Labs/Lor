import { timingSafeEqual } from "node:crypto"
import { APP_USER_ID, db, schema } from "@repo/db"
import { eq } from "drizzle-orm"
import { postBotMessage } from "@/lib/bot-messages"
import { createRouter } from "@/lib/helpers/app/create-app"
import { logger } from "@/lib/logger"
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

// Plain route: the token in the URL is the credential, not a session. The
// posted message is canonical chat content (searchable), unlike connector
// notifications.
webhooksRouter.post(
  "/webhooks/:webhookId/:token",
  executeRateLimit,
  async (c) => {
    const webhookId = c.req.param("webhookId") ?? ""
    const token = c.req.param("token") ?? ""
    if (!UUID_RE.test(webhookId)) {
      return c.json({ success: false, message: "Unknown webhook" }, 404)
    }

    const body = await c.req.json().catch(() => null)
    const parsed = executeWebhookBodySchema.safeParse(body)
    if (!parsed.success) {
      return c.json(
        { success: false, message: "Invalid body: expected { content }" },
        400
      )
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
      return c.json({ success: false, message: "Unknown webhook" }, 404)
    }
    if (!tokensMatch(token, hook.token)) {
      return c.json({ success: false, message: "Invalid token" }, 401)
    }

    const targetChannel = await db
      .select({
        id: schema.channel.id,
        workspaceId: schema.channel.workspaceId,
        name: schema.channel.name,
      })
      .from(schema.channel)
      .where(eq(schema.channel.id, hook.channelId))
      .limit(1)
      .then((rows) => rows[0])
    if (!targetChannel) {
      return c.json({ success: false, message: "Unknown webhook" }, 404)
    }

    try {
      const message = await postBotMessage({
        channel: targetChannel,
        authorId: APP_USER_ID,
        content: parsed.data.content,
        overrideName: parsed.data.username ?? hook.name,
        overrideAvatarUrl: hook.avatarUrl ?? undefined,
      })
      return c.json({ success: true, messageId: message.id })
    } catch (err) {
      logger.error({ err, webhookId }, "Webhook execution failed")
      return c.json({ success: false, message: "Failed to post message" }, 500)
    }
  }
)

export default webhooksRouter
