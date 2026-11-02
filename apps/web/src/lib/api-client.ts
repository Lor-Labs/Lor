import { type Client, honoClient } from "@repo/api-client"
import { appFetch } from "@repo/auth/tauri-fetch"
import { env } from "@repo/env/client"

// Annotated: the inferred client type is past TS's 1M-character print limit
// (TS7056).
export const apiClient: Client = honoClient(env.NEXT_PUBLIC_API_URL, {
  headers: {
    "Content-Type": "application/json",
  },
  init: {
    credentials: "include",
  },
  fetch: appFetch,
})
