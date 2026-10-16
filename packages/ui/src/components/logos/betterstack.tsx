import {
  BETTERSTACK_LOGO_PATHS,
  BETTERSTACK_LOGO_VIEW_BOX,
} from "@repo/ui/lib/betterstack-logo"

export function BetterStackLogo({ className }: { className?: string }) {
  return (
    <svg
      aria-label="Better Stack"
      className={className}
      fill="currentColor"
      role="img"
      viewBox={BETTERSTACK_LOGO_VIEW_BOX}
      xmlns="http://www.w3.org/2000/svg"
    >
      {BETTERSTACK_LOGO_PATHS.map((path) => (
        <path d={path} key={path} />
      ))}
    </svg>
  )
}
