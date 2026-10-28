import { PencilEdit02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@repo/ui/components/tooltip"
import { useMatch } from "@tanstack/react-router"
import { listen } from "@tauri-apps/api/event"
import { useEffect, useRef } from "react"
import { useOpenNewSession } from "@/hooks/use-open-new-session"

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window

// The sidebar's New session button, a compose icon beside the search. On
// desktop it also answers Cmd+N from the app menu; browser tabs can't
// capture Cmd+N, so the web uses this button or ⌘K.
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
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="New session"
            aria-current={active ? "page" : undefined}
            onClick={openNewSession}
            className="size-8 rounded-md border-border bg-background text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground aria-[current=page]:bg-foreground/[0.06] aria-[current=page]:text-foreground sm:size-8"
          />
        }
      >
        <HugeiconsIcon
          icon={PencilEdit02Icon}
          className="size-3.5"
          strokeWidth={1.75}
        />
      </TooltipTrigger>
      <TooltipContent>New session{isTauri && " ⌘N"}</TooltipContent>
    </Tooltip>
  )
}
