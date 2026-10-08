import { Input, type InputProps } from "@repo/ui/components/input"
import { useEffect, useRef } from "react"

type PrefillInputProps = Omit<InputProps, "value" | "onChange"> & {
  value: string
  onChange: (value: string) => void
  /** The looked-up value on screen, or null once the user has typed. */
  prefill: string | null
  /** Shimmering stand-in for the placeholder while the lookup runs. */
  pendingLabel: string | null
}

// Onboarding field the company-site lookup can fill. The filled text blurs
// in the way the Website favicon does, so the prefill gets noticed.
export function PrefillInput({
  value,
  onChange,
  prefill,
  pendingLabel,
  placeholder,
  ...props
}: PrefillInputProps) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const input = ref.current
    if (!prefill || !input) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    // Text only: a filter on the input would blur its border too.
    const color = getComputedStyle(input).color
    input.animate(
      [
        { color: "transparent", textShadow: `0 0 6px ${color}` },
        { color, textShadow: `0 0 0 ${color}` },
      ],
      { duration: 280, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }
    )
  }, [prefill])

  const showPending = pendingLabel !== null && value === ""

  return (
    <div className="relative">
      <Input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={showPending ? undefined : placeholder}
        aria-busy={showPending || undefined}
        {...props}
      />
      {showPending && (
        <span
          aria-hidden
          className="shimmer pointer-events-none absolute inset-y-0 left-3 flex items-center text-base text-muted-foreground/72 sm:text-sm"
        >
          {pendingLabel}
        </span>
      )}
    </div>
  )
}
