import { isTauri } from "@repo/auth/tauri-fetch"

// In the desktop app, external pages (OAuth consent, Stripe checkout) must
// open in the system browser — navigating the webview strands the user
// outside the app shell, and callbacks land on APP_BASE_URL anyway.
export function openExternal(url: string) {
  if (isTauri) {
    void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(url))
    return
  }
  window.location.href = url
}
