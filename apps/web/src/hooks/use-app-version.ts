import { isTauri } from "@repo/auth/tauri-fetch"
import { useEffect, useState } from "react"

// The installed desktop app version (from tauri.conf.json, set per release).
// Returns null in the browser, where there's no native app version.
export function useAppVersion() {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    if (!isTauri) return
    import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then(setVersion)
      .catch((err) => {
        console.error("[app-version] failed to resolve desktop version:", err)
      })
  }, [])

  return version
}
