import { useSearch } from "@tanstack/react-router"
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

// A file open in the panel: one of Lor's (?artifactId) or an upload
// (?upload=<messageId>.<index>).
export type OpenFile =
  | { kind: "artifact"; key: string; artifactId: string }
  | { kind: "upload"; key: string; messageId: string; index: number }

function parseOpenFile(
  artifactId: string | undefined,
  upload: string | undefined
): OpenFile | null {
  if (artifactId) return { kind: "artifact", key: artifactId, artifactId }
  if (!upload) return null
  const dot = upload.lastIndexOf(".")
  const index = Number(upload.slice(dot + 1))
  if (dot < 1 || !Number.isInteger(index) || index < 0) return null
  return { kind: "upload", key: upload, messageId: upload.slice(0, dot), index }
}

interface RightSidebarContextValue {
  view: RightSidebarView | null
  // An open file covers the view until it closes, on any page.
  file: OpenFile | null
  sizeClass: PanelSizeClass
  setView: (view: RightSidebarView | null) => void
  openView: (view: RightSidebarView) => void
  clearView: () => void
  consumeComposerDraft: (id: string) => void
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
  rail: "lor-right-panel-width-rail",
  file: "lor-right-panel-width-file",
} as const

/**
 * Threads and plans are reading/working surfaces, so they open roughly half
 * the viewport. Members / pinned / attachments are lists — they get a narrow
 * fixed width. Each class remembers its own user-dragged width. Loop detail
 * is a reading surface too (full prompt text), so it rides the wide class.
 * A session's work rail opens narrow beside the session but resizes freely.
 * An open file opens half the viewport and remembers its own width.
 */
type PanelSizeClass = keyof typeof PANEL_WIDTH_KEYS

const COMPACT_DEFAULT_WIDTH = 280
const COMPACT_MAX_WIDTH = 320
const RAIL_DEFAULT_WIDTH = 320
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

export function clampPanelWidth(
  width: number,
  viewportWidth: number,
  compact = false
): number {
  const max = Math.max(
    Math.min(
      viewportWidth * MAX_PANEL_WIDTH_RATIO,
      compact ? COMPACT_MAX_WIDTH : Number.POSITIVE_INFINITY
    ),
    MIN_PANEL_WIDTH
  )
  return Math.min(Math.max(width, MIN_PANEL_WIDTH), max)
}

function sizeClassFor(
  view: RightSidebarView | null,
  file: OpenFile | null
): PanelSizeClass {
  if (file) return "file"
  if (view?.type === "thread" || view?.type === "loop") return "wide"
  // A code session's files and diffs open in tabs beside the chat, so its
  // Changes and Files lists stay rail-width.
  return view?.type === "session-work" ||
    view?.type === "session-changes" ||
    view?.type === "session-files"
    ? "rail"
    : "compact"
}

function defaultWidth(
  sizeClass: PanelSizeClass,
  viewportWidth: number
): number {
  if (sizeClass === "compact") return COMPACT_DEFAULT_WIDTH
  if (sizeClass === "rail") return RAIL_DEFAULT_WIDTH
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
        return clampPanelWidth(
          parsed,
          window.innerWidth,
          sizeClass === "compact"
        )
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
    rail: RAIL_DEFAULT_WIDTH,
    file: COMPACT_DEFAULT_WIDTH,
  })
  const [isHydrated, setIsHydrated] = useState(false)
  const artifactId = useSearch({
    strict: false,
    select: (search) => search.artifactId,
  })
  const upload = useSearch({
    strict: false,
    select: (search) => search.upload,
  })
  const file = useMemo(
    () => parseOpenFile(artifactId, upload),
    [artifactId, upload]
  )

  // Hydrate from localStorage on mount
  useEffect(() => {
    setIsCollapsed(getStoredCollapsed())
    setWidths({
      wide: getStoredWidth("wide"),
      compact: getStoredWidth("compact"),
      rail: getStoredWidth("rail"),
      file: getStoredWidth("file"),
    })
    setIsHydrated(true)
  }, [])

  // Opening a file shows it even when the panel was collapsed.
  const fileKey = file?.key ?? null
  useEffect(() => {
    if (!fileKey) return
    setIsCollapsed(false)
    try {
      localStorage.setItem(PANEL_COLLAPSED_KEY, "false")
    } catch {}
  }, [fileKey])

  const sizeClass = sizeClassFor(view, file)
  const panelWidth =
    sizeClass === "compact"
      ? Math.min(widths.compact, COMPACT_MAX_WIDTH)
      : widths[sizeClass]

  const clearView = useCallback(() => {
    setView(null)
  }, [])

  const openView = useCallback((nextView: RightSidebarView) => {
    setView(nextView)
    setIsCollapsed(false)
    try {
      localStorage.setItem(PANEL_COLLAPSED_KEY, "false")
    } catch {}
  }, [])

  const consumeComposerDraft = useCallback((id: string) => {
    setView((current) =>
      current?.type === "thread" && current.composerDraft?.id === id
        ? { ...current, composerDraft: undefined }
        : current
    )
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
      const nextWidth = clampPanelWidth(
        width,
        window.innerWidth,
        sizeClass === "compact"
      )
      setWidths((prev) => ({ ...prev, [sizeClass]: nextWidth }))
      try {
        localStorage.setItem(PANEL_WIDTH_KEYS[sizeClass], String(nextWidth))
      } catch {}
    },
    [sizeClass]
  )

  const value = useMemo<RightSidebarContextValue>(
    () => ({
      view,
      file,
      sizeClass,
      setView,
      openView,
      clearView,
      consumeComposerDraft,
      isCollapsed,
      toggleCollapsed,
      panelWidth,
      setPanelWidth,
      isHydrated,
    }),
    [
      view,
      file,
      sizeClass,
      openView,
      clearView,
      consumeComposerDraft,
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
