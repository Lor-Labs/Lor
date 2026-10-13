import { PencilEdit02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { cn } from "@repo/ui/lib/utils"
import { useMatch } from "@tanstack/react-router"
import { listen } from "@tauri-apps/api/event"
import { useEffect, useRef } from "react"
import { useOpenNewSession } from "@/hooks/use-open-new-session"

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window

// The sidebar's "New session" row. On desktop it also answers Cmd+N from the
// app menu; browser tabs can't capture Cmd+N, so the web uses this row or ⌘K.
export function NewSessionButton() {
  const openNewSession = useOpenNewSession()
  const active = useMatch({
    from: "/_authenticated/$workspaceSlug/session/new",
    shouldThrow: false,
  })
  const openRef = useRef(openNewSession)
  openRef.current = openNewSession

  useEffect(() => {
    if (!isTauri) return
    let disposed = false
    let stopListening: (() => void) | undefined
    listen("new-session", () => openRef.current())
      .then((unlisten) => {
        if (disposed) unlisten()
        else stopListening = unlisten
      })
      .catch((error) => {
        console.error("[new-session] failed to register desktop menu:", error)
      })
    return () => {
      disposed = true
      stopListening?.()
    }
  }, [])

  return (
    <button
      type="button"
      onClick={openNewSession}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-[6px] text-[14px] transition-colors hover:bg-foreground/[0.06]",
        active
          ? "bg-foreground/[0.06] font-medium text-foreground"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      <HugeiconsIcon
        icon={PencilEdit02Icon}
        className="size-4 shrink-0 opacity-70"
        strokeWidth={2}
      />
      New session
      {isTauri && (
        <kbd className="ml-auto font-sans text-[11px] text-muted-foreground/70">
          ⌘N
        </kbd>
      )}
    </button>
  )
}
