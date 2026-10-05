import { useThemeColor } from "heroui-native/hooks"
import { Text, View } from "react-native"
import Svg, { Circle, Path, Rect } from "react-native-svg"

// Linear's status and priority marks in our colours, matching web
// (apps/web/src/components/voice/linear-issue-icons.tsx).

export function LinearStatusIcon({
  state,
  size = 14,
}: {
  state: string | null
  size?: number
}) {
  const [warning, accent, muted, background] = useThemeColor([
    "warning",
    "accent",
    "muted",
    "background",
  ])
  const color =
    state === "started" ? warning : state === "completed" ? accent : muted
  const filled = (glyph: string) => (
    <>
      <Circle cx="7" cy="7" fill={color} r="7" />
      <Path
        d={glyph}
        fill="none"
        stroke={background}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </>
  )
  const ring = (dashed: boolean) => (
    <Circle
      cx="7"
      cy="7"
      fill="none"
      r="6"
      stroke={color}
      strokeDasharray={dashed ? "1.4 1.74" : undefined}
      strokeWidth="1.5"
    />
  )
  const shape =
    state === "completed" ? (
      filled("M4.2 7.2 6.1 9.1 9.8 5.2")
    ) : state === "canceled" ? (
      filled("M5 5l4 4M9 5 5 9")
    ) : state === "duplicate" ? (
      filled("M5 9 9 5")
    ) : state === "started" ? (
      <>
        {ring(false)}
        <Path d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill={color} />
      </>
    ) : (
      ring(state === "backlog" || state === "triage")
    )
  return (
    <Svg height={size} viewBox="0 0 14 14" width={size}>
      {shape}
    </Svg>
  )
}

// 0 none, 1 urgent, 2 high, 3 medium, 4 low.
export function LinearPriorityIcon({ priority }: { priority: number }) {
  const muted = useThemeColor("muted")
  if (priority === 1) {
    return (
      <View className="size-[14px] items-center justify-center rounded-[3px] bg-lor-urgent dark:bg-lor-urgent-dark">
        <Text className="text-[10px] font-bold leading-[12px] text-background">
          !
        </Text>
      </View>
    )
  }
  if (priority === 0) {
    return (
      <Svg height={14} viewBox="0 0 14 14" width={14}>
        <Path
          d="M2 7h2M6 7h2M10 7h2"
          stroke={muted}
          strokeLinecap="round"
          strokeWidth="1.5"
        />
      </Svg>
    )
  }
  const lit = 5 - priority
  return (
    <Svg height={14} viewBox="0 0 14 14" width={14}>
      {[4, 7, 10].map((height, index) => (
        <Rect
          key={height}
          fill={muted}
          height={height}
          opacity={index < lit ? 1 : 0.3}
          rx="1"
          width="3"
          x={1.5 + index * 4}
          y={12 - height}
        />
      ))}
    </Svg>
  )
}
