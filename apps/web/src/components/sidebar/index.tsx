import { Sheet, SheetContent } from "@repo/ui/components/sheet"
import {
  Sidebar as ShadcnSidebar,
  SidebarFooter,
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from "@repo/ui/components/sidebar"
import { useIsMobile } from "@repo/ui/hooks/use-mobile"
import { cn } from "@repo/ui/lib/utils"
import { useParams } from "@tanstack/react-router"
import { AnimatePresence, motion } from "motion/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { DesktopSidebarTitlebar } from "@/components/desktop-titlebar"
import { DesktopZoomRegion } from "@/components/desktop-zoom"
import { UserBar } from "@/components/sidebar/channel-panel/user-bar"
import { DMSidebarContent } from "@/components/sidebar/dm-sidebar"
import {
  CENTER_MIN_WIDTH,
  clampPanelWidth,
  RightSidebarProvider,
  useRightSidebar,
} from "@/components/sidebar/right-panel/right-sidebar-context"
import { RightSidebarPanel } from "@/components/sidebar/right-panel/right-sidebar-panel"
import { WorkspaceSidebarContent } from "@/components/sidebar/workspace-sidebar"

/**
 * URL-driven left sidebar with a book-page-turn transition:
 *   /$workspaceSlug/...  → WorkspaceSidebarContent (channels)
 *   /dms/...              → DMSidebarContent       (DM list)
 *
 * Both contents are hosted inside a single Sidebar shell so the user-bar
 * footer stays anchored across mode switches — only the contextual
 * content (header + scrollable body) pivots around the left edge like a
 * turning book page.
 */
function LeftSidebar() {
  const { workspaceSlug } = useParams({ strict: false })
  const isWorkspace = !!workspaceSlug

  return (
    <ShadcnSidebar variant="inset">
      <DesktopSidebarTitlebar />
      <div
        className="relative flex min-h-0 flex-1 flex-col"
        style={{ perspective: 1400 }}
      >
        <AnimatePresence initial={false}>
          <motion.div
            key={isWorkspace ? "workspace" : "dm"}
            initial={{ rotateY: 78, opacity: 0 }}
            animate={{ rotateY: 0, opacity: 1 }}
            exit={{ rotateY: -78, opacity: 0 }}
            transition={{
              rotateY: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
              opacity: { duration: 0.3, ease: [0.4, 0, 0.2, 1] },
            }}
            style={{
              transformOrigin: "0% 50%",
              transformStyle: "preserve-3d",
              backfaceVisibility: "hidden",
            }}
            className="absolute inset-0 flex h-full w-full flex-col"
          >
            {isWorkspace ? <WorkspaceSidebarContent /> : <DMSidebarContent />}
          </motion.div>
        </AnimatePresence>
      </div>
      <SidebarFooter>
        <UserBar />
      </SidebarFooter>
    </ShadcnSidebar>
  )
}

/**
 * Right-side floating inset card. Lives as a sibling of SidebarInset on
 * the SidebarProvider canvas, mirroring the left sidebar's floating look:
 * `bg-sidebar` with rounded corners, a small margin gap, and a soft
 * shadow. This is a deliberate visual choice — the right panel hosts
 * Lor threads (and members / pinned / threads), so it needs its own
 * visual identity rather than blending into the main chat surface.
 */
// While dragging the right panel, if the center (chat) gets narrower than
// CENTER_MIN_WIDTH the left sidebar auto-collapses to give the room back;
// dragging the panel back reopens it (see handleMouseDown). Note the right
// panel is capped at 75% of the viewport (MAX_PANEL_WIDTH_RATIO), so the center
// can't shrink below ~0.25·viewport − leftWidth; CENTER_MIN_WIDTH must sit above
// that floor to fire.

function RightPanelDock() {
  const { workspaceSlug } = useParams({ strict: false })
  const { view, isCollapsed, panelWidth, setPanelWidth, isHydrated } =
    useRightSidebar()
  const { open: leftOpen, setOpen: setLeftOpen } = useSidebar()
  const [isResizing, setIsResizing] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const widthRef = useRef(panelWidth)
  const rafRef = useRef<number | null>(null)
  const pendingXRef = useRef<number | null>(null)
  // End-of-drag rAF — cancelled if a new drag starts before it fires.
  const endRafRef = useRef<number | null>(null)
  // Drag cleanup (document listeners); also run on unmount.
  const dragCleanupRef = useRef<(() => void) | null>(null)

  // Cancel any pending rAF-throttled drag write on unmount (the drag class is
  // removed on mouseup; clear it here too in case the component unmounts
  // mid-drag).
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      if (endRafRef.current !== null) cancelAnimationFrame(endRafRef.current)
      dragCleanupRef.current?.()
      document.documentElement.classList.remove("lor-resizing")
    }
  }, [])

  // Drag-resize performance: reading getBoundingClientRect() after a style
  // write on every mousemove forces synchronous layout each frame (expensive
  // with a long message list in the center panel). So drag-start geometry is
  // cached once here, the width is applied via direct DOM style mutation
  // during the drag, and the React state commit is deferred to mouseup to
  // avoid mid-drag re-renders.
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      setIsResizing(true)
      // Don't let the previous drag's deferred reset flip isResizing mid-drag.
      if (endRafRef.current !== null) {
        cancelAnimationFrame(endRafRef.current)
        endRafRef.current = null
      }

      const startX = e.clientX
      const startWidth = panelWidth
      const viewportWidth = window.innerWidth
      // Seed the ref from the current width so a click-drag-release with no
      // mousemove persists the unchanged width, not a stale earlier value.
      widthRef.current = startWidth

      // Cache the drag-start geometry so mousemove never has to force layout
      // after writing the panel width. A wider right panel shrinks the center
      // by the same amount until the left sidebar is collapsed.
      const centerEl = document.querySelector<HTMLElement>(
        "[data-slot='sidebar-inset']"
      )
      const wrapper = document.querySelector<HTMLElement>(
        "[data-slot='sidebar-wrapper']"
      )
      const leftWidth = wrapper
        ? Number.parseFloat(
            getComputedStyle(wrapper).getPropertyValue("--sidebar-width")
          ) || 0
        : 0
      const startCenter =
        centerEl?.getBoundingClientRect().width ?? Number.POSITIVE_INFINITY

      // Only auto-manage the left sidebar if this drag collapsed it, when it
      // started open (never fight a user who chose to collapse it), and only
      // if the chat started with headroom — otherwise a drag that begins
      // already cramped (e.g. left just reopened over a maxed right panel)
      // would collapse on the first move and immediately reopen.
      const canManageLeft =
        leftOpen && leftWidth > 0 && startCenter >= CENTER_MIN_WIDTH
      let collapsedByThisDrag = false

      // Mousemove fires faster than the frame rate; each width write forces
      // the center panel's message rows to re-wrap and re-lay out, so the
      // write is rAF-throttled to at most once per frame.
      const applyWidth = (clientX: number) => {
        const delta = startX - clientX
        const newWidth = clampPanelWidth(startWidth + delta, viewportWidth)
        if (panelRef.current) {
          panelRef.current.style.width = `${newWidth}px`
        }
        widthRef.current = newWidth

        if (!canManageLeft) return
        const projectedCenterWidth = startCenter - (newWidth - startWidth)
        if (!collapsedByThisDrag) {
          if (projectedCenterWidth < CENTER_MIN_WIDTH) {
            collapsedByThisDrag = true
            setLeftOpen(false)
          }
        } else if (projectedCenterWidth >= CENTER_MIN_WIDTH) {
          collapsedByThisDrag = false
          setLeftOpen(true)
        }
      }

      const handleMouseMove = (moveEvent: MouseEvent) => {
        pendingXRef.current = moveEvent.clientX
        if (rafRef.current !== null) return
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null
          if (pendingXRef.current !== null) applyWidth(pendingXRef.current)
        })
      }

      const handleMouseUp = () => {
        // Flush the final position synchronously before committing state so
        // the persisted width matches where the cursor was released.
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current)
          rafRef.current = null
        }
        if (pendingXRef.current !== null) {
          applyWidth(pendingXRef.current)
          pendingXRef.current = null
        }
        setPanelWidth(widthRef.current)
        endRafRef.current = requestAnimationFrame(() => {
          endRafRef.current = null
          setIsResizing(false)
        })
        document.documentElement.classList.remove("lor-resizing")
        dragCleanupRef.current?.()
      }

      document.documentElement.classList.add("lor-resizing")

      document.addEventListener("mousemove", handleMouseMove)
      document.addEventListener("mouseup", handleMouseUp)
      dragCleanupRef.current = () => {
        dragCleanupRef.current = null
        document.removeEventListener("mousemove", handleMouseMove)
        document.removeEventListener("mouseup", handleMouseUp)
      }
    },
    [panelWidth, setPanelWidth, leftOpen, setLeftOpen]
  )

  const showRightPanel = !!view && !!workspaceSlug

  if (!showRightPanel || !isHydrated) return null

  return (
    <>
      {/* Resize handle — pulled left with -ml-2 so its hit area overlaps
          the inset's `mr-2` gap; the visible stroke sits at left-0, flush
          with the inset's right border (which is the line users see). */}
      {!isCollapsed && (
        <div
          onMouseDown={handleMouseDown}
          className={cn(
            "relative -ml-2 hidden h-full w-2 shrink-0 cursor-ew-resize items-center justify-center md:flex",
            "after:absolute after:inset-y-0 after:left-0 after:w-px after:bg-transparent",
            isResizing ? "after:!bg-primary" : "hover:after:!bg-primary/50"
          )}
        />
      )}
      <AnimatePresence>
        {!isCollapsed && (
          <motion.aside
            ref={panelRef}
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: panelWidth, opacity: 1 }}
            exit={{
              width: 0,
              opacity: 0,
              transition: { duration: 0.2, ease: [0.4, 0, 0.2, 1] },
            }}
            transition={{
              duration: isResizing ? 0 : 0.2,
              ease: [0.4, 0, 0.2, 1],
            }}
            className={cn(
              "hidden h-full shrink-0 overflow-hidden md:flex",
              "bg-sidebar text-sidebar-foreground",
              "md:mb-2 md:mr-2 md:rounded-b-xl"
            )}
          >
            <div className="h-full min-w-0 flex-1 overflow-hidden">
              <DesktopZoomRegion scope="right">
                <RightSidebarPanel view={view} />
              </DesktopZoomRegion>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  )
}

function MainArea({ children }: { children: React.ReactNode }) {
  return (
    <SidebarInset className="min-w-0 md:my-2 md:mr-2 md:rounded-xl md:border md:border-border/60 md:shadow-none">
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden md:rounded-[inherit]">
        <DesktopZoomRegion scope="main">{children}</DesktopZoomRegion>
      </div>
    </SidebarInset>
  )
}

/**
 * Mobile-only right panel: renders as a slide-in sheet from the right edge
 * since there's no room for a floating panel on small viewports.
 */
function MobileRightPanel() {
  const { view, clearView } = useRightSidebar()
  const { workspaceSlug } = useParams({ strict: false })
  const open = !!view && !!workspaceSlug

  // If the user navigates away from a workspace while the panel is open,
  // close it — it's workspace-scoped.
  useEffect(() => {
    if (!workspaceSlug && view) clearView()
  }, [workspaceSlug, view, clearView])

  return (
    <Sheet
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) clearView()
      }}
      modal
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-[300px] bg-sidebar p-0 sm:max-w-[300px]"
      >
        {view && (
          <DesktopZoomRegion scope="right">
            <RightSidebarPanel view={view} />
          </DesktopZoomRegion>
        )}
      </SheetContent>
    </Sheet>
  )
}

const LEFT_SIDEBAR_WIDTH_KEY = "lor:left-sidebar-width"
const LEFT_SIDEBAR_MIN = 200
const LEFT_SIDEBAR_MAX = 400
const LEFT_SIDEBAR_DEFAULT = 240

function getStoredLeftSidebarWidth(): number {
  try {
    const stored = localStorage.getItem(LEFT_SIDEBAR_WIDTH_KEY)
    if (stored) {
      const parsed = Number.parseInt(stored, 10)
      if (parsed >= LEFT_SIDEBAR_MIN && parsed <= LEFT_SIDEBAR_MAX)
        return parsed
    }
  } catch {}
  return LEFT_SIDEBAR_DEFAULT
}

/**
 * Desktop-only drag handle that resizes the left sidebar. Positioned `fixed`
 * at the sidebar's right edge so it tracks `--sidebar-width` and works
 * regardless of the inset card's internal padding. Hidden when the sidebar
 * is collapsed (offcanvas variant has 0 width then — nothing to drag).
 */
function LeftSidebarResizeHandle({
  width,
  onWidthChange,
}: {
  width: number
  onWidthChange: (width: number) => void
}) {
  const { state, isMobile } = useSidebar()
  const [isResizing, setIsResizing] = useState(false)
  const widthRef = useRef(width)
  const rafRef = useRef<number | null>(null)
  const pendingXRef = useRef<number | null>(null)
  // End-of-drag rAF — cancelled if a new drag starts before it fires.
  const endRafRef = useRef<number | null>(null)
  // Drag cleanup (listeners + inline style overrides); also run on unmount.
  const dragCleanupRef = useRef<(() => void) | null>(null)

  // Cancel any pending rAF-throttled drag write on unmount (the drag class is
  // removed on mouseup; clear it here too in case the component unmounts
  // mid-drag).
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      if (endRafRef.current !== null) cancelAnimationFrame(endRafRef.current)
      dragCleanupRef.current?.()
      document.documentElement.classList.remove("lor-resizing")
    }
  }, [])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      setIsResizing(true)
      // Don't let the previous drag's deferred cleanup clear this drag's styles.
      if (endRafRef.current !== null) {
        cancelAnimationFrame(endRafRef.current)
        endRafRef.current = null
      }

      const startX = e.clientX
      const startWidth = width
      widthRef.current = startWidth
      const handleEl = e.currentTarget as HTMLElement

      // Scoped width writes: only the gap + fixed container consume
      // --sidebar-width while expanded. Writing inline widths on them (instead
      // of mutating the var on the provider wrapper) avoids a full-document
      // custom-property style recalc per frame. Their 200ms width transition
      // is suppressed during the drag or the panel lags behind the cursor.
      const resizeTargets = document.querySelectorAll<HTMLElement>(
        "[data-slot='sidebar-gap'], [data-slot='sidebar-container']"
      )
      for (const el of resizeTargets) {
        el.style.transition = "none"
      }

      // Mousemove fires faster than the frame rate, and each width change
      // forces every rendered message row in the center panel to re-wrap and
      // re-lay out. Throttle the DOM write to at most once per frame.
      const applyWidth = (clientX: number) => {
        const delta = clientX - startX
        const next = Math.min(
          Math.max(startWidth + delta, LEFT_SIDEBAR_MIN),
          LEFT_SIDEBAR_MAX
        )
        widthRef.current = next
        for (const el of resizeTargets) {
          el.style.width = `${next}px`
        }
        // Fixed-position handle tracks the edge without touching the var.
        handleEl.style.left = `${next}px`
      }

      const handleMouseMove = (moveEvent: MouseEvent) => {
        pendingXRef.current = moveEvent.clientX
        if (rafRef.current !== null) return
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null
          if (pendingXRef.current !== null) applyWidth(pendingXRef.current)
        })
      }

      const handleMouseUp = () => {
        // Flush the final position synchronously before committing state so
        // the persisted width matches where the cursor was released.
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current)
          rafRef.current = null
        }
        if (pendingXRef.current !== null) {
          applyWidth(pendingXRef.current)
          pendingXRef.current = null
        }
        onWidthChange(widthRef.current)
        document.removeEventListener("mousemove", handleMouseMove)
        document.removeEventListener("mouseup", handleMouseUp)
        document.documentElement.classList.remove("lor-resizing")
        // Restore the inline overrides one frame later, after React commits
        // --sidebar-width, so the var takes over with no jump or transition.
        endRafRef.current = requestAnimationFrame(() => {
          endRafRef.current = null
          dragCleanupRef.current?.()
          setIsResizing(false)
        })
      }

      document.documentElement.classList.add("lor-resizing")
      document.addEventListener("mousemove", handleMouseMove)
      document.addEventListener("mouseup", handleMouseUp)
      dragCleanupRef.current = () => {
        dragCleanupRef.current = null
        document.removeEventListener("mousemove", handleMouseMove)
        document.removeEventListener("mouseup", handleMouseUp)
        for (const el of resizeTargets) {
          el.style.transition = ""
          el.style.width = ""
        }
        handleEl.style.left = "var(--sidebar-width)"
      }
    },
    [width, onWidthChange]
  )

  if (isMobile || state !== "expanded") return null

  return (
    <div
      data-left-sidebar-resize-handle=""
      onMouseDown={handleMouseDown}
      aria-hidden
      className={cn(
        "fixed top-0 bottom-0 z-50 hidden w-1.5 -translate-x-1/2 cursor-ew-resize md:block",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent",
        isResizing ? "after:!bg-primary" : "hover:after:!bg-primary/50"
      )}
      style={{ left: "var(--sidebar-width)" }}
    />
  )
}

function SidebarLayout({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile()
  const [width, setWidth] = useState(LEFT_SIDEBAR_DEFAULT)
  const [isHydrated, setIsHydrated] = useState(false)

  useEffect(() => {
    setWidth(getStoredLeftSidebarWidth())
    setIsHydrated(true)
  }, [])

  const persistWidth = useCallback((next: number) => {
    setWidth(next)
    try {
      localStorage.setItem(LEFT_SIDEBAR_WIDTH_KEY, String(next))
    } catch {}
  }, [])

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": isHydrated
            ? `${width}px`
            : `${LEFT_SIDEBAR_DEFAULT}px`,
        } as React.CSSProperties
      }
    >
      <LeftSidebar />
      <LeftSidebarResizeHandle width={width} onWidthChange={persistWidth} />
      <MainArea>{children}</MainArea>
      {isMobile ? <MobileRightPanel /> : <RightPanelDock />}
    </SidebarProvider>
  )
}

export function Sidebar({ children }: { children: React.ReactNode }) {
  return (
    <RightSidebarProvider>
      <SidebarLayout>{children}</SidebarLayout>
    </RightSidebarProvider>
  )
}
