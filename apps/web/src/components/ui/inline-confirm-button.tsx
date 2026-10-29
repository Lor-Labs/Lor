import { Delete02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Spinner } from "@repo/ui/components/spinner"
import { cn } from "@repo/ui/lib/utils"
import { useEffect, useRef, useState } from "react"

// How long an armed button waits for its second press while left alone.
const DISARM_AFTER_MS = 4000

/**
 * A row's remove button that confirms in place instead of opening a dialog:
 * the first press grows the trash icon into a red pill ("Remove", "Revoke"),
 * the second runs `onConfirm`. Escape, a press elsewhere, focus moving away or
 * a few idle seconds put the icon back. Escape is caught before the dialog
 * around the list sees it, so it only disarms. A rejected `onConfirm` resets
 * the button, so a failed delete never loses the row.
 */
export function InlineConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  disabled = false,
  className,
}: {
  /** The idle button's name, such as "Revoke invite to ada@acme.com". */
  label: string
  /** The armed pill's text, such as "Revoke". */
  confirmLabel: string
  onConfirm: () => Promise<unknown>
  disabled?: boolean
  className?: string
}) {
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const hovered = useRef(false)
  const timer = useRef<number | undefined>(undefined)

  const stopTimer = () => window.clearTimeout(timer.current)
  const startTimer = () => {
    stopTimer()
    timer.current = window.setTimeout(() => setArmed(false), DISARM_AFTER_MS)
  }

  useEffect(() => () => window.clearTimeout(timer.current), [])

  useEffect(() => {
    if (!armed || busy) return
    const disarm = () => {
      window.clearTimeout(timer.current)
      setArmed(false)
    }
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        buttonRef.current?.contains(event.target)
      )
        return
      disarm()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      disarm()
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    window.addEventListener("keydown", onKeyDown, true)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true)
      window.removeEventListener("keydown", onKeyDown, true)
    }
  }, [armed, busy])

  const confirm = () => {
    stopTimer()
    setBusy(true)
    onConfirm().catch(() => {
      setBusy(false)
      setArmed(false)
    })
  }

  const open = armed || busy

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={open ? confirmLabel : label}
        disabled={disabled || busy}
        onClick={() => {
          if (armed) {
            confirm()
            return
          }
          setArmed(true)
          // The pointer resting on the button, or keyboard focus, holds it
          // armed; the idle countdown starts once neither does.
          if (hovered.current || buttonRef.current?.matches(":focus-visible"))
            stopTimer()
          else startTimer()
        }}
        onPointerEnter={() => {
          hovered.current = true
          if (armed) stopTimer()
        }}
        onPointerLeave={() => {
          hovered.current = false
          if (armed && !busy) startTimer()
        }}
        onBlur={() => {
          if (busy) return
          stopTimer()
          setArmed(false)
        }}
        className={cn(
          "flex h-8 min-w-8 shrink-0 cursor-pointer items-center justify-center overflow-hidden whitespace-nowrap rounded-md font-medium text-xs outline-none transition-[background-color,color,padding] duration-200 ease-out focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none motion-reduce:transition-none",
          open
            ? "bg-destructive/10 px-2.5 text-destructive-foreground hover:bg-destructive/15 focus-visible:ring-destructive/40"
            : "px-0 text-muted-foreground hover:bg-accent hover:text-destructive-foreground disabled:opacity-64",
          className
        )}
      >
        {busy ? (
          <Spinner className="size-3.5 shrink-0" />
        ) : (
          <HugeiconsIcon
            icon={Delete02Icon}
            className="size-3.5 shrink-0"
            strokeWidth={2}
          />
        )}
        <span
          className={cn(
            "overflow-hidden transition-[max-width,margin,opacity] duration-200 ease-out motion-reduce:transition-none",
            open ? "ml-1.5 max-w-16 opacity-100" : "ml-0 max-w-0 opacity-0"
          )}
        >
          {confirmLabel}
        </span>
      </button>
      <span aria-live="polite" className="sr-only">
        {armed && !busy ? `Press again to ${confirmLabel.toLowerCase()}` : ""}
      </span>
    </>
  )
}
