import { env } from "@repo/env/client"

// Origin for links that leave this window: invites, verification and reset
// emails. The desktop app runs on tauri://localhost, which a browser can't
// open, so those links point at the web app instead.
export function webOrigin() {
  const { protocol, origin } = window.location
  return protocol === "http:" || protocol === "https:"
    ? origin
    : env.NEXT_PUBLIC_WEB_URL
}
