import { Path, Rect, Svg } from "react-native-svg"

// Slack-style private channel glyph: a hashtag whose top-right corner is
// replaced by a small lock. Mirrors the web component — HugeIcons has no
// composite hash+lock icon, so the paths are hand-drawn to match its 24px
// stroke language.
export function PrivateHashIcon({
  color,
  size = 19,
  strokeWidth = 1.8,
}: {
  color: string
  size?: number
  strokeWidth?: number
}) {
  return (
    <Svg viewBox="0 0 24 24" width={size} height={size} fill="none">
      <Path
        d="M10 4L8 20"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      <Path
        d="M16.9 9.8L15 20"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      <Path
        d="M4.5 9H12.6"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      <Path
        d="M4 15H19"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      <Path
        d="M17.5 3.3V2.55a1.75 1.75 0 0 1 3.5 0V3.3"
        stroke={color}
        strokeWidth={strokeWidth * 0.75}
        strokeLinecap="round"
      />
      <Rect
        x="16.5"
        y="3.3"
        width="5.5"
        height="4.5"
        rx="1"
        stroke={color}
        strokeWidth={strokeWidth * 0.75}
      />
    </Svg>
  )
}
