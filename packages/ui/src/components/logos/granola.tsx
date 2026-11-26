import {
  GRANOLA_BRAND,
  GRANOLA_INK,
  GRANOLA_LOGO_VIEW_BOX,
  GRANOLA_SPIRAL_PATH,
  GRANOLA_TILE,
} from "@repo/ui/lib/granola-logo"

// In color, as Granola's own app icon.
export function GranolaLogo({ className }: { className?: string }) {
  return (
    <svg
      aria-label="Granola"
      className={className}
      role="img"
      viewBox={GRANOLA_LOGO_VIEW_BOX}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        fill={GRANOLA_BRAND}
        height={GRANOLA_TILE.size}
        rx={GRANOLA_TILE.radius}
        width={GRANOLA_TILE.size}
        x={GRANOLA_TILE.x}
        y={GRANOLA_TILE.y}
      />
      <path d={GRANOLA_SPIRAL_PATH} fill={GRANOLA_INK} />
    </svg>
  )
}
