import type { ReactNode } from "react"

// Double-bezel frame: hairline outer tray, dark inner core with a top
// highlight, concentric radii. Every product mock on the page sits in one.
export function MockShell({
  children,
  className = "",
  innerClassName = "",
}: {
  children: ReactNode
  className?: string
  innerClassName?: string
}) {
  return (
    <div
      className={`rounded-[1.5rem] border border-foreground/[0.08] bg-foreground/[0.03] p-1.5 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.7)] ${className}`}
    >
      <div
        className={`overflow-hidden rounded-[calc(1.5rem-0.375rem)] border border-foreground/[0.06] bg-lor-bg-dark shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ${innerClassName}`}
      >
        {children}
      </div>
    </div>
  )
}
