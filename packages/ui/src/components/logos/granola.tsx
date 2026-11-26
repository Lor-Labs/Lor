import { GRANOLA_ICON_DATA_URI } from "@repo/ui/lib/granola-logo"

// In color, as Granola's own app icon.
export function GranolaLogo({ className }: { className?: string }) {
  return (
    <img
      alt="Granola"
      className={className}
      draggable={false}
      height={128}
      src={GRANOLA_ICON_DATA_URI}
      width={128}
    />
  )
}
