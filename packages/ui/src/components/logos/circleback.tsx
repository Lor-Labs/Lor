import { CIRCLEBACK_ICON_DATA_URI } from "@repo/ui/lib/circleback-logo"

// In color, as Circleback's own icon.
export function CirclebackLogo({ className }: { className?: string }) {
  return (
    <img
      alt="Circleback"
      className={className}
      draggable={false}
      height={128}
      src={CIRCLEBACK_ICON_DATA_URI}
      width={128}
    />
  )
}
