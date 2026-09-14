import { isTauri } from "@repo/auth/tauri-fetch"

let nativeFocused: boolean | undefined
const listeners = new Set<(focused: boolean) => void>()
let stopListening: (() => void) | undefined

export function isAppFocused() {
  return (
    document.visibilityState === "visible" &&
    document.hasFocus() &&
    nativeFocused !== false
  )
}

export function subscribeAppFocus(listener: (focused: boolean) => void) {
  listeners.add(listener)
  if (!stopListening) {
    let disposed = false
    let unlistenNative: (() => void) | undefined
    let nativeRevision = 0
    const notify = () => {
      for (const subscriber of listeners) subscriber(isAppFocused())
    }
    window.addEventListener("focus", notify)
    window.addEventListener("blur", notify)
    document.addEventListener("visibilitychange", notify)

    if (isTauri) {
      void import("@tauri-apps/api/window")
        .then(async ({ getCurrentWindow }) => {
          if (disposed) return
          const appWindow = getCurrentWindow()
          const unlisten = await appWindow.onFocusChanged(({ payload }) => {
            if (disposed) return
            nativeRevision += 1
            nativeFocused = payload
            notify()
          })
          if (disposed) {
            unlisten()
            return
          }
          unlistenNative = unlisten
          const revision = nativeRevision
          const focused = await appWindow.isFocused()
          if (!disposed && revision === nativeRevision) {
            nativeFocused = focused
            notify()
          }
        })
        .catch(() => {
          // DOM focus remains available if native IPC is unavailable.
        })
    }

    stopListening = () => {
      disposed = true
      window.removeEventListener("focus", notify)
      window.removeEventListener("blur", notify)
      document.removeEventListener("visibilitychange", notify)
      unlistenNative?.()
      nativeFocused = undefined
    }
  }

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      stopListening?.()
      stopListening = undefined
    }
  }
}
