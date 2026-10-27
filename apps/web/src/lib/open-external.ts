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

// A page people look at and come back from (a pull request): a new tab on
// the web, the system browser in the desktop app.
export function openInNewTab(url: string) {
  if (isTauri) {
    openExternal(url)
    return
  }
  window.open(url, "_blank", "noopener,noreferrer")
}
