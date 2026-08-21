import { cn } from "@repo/ui/lib/utils"

// Slack-style private channel glyph: a hashtag whose top-right corner is
// replaced by a small lock. Hand-drawn to match HugeIcons' 24px stroke
// language (2px strokes, round caps, slightly slanted verticals) because the
// set has no composite hash+lock icon.
export function PrivateHashIcon({
  className,
  strokeWidth = 2,
}: {
  className?: string
  strokeWidth?: number
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("size-4 shrink-0", className)}
      aria-hidden="true"
    >
      {/* Hashtag — right vertical and top bar stop short of the lock. */}
      <path
        d="M10 4L8 20"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      <path
        d="M16.9 9.8L15 20"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      <path
        d="M4.5 9H12.6"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      <path
        d="M4 15H19"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      {/* Lock — tucked into the top-right corner, clear of the hash strokes. */}
      <path
        d="M17.5 3.3V2.55a1.75 1.75 0 0 1 3.5 0V3.3"
        stroke="currentColor"
        strokeWidth={strokeWidth * 0.75}
        strokeLinecap="round"
      />
      <rect
        x="16.5"
        y="3.3"
        width="5.5"
        height="4.5"
        rx="1"
        stroke="currentColor"
        strokeWidth={strokeWidth * 0.75}
      />
    </svg>
  )
}
