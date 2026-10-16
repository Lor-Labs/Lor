import { env } from "@repo/env/server"
import { logger } from "./logger"

function signupUser(response: unknown) {
  if (!response || typeof response !== "object" || !("user" in response))
    return null
  const user = response.user
  if (
    !user ||
    typeof user !== "object" ||
    !("id" in user) ||
    typeof user.id !== "string" ||
    !("name" in user) ||
    typeof user.name !== "string" ||
    !("email" in user) ||
    typeof user.email !== "string"
  )
    return null
  return { id: user.id, name: user.name, email: user.email }
}

function markdownText(value: string) {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300)
    .replace(/[\\`*_{}[\]()<>#+.!|~-]/g, "\\$&")
}

// LOR-105: one best-effort delivery, disabled unless the operator sets a URL.
export async function notifySignup(response: unknown): Promise<void> {
  const url = env.SIGNUP_WEBHOOK_URL
  if (!url) return
  const user = signupUser(response)
  if (!user) return

  try {
    const result = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `**New signup**\n**Name:** ${markdownText(user.name)}\n**Email:** ${markdownText(user.email)}`,
      }),
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    })
    await result.body?.cancel()
    if (!result.ok) {
      logger.error(
        { userId: user.id, status: result.status },
        "Signup notification delivery failed"
      )
    }
  } catch {
    // Fetch errors may contain the secret URL; log only the operation identity.
    logger.error({ userId: user.id }, "Signup notification delivery failed")
  }
}
