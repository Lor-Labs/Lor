import { useId } from "react"

export function LorMark({ className }: { className?: string }) {
  const gradientId = useId()
  return (
    <svg viewBox="124 288 776 470" aria-hidden="true" className={className}>
      <defs>
        <linearGradient
          id={gradientId}
          x1="512"
          y1="288"
          x2="512"
          y2="758"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#5629e8" />
          <stop offset="45%" stopColor="#8155f2" />
          <stop offset="100%" stopColor="#cfa3f8" />
        </linearGradient>
      </defs>
      <path
        d="M 134.17 673.78 L 358.47 366.11 A 190.0 190.0 0 0 1 512.00 288.04 A 190.0 190.0 0 0 1 665.53 366.11 L 889.83 673.78 A 53.0 53.0 0 0 1 881.62 745.13 A 53.0 53.0 0 0 1 809.84 742.79 L 561.08 498.14 A 70.0 70.0 0 0 0 512.00 478.05 A 70.0 70.0 0 0 0 462.92 498.14 L 214.16 742.79 A 53.0 53.0 0 0 1 142.38 745.13 A 53.0 53.0 0 0 1 134.17 673.78 Z"
        fill={`url(#${gradientId})`}
      />
    </svg>
  )
}
