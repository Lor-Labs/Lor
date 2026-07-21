import { honoClient } from "@repo/api-client"
import { API_URL, authClient } from "./auth-client"

export const api = honoClient(API_URL, {
  init: { credentials: "omit" },
  headers: (): Record<string, string> => {
    const cookies = authClient.getCookie()
    return cookies ? { cookie: cookies } : {}
  },
})

export async function responseMessage(
  response: { text: () => Promise<string> },
  fallback: string
) {
  const responseText = await response.text()
  if (!responseText) return fallback
  try {
    const parsed = JSON.parse(responseText) as { message?: string }
    return typeof parsed.message === "string" ? parsed.message : fallback
  } catch {
    return fallback
  }
}
