import { MinusSignIcon, PlusSignIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import {
  isZoomScopeAvailable,
  useDesktopZoom,
  ZOOM_LEVELS,
  ZOOM_SCOPES,
} from "@/context/desktop-zoom-context"

export function DesktopZoomHud() {
  const zoom = useDesktopZoom()
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const [interacting, setInteracting] = useState(false)
  const notice = zoom?.notice
  const hideControls = zoom?.hideControls

  useEffect(() => {
    if (!notice || !hideControls) return
    const onOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return
      if (event.target.closest("#desktop-zoom-controls")) return
      hideControls()
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return
      const restoreFocus = panelRef.current?.contains(document.activeElement)
      event.preventDefault()
      event.stopPropagation()
      hideControls()
      if (restoreFocus) {
        if (returnFocusRef.current?.isConnected) {
          returnFocusRef.current.focus({ preventScroll: true })
        }
      }
    }
    document.addEventListener("pointerdown", onOutside)
    document.addEventListener("keydown", onEscape)
    return () => {
      document.removeEventListener("pointerdown", onOutside)
      document.removeEventListener("keydown", onEscape)
    }
  }, [!!notice, hideControls])

  useEffect(() => {
    if (!notice) return
    const active = document.activeElement
    if (active instanceof HTMLElement && !panelRef.current?.contains(active)) {
      returnFocusRef.current = active
    }
  }, [!!notice])

  useEffect(() => {
    if (
      !notice ||
      interacting ||
      panelRef.current?.contains(document.activeElement)
    )
      return
    const timer = window.setTimeout(() => hideControls?.(), 3000)
    return () => window.clearTimeout(timer)
  }, [notice, interacting, hideControls])

  if (!zoom || !notice) return null
  const scope = isZoomScopeAvailable(zoom.scope) ? zoom.scope : "app"
  const percent = zoom.levels[scope]
  const shortcut = /Mac/.test(navigator.platform) ? "⌘" : "Ctrl"

  return createPortal(
    <div
      id="desktop-zoom-controls"
      ref={panelRef}
      className="fixed top-16 right-4 z-50 max-w-[calc(100vw-32px)] text-foreground"
      onPointerEnter={() => setInteracting(true)}
      onPointerLeave={() => setInteracting(false)}
      onFocus={() => setInteracting(true)}
      onBlur={() => setInteracting(false)}
    >
      <div className="flex items-center gap-1 rounded-full border border-border bg-popover p-1.5 text-xs shadow-lg/10">
        <output
          aria-label={`${ZOOM_SCOPES[scope]} zoom`}
          title={`${ZOOM_SCOPES[scope]} zoom`}
          className="min-w-11 px-1 text-center font-medium tabular-nums"
        >
          {percent}%
        </output>
        <button
          type="button"
          aria-label="Zoom out"
          title={`Zoom out (${shortcut}−)`}
          disabled={percent === ZOOM_LEVELS[0]}
          onClick={() => zoom.changeZoom(scope, "out")}
          className="desktop-zoom-step"
        >
          <HugeiconsIcon icon={MinusSignIcon} size={15} strokeWidth={2} />
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          title={`Zoom in (${shortcut}+)`}
          disabled={percent === ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
          onClick={() => zoom.changeZoom(scope, "in")}
          className="desktop-zoom-step"
        >
          <HugeiconsIcon icon={PlusSignIcon} size={15} strokeWidth={2} />
        </button>
        <div className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
        <button
          type="button"
          disabled={percent === 100}
          title={`Reset zoom (${shortcut}0)`}
          onClick={() => zoom.changeZoom(scope, "reset")}
          className="h-7 rounded-full px-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Reset
        </button>
      </div>
      {zoom.error && (
        <p
          role="alert"
          className="mt-2 rounded-lg border bg-popover px-3 py-2 text-xs text-destructive-foreground shadow-sm"
        >
          {zoom.error}
        </p>
      )}
    </div>,
    document.body
  )
}

function ZoomedRegion({
  children,
  scope,
  percent,
  appPercent,
}: {
  children: ReactNode
  scope: "main" | "right"
  percent: number
  appPercent: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const container = containerRef.current
    const content = contentRef.current
    if (!container || !content) return
    const factor = percent / 100
    // Keep the dock geometry unscaled; only its contents reflow. Write directly
    // during resize so dragging a panel doesn't re-render the message tree.
    const resize = (width: number, height: number) => {
      content.style.width = `${width / factor}px`
      content.style.height = `${height / factor}px`
    }
    resize(container.clientWidth, container.clientHeight)
    const observer = new ResizeObserver(([entry]) => {
      if (entry) resize(entry.contentRect.width, entry.contentRect.height)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [percent])

  return (
    <div
      ref={containerRef}
      data-desktop-zoom-region={scope}
      className="relative h-full min-h-0 w-full min-w-0 flex-1 overflow-hidden"
    >
      <div
        ref={contentRef}
        className="absolute top-0 left-0 flex h-full w-full min-w-0 flex-col"
        style={
          {
            zoom: percent / 100,
            "--desktop-region-zoom": percent / 100,
            "--desktop-chrome-scale": (percent * appPercent) / 10000,
          } as CSSProperties
        }
      >
        {children}
      </div>
    </div>
  )
}

export function DesktopZoomRegion({
  children,
  scope,
}: {
  children: ReactNode
  scope: "main" | "right"
}) {
  const zoom = useDesktopZoom()
  return zoom ? (
    <ZoomedRegion
      scope={scope}
      percent={zoom.levels[scope]}
      appPercent={zoom.levels.app}
    >
      {children}
    </ZoomedRegion>
  ) : (
    children
  )
}
