// Browser-only. In the Tauri desktop app the frontend runs from tauri://localhost,
// so cookies to the API are cross-site and WKWebView won't reliably persist them.
// Routing fetches through the Tauri HTTP plugin uses its native (Rust) cookie jar,
// which persists the session cookie across restarts. In a normal browser this is
// just the platform fetch, so every consumer is unchanged on the web.
export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window

let tauriFetch: typeof fetch | null = null

async function loadTauriFetch(): Promise<typeof fetch> {
  if (!tauriFetch) {
    const mod = await import("@tauri-apps/plugin-http")
    tauriFetch = mod.fetch as typeof fetch
  }
  return tauriFetch
}

export const appFetch: typeof fetch = (input, init) => {
  if (!isTauri) return fetch(input, init)
  return loadTauriFetch().then((f) => f(input, init))
}
