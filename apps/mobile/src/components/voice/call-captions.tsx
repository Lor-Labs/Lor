import { useParticipants } from "@livekit/react-native"
import { useEffect, useState } from "react"
import { Text, View } from "react-native"
import { useCaptionLines } from "@/hooks/use-call-captions"

const MAX_LINES = 3
// A finished line stays up briefly; an interim line whose final never came
// (a failed stream) clears on its own.
const FINAL_LINGER_MS = 6_000
const INTERIM_LINGER_MS = 15_000

// Live captions over the bottom of the stage, like web's. Interim words are
// muted and settle to the normal color once the phrase is final.
export function CallCaptions() {
  const lines = useCaptionLines()
  const participants = useParticipants()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])

  const names = new Map(
    participants.map((participant) => [
      participant.identity,
      participant.name || "Someone",
    ])
  )
  const shown = lines
    .filter(
      (line) =>
        line.text.trim() &&
        now - line.heardAt < (line.final ? FINAL_LINGER_MS : INTERIM_LINGER_MS)
    )
    .slice(-MAX_LINES)
  if (shown.length === 0) return null

  return (
    <View
      accessibilityLiveRegion="polite"
      className="absolute inset-x-three bottom-three items-center"
      pointerEvents="none"
    >
      <View className="max-w-full gap-one rounded-lor-md bg-surface/90 px-three py-two">
        {shown.map((line) => (
          <Text className="text-[15px] leading-5" key={line.id}>
            <Text className="font-semibold text-foreground">
              {names.get(line.participantId) ?? "Someone"}
            </Text>{" "}
            <Text className={line.final ? "text-foreground" : "text-muted"}>
              {line.text}
            </Text>
          </Text>
        ))}
      </View>
    </View>
  )
}
