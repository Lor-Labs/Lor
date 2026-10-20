import type { waitlist } from "@repo/db/schema"
import { env } from "@repo/env/server"
import { logger } from "@/lib/logger"
import type { DiscordWebhookBody } from "@/lib/webhook-payloads"

export async function notifyWaitlistSignup(
  entry: typeof waitlist.$inferSelect
): Promise<void> {
  const configuredUrl = env.SIGNUP_WEBHOOK_URL
  if (!configuredUrl) return

  try {
    // The same Lor webhook accepts rich embeds on its Discord dialect URL.
    const url = new URL(configuredUrl)
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/discord`
    const body: DiscordWebhookBody = {
      embeds: [
        {
          title: "New early-access signup",
          color: 0x9b7bf7,
          fields: [
            {
              name: "Email",
              value: entry.email.replace(/[\\`*_{}[\]()<>#+.!|~-]/g, "\\$&"),
            },
          ],
          footer: { text: "Lor website · Waitlist" },
          timestamp: entry.createdAt.toISOString(),
        },
      ],
    }
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    })
    await response.body?.cancel()
    if (!response.ok) {
      logger.error(
        { waitlistId: entry.id, status: response.status },
        "Waitlist notification delivery failed"
      )
    }
  } catch {
    // Fetch errors can contain the secret URL; keep it and the email out of logs.
    logger.error(
      { waitlistId: entry.id },
      "Waitlist notification delivery failed"
    )
  }
}
