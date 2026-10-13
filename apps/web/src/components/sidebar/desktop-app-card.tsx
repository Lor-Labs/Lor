import {
  Cancel01Icon,
  Download04Icon,
  LaptopIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { isTauri } from "@repo/auth/tauri-fetch"
import { Button } from "@repo/ui/components/button"
import { AnimatePresence, motion } from "motion/react"
import { useEffect, useState } from "react"
import { usePageHint } from "@/components/hints/hints-provider"
import {
  canDownloadDesktopApp,
  downloadDesktopApp,
} from "@/lib/desktop-download"

// Visible-tab time in this browser, counted after the How Lor works tour, so
// the desktop app nudge waits for a few minutes of real use.
const ACTIVE_SECONDS_KEY = "lor:active-seconds"
const SHOW_AFTER_SECONDS = 5 * 60
const TICK_SECONDS = 15

function readActiveSeconds() {
  return Number(localStorage.getItem(ACTIVE_SECONDS_KEY)) || 0
}

function useActiveTimeReached(counting: boolean) {
  const [reached, setReached] = useState(
    () => canDownloadDesktopApp && readActiveSeconds() >= SHOW_AFTER_SECONDS
  )

  useEffect(() => {
    if (!counting || reached) return
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return
      const next = readActiveSeconds() + TICK_SECONDS
      localStorage.setItem(ACTIVE_SECONDS_KEY, String(next))
      if (next >= SHOW_AFTER_SECONDS) setReached(true)
    }, TICK_SECONDS * 1000)
    return () => window.clearInterval(id)
  }, [counting, reached])

  return reached
}

export function DesktopAppCard() {
  const tour = usePageHint("how_lor_works")
  const { dismissed, popoverShowing, dismiss } = usePageHint("desktop_app")
  const counting = canDownloadDesktopApp && tour.dismissed && !dismissed
  const reached = useActiveTimeReached(counting)
  const show = counting && reached && !popoverShowing

  // Someone who opened the desktop app never needs the browser to ask.
  useEffect(() => {
    if (isTauri && !dismissed) dismiss()
  }, [dismissed, dismiss])

  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-lg border bg-background/60 p-3"
        >
          <div className="flex items-center gap-2">
            <HugeiconsIcon
              icon={LaptopIcon}
              className="size-4 shrink-0 text-muted-foreground"
              strokeWidth={1.5}
            />
            <span className="min-w-0 flex-1 truncate font-medium text-[13px]">
              Lor for macOS
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Dismiss"
              className="-my-1 -mr-1 text-muted-foreground hover:text-foreground"
              onClick={dismiss}
            >
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
            </Button>
          </div>
          <p className="mt-1 text-muted-foreground text-xs leading-snug">
            Get notified even after you close the window.
          </p>
          <Button
            variant="outline"
            size="xs"
            className="mt-2.5 w-full"
            onClick={() => {
              downloadDesktopApp()
              dismiss()
            }}
          >
            <HugeiconsIcon icon={Download04Icon} strokeWidth={2} />
            Download
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
