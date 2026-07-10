import { honoClient } from "@repo/api-client"
import { API_URL, authClient } from "./auth-client"

export const api = honoClient(API_URL, {
  init: { credentials: "omit" },
  headers: (): Record<string, string> => {
    const cookies = authClient.getCookie()
    return cookies ? { cookie: cookies } : {}
  },
})
