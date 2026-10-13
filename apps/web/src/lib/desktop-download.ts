import { isTauri } from "@repo/auth/tauri-fetch"

// Same file as the www download page. Only an Apple Silicon build ships today.
const MAC_DOWNLOAD_URL = "https://releases.lor.chat/latest/Lor_aarch64.dmg"

// A .dmg downloads in place; the page stays open.
export function downloadDesktopApp() {
  window.location.assign(MAC_DOWNLOAD_URL)
}

// iPadOS Safari reports a Mac platform; touch points tell them apart.
export const canDownloadDesktopApp =
  !isTauri &&
  typeof navigator !== "undefined" &&
  /Mac/.test(navigator.platform) &&
  navigator.maxTouchPoints < 2
