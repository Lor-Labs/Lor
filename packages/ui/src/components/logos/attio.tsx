import {
  ATTIO_LOGO_PATHS,
  ATTIO_LOGO_TRANSFORM,
  ATTIO_LOGO_VIEW_BOX,
} from "@repo/ui/lib/attio-logo"

export function AttioLogo({ className }: { className?: string }) {
  return (
    <svg
      aria-label="Attio"
      className={className}
      role="img"
      viewBox={ATTIO_LOGO_VIEW_BOX}
      xmlns="http://www.w3.org/2000/svg"
    >
      <g fill="currentColor" transform={ATTIO_LOGO_TRANSFORM}>
        {ATTIO_LOGO_PATHS.map((path) => (
          <path d={path} key={path} />
        ))}
      </g>
    </svg>
  )
}
