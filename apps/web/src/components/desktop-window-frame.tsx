import { getCurrentWindow } from "@tauri-apps/api/window"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"

const isMacDesktopApp =
  typeof window !== "undefined" &&
  "__TAURI_INTERNALS__" in window &&
  /Mac/.test(navigator.platform)

/** Top strip of the window that acts as the draggable titlebar. Matches the
 * bottom edge of the main header (8px inset margin + h-12); the sidebar
 * titlebar row ends inside it. */
const DRAG_BAND_HEIGHT = 56

const INTERACTIVE_DRAG_TARGET =
  "button, a, input, textarea, select, [role='button'], [role='menuitem'], [contenteditable='true']"

const DesktopChromeContext = createContext<{
  isMacDesktop: boolean
  isFullscreen: boolean
}>({ isMacDesktop: false, isFullscreen: false })

export function useDesktopChrome() {
  return useContext(DesktopChromeContext)
}

function isDragBandTarget(event: React.MouseEvent<HTMLElement>) {
  if (event.button !== 0 || event.defaultPrevented) return false

  const target = event.target
  if (!(target instanceof Element)) return false
  if (target.closest(INTERACTIVE_DRAG_TARGET)) return false

  const bounds = event.currentTarget.getBoundingClientRect()
  return (
    event.clientY >= bounds.top &&
    event.clientY <= bounds.top + DRAG_BAND_HEIGHT
  )
}

export function DesktopWindowFrame({
  children,
}: {
  children: React.ReactNode
}) {
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    if (!isMacDesktopApp) return

    const appWindow = getCurrentWindow()
    let disposed = false
    let stopListening: (() => void) | undefined

    const syncFullscreenState = async () => {
      const fullscreen = await appWindow.isFullscreen()
      if (!disposed) setIsFullscreen(fullscreen)
    }

    void syncFullscreenState()
    void appWindow.onResized(syncFullscreenState).then((unlisten) => {
      if (disposed) {
        unlisten()
      } else {
        stopListening = unlisten
      }
    })

    return () => {
      disposed = true
      stopListening?.()
    }
  }, [])

  const onMouseDown = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (!isDragBandTarget(event) || event.detail > 1) return
    void getCurrentWindow().startDragging()
  }, [])

  const onDoubleClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (!isDragBandTarget(event)) return
    void getCurrentWindow().toggleMaximize()
  }, [])

  if (!isMacDesktopApp) return children

  return (
    <DesktopChromeContext.Provider value={{ isMacDesktop: true, isFullscreen }}>
      <div className="tauri-macos-window flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-sidebar">
        <div
          data-tauri-window-content=""
          onMouseDown={onMouseDown}
          onDoubleClick={onDoubleClick}
          className="relative h-full min-h-0 overflow-hidden"
        >
          {children}
        </div>
      </div>
    </DesktopChromeContext.Provider>
  )
}
