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
const PANEL_WIDTH_KEY = "lor-right-panel-width"
const DEFAULT_WIDTH = 280

export const MIN_PANEL_WIDTH = 240
export const MAX_PANEL_WIDTH_RATIO = 0.75

export function clampPanelWidth(width: number, viewportWidth: number): number {
  const max = Math.max(viewportWidth * MAX_PANEL_WIDTH_RATIO, MIN_PANEL_WIDTH)
  return Math.min(Math.max(width, MIN_PANEL_WIDTH), max)
}

function getStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(PANEL_COLLAPSED_KEY) === "true"
  } catch {
    return false
  }
}

function getStoredWidth(): number {
  try {
    const stored = localStorage.getItem(PANEL_WIDTH_KEY)
    if (stored) {
      const parsed = Number.parseInt(stored, 10)
      if (Number.isFinite(parsed)) {
        return clampPanelWidth(parsed, window.innerWidth)
      }
    }
  } catch {}
  return DEFAULT_WIDTH
}

const RightSidebarContext = createContext<RightSidebarContextValue | null>(null)

export function RightSidebarProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<RightSidebarView | null>(null)
  const [isCollapsed, setIsCollapsed] = useState(true)
  const [panelWidth, setPanelWidthState] = useState(DEFAULT_WIDTH)
  const [isHydrated, setIsHydrated] = useState(false)

  // Hydrate from localStorage on mount
  useEffect(() => {
    setIsCollapsed(getStoredCollapsed())
    setPanelWidthState(getStoredWidth())
    setIsHydrated(true)
  }, [])

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

  const setPanelWidth = useCallback((width: number) => {
    setPanelWidthState(width)
    try {
      localStorage.setItem(PANEL_WIDTH_KEY, String(width))
    } catch {}
  }, [])

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
