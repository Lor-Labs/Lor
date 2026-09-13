import { getCurrentWebview } from "@tauri-apps/api/webview"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

export const ZOOM_LEVELS = [75, 80, 90, 100, 110, 120, 125, 150, 175, 200]
export const ZOOM_SCOPES = {
  app: "Entire app",
  main: "Main channel",
  right: "Right panel",
} as const
export type ZoomScope = keyof typeof ZOOM_SCOPES
export type ZoomAction = "in" | "out" | "reset"
type ZoomLevels = Record<ZoomScope, number>
const STORAGE_KEY = "lor:desktop-zoom"
const DEFAULT_LEVELS: ZoomLevels = { app: 100, main: 100, right: 100 }
const isDesktop =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window

function readLevels(): ZoomLevels {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")
    return Object.fromEntries(
      Object.keys(DEFAULT_LEVELS).map((scope) => [
        scope,
        ZOOM_LEVELS.includes(stored?.[scope]) ? stored[scope] : 100,
      ])
    ) as ZoomLevels
  } catch {
    return DEFAULT_LEVELS
  }
}

export function isZoomScopeAvailable(scope: ZoomScope) {
  return (
    scope === "app" ||
    !!document.querySelector(`[data-desktop-zoom-region="${scope}"]`)
  )
}

type ZoomContextValue = {
  levels: ZoomLevels
  scope: ZoomScope
  notice: { revision: number } | null
  error: string | null
  changeZoom: (scope: ZoomScope, action: ZoomAction) => void
  hideControls: () => void
}

const DesktopZoomContext = createContext<ZoomContextValue | null>(null)

export function useDesktopZoom() {
  return useContext(DesktopZoomContext)
}

function DesktopZoomController({ children }: { children: ReactNode }) {
  const [levels, setLevels] = useState(readLevels)
  const levelsRef = useRef(levels)
  const [scope, setScope] = useState<ZoomScope>("app")
  const scopeRef = useRef<ZoomScope>("app")
  const [notice, setNotice] = useState<ZoomContextValue["notice"]>(null)
  const [error, setError] = useState<string | null>(null)
  const nativeQueue = useRef(Promise.resolve())
  const nativeApplied = useRef(100)
  const nativeRevision = useRef(0)

  const applyNativeZoom = useCallback((percent: number) => {
    const revision = ++nativeRevision.current
    // Serialize native calls so rapid key repeats cannot apply an older zoom last.
    nativeQueue.current = nativeQueue.current.then(async () => {
      try {
        await getCurrentWebview().setZoom(percent / 100)
        nativeApplied.current = percent
        if (revision === nativeRevision.current) setError(null)
      } catch {
        if (revision !== nativeRevision.current) return
        const restored = { ...levelsRef.current, app: nativeApplied.current }
        levelsRef.current = restored
        setLevels(restored)
        setError("Couldn’t change app zoom. Restart Lor and try again.")
        setNotice({ revision: Date.now() })
      }
    })
  }, [])

  useEffect(() => {
    if (levelsRef.current.app !== 100) applyNativeZoom(levelsRef.current.app)
  }, [applyNativeZoom])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(levels))
    } catch {}
  }, [levels])

  const changeZoom = useCallback(
    (target: ZoomScope, action: ZoomAction) => {
      setNotice({ revision: Date.now() })
      const current = levelsRef.current[target]
      const next =
        action === "reset"
          ? 100
          : action === "in"
            ? (ZOOM_LEVELS.find((level) => level > current) ?? current)
            : ([...ZOOM_LEVELS].reverse().find((level) => level < current) ??
              current)
      if (next === current) return
      const updated = { ...levelsRef.current, [target]: next }
      levelsRef.current = updated
      setLevels(updated)
      if (target === "app") applyNativeZoom(next)
    },
    [applyNativeZoom]
  )

  const hideControls = useCallback(() => setNotice(null), [])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (
        !(target instanceof Element) ||
        target.closest("#desktop-zoom-controls")
      )
        return
      const region = target.closest<HTMLElement>("[data-desktop-zoom-region]")
        ?.dataset.desktopZoomRegion
      // Portaled menus belong to the surface that opened them.
      if (
        !region &&
        target.closest(
          '[role="menu"], [role="dialog"], [data-slot="popover-popup"]'
        )
      )
        return
      const next = region === "main" || region === "right" ? region : "app"
      scopeRef.current = next
      setScope(next)
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = /Mac/.test(navigator.platform)
        ? event.metaKey
        : event.ctrlKey
      if (
        !modifier ||
        event.altKey ||
        event.isComposing ||
        event.defaultPrevented
      )
        return
      const action =
        event.key === "+" || event.key === "=" || event.code === "NumpadAdd"
          ? "in"
          : event.key === "-" ||
              event.key === "_" ||
              event.code === "NumpadSubtract"
            ? "out"
            : event.key === "0" || event.code === "Numpad0"
              ? "reset"
              : null
      if (!action) return
      event.preventDefault()
      event.stopPropagation()
      const target = isZoomScopeAvailable(scopeRef.current)
        ? scopeRef.current
        : "app"
      scopeRef.current = target
      setScope(target)
      changeZoom(target, action)
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [changeZoom])

  const value = useMemo(
    () => ({
      levels,
      scope,
      notice,
      error,
      changeZoom,
      hideControls,
    }),
    [levels, scope, notice, error, changeZoom, hideControls]
  )

  return (
    <DesktopZoomContext.Provider value={value}>
      {children}
    </DesktopZoomContext.Provider>
  )
}

export function DesktopZoomProvider({ children }: { children: ReactNode }) {
  return isDesktop ? (
    <DesktopZoomController>{children}</DesktopZoomController>
  ) : (
    children
  )
}
