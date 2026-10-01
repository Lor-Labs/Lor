import { Separator } from "@repo/ui/components/separator"
import { cn } from "@repo/ui/lib/utils"
import { motion } from "motion/react"
import { useTheme } from "next-themes"
import type { MouseEvent } from "react"
import { useEffect, useState } from "react"

type ThemeValue = "light" | "dark" | "system"

const THEME_OPTIONS: {
  value: ThemeValue
  label: string
  description: string
}[] = [
  { value: "light", label: "Light", description: "Always light" },
  { value: "dark", label: "Dark", description: "Always dark" },
  { value: "system", label: "System", description: "Sync with device" },
]

type DocumentWithViewTransition = Document & {
  startViewTransition?: (cb: () => void) => { ready: Promise<void> }
}

// Circular reveal from the click point, matching the rest of the app's theme
// transitions (keyframes live in globals.css). Falls back to an instant swap.
function applyThemeWithTransition(
  event: MouseEvent<HTMLButtonElement>,
  apply: () => void
) {
  const doc = document as DocumentWithViewTransition
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches

  if (reduced || typeof doc.startViewTransition !== "function") {
    apply()
    return
  }

  // Keyboard activations report (0, 0) for clientX/Y — fall back to the
  // triggering button's center so the reveal doesn't fly in from the corner.
  const hasPointer = event.clientX !== 0 || event.clientY !== 0
  const rect = event.currentTarget.getBoundingClientRect()
  const x = hasPointer ? event.clientX : rect.left + rect.width / 2
  const y = hasPointer ? event.clientY : rect.top + rect.height / 2
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y)
  )

  const root = document.documentElement
  root.style.setProperty("--vt-x", `${x}px`)
  root.style.setProperty("--vt-y", `${y}px`)
  root.style.setProperty("--vt-r", `${endRadius}px`)
  doc.startViewTransition(apply)
}

function Bar({ className }: { className?: string }) {
  return <div className={cn("h-1 rounded-full", className)} />
}

// Miniature of the Lor workspace chrome built from semantic tokens, so it
// adopts whatever palette its wrapper (.light / .dark) scopes onto it.
function ThemeMockup() {
  return (
    <div className="flex h-full w-full bg-background">
      <div className="flex w-[36%] flex-col gap-1.5 bg-sidebar p-2">
        <div className="mb-0.5 flex items-center gap-1">
          <div className="size-2.5 shrink-0 rounded-[3px] bg-primary" />
          <Bar className="w-2/3 bg-foreground/30" />
        </div>
        <Bar className="w-4/5 bg-foreground/10" />
        <div className="flex h-3.5 items-center rounded-[4px] bg-sidebar-accent px-1.5">
          <Bar className="w-3/5 bg-foreground/30" />
        </div>
        <Bar className="w-3/4 bg-foreground/10" />
        <Bar className="w-2/3 bg-foreground/10" />
        <div className="mt-auto flex items-center gap-1">
          <div className="size-2.5 shrink-0 rounded-full bg-agent" />
          <Bar className="w-1/2 bg-agent/40" />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-2.5">
        <div className="flex items-center gap-1.5">
          <div className="size-3 shrink-0 rounded-full bg-foreground/20" />
          <div className="flex flex-1 flex-col gap-1">
            <Bar className="w-1/4 bg-foreground/30" />
            <Bar className="w-4/5 bg-foreground/10" />
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="size-3 shrink-0 rounded-full bg-foreground/20" />
          <div className="flex flex-1 flex-col gap-1">
            <Bar className="w-1/3 bg-foreground/30" />
            <Bar className="w-full bg-foreground/10" />
          </div>
        </div>
        <div className="mt-auto flex gap-1.5 rounded-md border-accent border-[1px] bg-agent/[0.08] p-1.5">
          <div className="size-3 shrink-0 rounded-full bg-agent" />
          <div className="flex flex-1 flex-col gap-1">
            <Bar className="w-1/4 bg-agent/50" />
            <Bar className="w-full bg-foreground/20" />
            <Bar className="w-3/5 bg-foreground/20" />
          </div>
        </div>
      </div>
    </div>
  )
}

function ThemePreview({ value }: { value: ThemeValue }) {
  if (value === "system") {
    return (
      <div className="relative h-full w-full">
        <div className="light absolute inset-0">
          <ThemeMockup />
        </div>
        <div
          className="dark absolute inset-0"
          style={{ clipPath: "polygon(100% 0, 100% 100%, 0% 100%)" }}
        >
          <ThemeMockup />
        </div>
      </div>
    )
  }

  return (
    <div className={cn("h-full w-full", value)}>
      <ThemeMockup />
    </div>
  )
}

export function AppearanceSettings() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const active = mounted ? (theme ?? "system") : undefined

  const handleSelect = (
    value: ThemeValue,
    event: MouseEvent<HTMLButtonElement>
  ) => {
    if (value === theme) return
    applyThemeWithTransition(event, () => setTheme(value))
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold text-lg">Appearance</h3>
        <p className="text-muted-foreground text-sm">
          Choose how Lor looks to you. Sync with your system, or pick a theme.
        </p>
      </div>

      <Separator />

      <div>
        <h4 className="mb-3 font-medium text-sm">Theme</h4>
        <div
          role="radiogroup"
          aria-label="Theme"
          className="grid grid-cols-1 gap-4 sm:grid-cols-3"
        >
          {THEME_OPTIONS.map((opt) => {
            const selected = active === opt.value
            return (
              // biome-ignore lint/a11y/useSemanticElements: card acts as a themed radio; the preview thumbnail can't be a native radio input
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={(e) => handleSelect(opt.value, e)}
                className={cn(
                  "group relative flex flex-col gap-2.5 rounded-xl border border-border p-2 text-left transition-colors",
                  !selected && "hover:border-foreground/20"
                )}
              >
                {selected && (
                  <motion.div
                    layoutId="appearance-theme-ring"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
                    className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-primary"
                  />
                )}
                <div className="aspect-[4/3] overflow-hidden rounded-lg border border-border">
                  <ThemePreview value={opt.value} />
                </div>
                <div className="flex items-center gap-2 px-1 pb-0.5">
                  <span
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                      selected ? "border-primary" : "border-muted-foreground/40"
                    )}
                  >
                    {selected && (
                      <motion.span
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{
                          type: "spring",
                          bounce: 0.2,
                          duration: 0.3,
                        }}
                        className="size-2 rounded-full bg-primary"
                      />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p
                      className={cn(
                        "text-sm leading-tight",
                        selected
                          ? "font-medium text-foreground"
                          : "text-foreground/90"
                      )}
                    >
                      {opt.label}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {opt.description}
                    </p>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
