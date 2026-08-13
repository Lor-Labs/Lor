import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import type { RightSidebarView } from "@/components/sidebar/right-panel/right-sidebar-types"

interface RightSidebarContextValue {
  view: RightSidebarView | null
  setView: (view: RightSidebarView | null) => void
  clearView: () => void
  isCollapsed: boolean
  toggleCollapsed: () => void
  panelWidth: number
  setPanelWidth: (width: number) => void
  isHydrated: boolean
}

const PANEL_COLLAPSED_KEY = "lor-right-panel-collapsed"
const PANEL_WIDTH_KEYS = {
  wide: "lor-right-panel-width-wide",
  compact: "lor-right-panel-width-compact",
} as const

/**
 * Threads and tasks are reading/working surfaces, so they open roughly half
 * the viewport. Members / pinned / attachments are lists — they get a narrow
 * fixed width. Each class remembers its own user-dragged width.
 */
type PanelSizeClass = keyof typeof PANEL_WIDTH_KEYS

const COMPACT_DEFAULT_WIDTH = 280
const WIDE_DEFAULT_RATIO = 0.5

export const MIN_PANEL_WIDTH = 240
export const MAX_PANEL_WIDTH_RATIO = 0.75

/**
 * Minimum comfortable chat width. The resize handle uses it to auto-collapse
 * the left sidebar while dragging, and the wide default backs off from 50% on
 * narrow viewports so opening a thread never leaves the chat cramped.
 */
export const CENTER_MIN_WIDTH = 400
const ASSUMED_LEFT_SIDEBAR_WIDTH = 240

export function clampPanelWidth(width: number, viewportWidth: number): number {
  const max = Math.max(viewportWidth * MAX_PANEL_WIDTH_RATIO, MIN_PANEL_WIDTH)
  return Math.min(Math.max(width, MIN_PANEL_WIDTH), max)
}

function sizeClassForView(view: RightSidebarView | null): PanelSizeClass {
  return view?.type === "thread" ? "wide" : "compact"
}

function defaultWidth(
  sizeClass: PanelSizeClass,
  viewportWidth: number
): number {
  if (sizeClass === "compact") return COMPACT_DEFAULT_WIDTH
  return clampPanelWidth(
    Math.round(
      Math.min(
        viewportWidth * WIDE_DEFAULT_RATIO,
        viewportWidth - ASSUMED_LEFT_SIDEBAR_WIDTH - CENTER_MIN_WIDTH
      )
    ),
    viewportWidth
  )
}

function getStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(PANEL_COLLAPSED_KEY) === "true"
  } catch {
    return false
  }
}

function getStoredWidth(sizeClass: PanelSizeClass): number {
  try {
    const stored = localStorage.getItem(PANEL_WIDTH_KEYS[sizeClass])
    if (stored) {
      const parsed = Number.parseInt(stored, 10)
      if (Number.isFinite(parsed)) {
        return clampPanelWidth(parsed, window.innerWidth)
      }
    }
  } catch {}
  return defaultWidth(sizeClass, window.innerWidth)
}

const RightSidebarContext = createContext<RightSidebarContextValue | null>(null)

export function RightSidebarProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<RightSidebarView | null>(null)
  const [isCollapsed, setIsCollapsed] = useState(true)
  const [widths, setWidths] = useState<Record<PanelSizeClass, number>>({
    wide: COMPACT_DEFAULT_WIDTH,
    compact: COMPACT_DEFAULT_WIDTH,
  })
  const [isHydrated, setIsHydrated] = useState(false)

  // Hydrate from localStorage on mount
  useEffect(() => {
    setIsCollapsed(getStoredCollapsed())
    setWidths({
      wide: getStoredWidth("wide"),
      compact: getStoredWidth("compact"),
    })
    setIsHydrated(true)
  }, [])

  const sizeClass = sizeClassForView(view)
  const panelWidth = widths[sizeClass]

  const clearView = useCallback(() => {
    setView(null)
  }, [])

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(PANEL_COLLAPSED_KEY, String(next))
      } catch {}
      return next
    })
  }, [])

  const setPanelWidth = useCallback(
    (width: number) => {
      setWidths((prev) => ({ ...prev, [sizeClass]: width }))
      try {
        localStorage.setItem(PANEL_WIDTH_KEYS[sizeClass], String(width))
      } catch {}
    },
    [sizeClass]
  )

  const value = useMemo<RightSidebarContextValue>(
    () => ({
      view,
      setView,
      clearView,
      isCollapsed,
      toggleCollapsed,
      panelWidth,
      setPanelWidth,
      isHydrated,
    }),
    [
      view,
      clearView,
      isCollapsed,
      toggleCollapsed,
      panelWidth,
      setPanelWidth,
      isHydrated,
    ]
  )

  return (
    <RightSidebarContext.Provider value={value}>
      {children}
    </RightSidebarContext.Provider>
  )
}

export function useRightSidebar() {
  const context = useContext(RightSidebarContext)
  if (!context) {
    throw new Error("useRightSidebar must be used within RightSidebarProvider")
  }
  return context
}
