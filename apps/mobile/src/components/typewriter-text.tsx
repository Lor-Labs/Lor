import { useEffect, useRef, useState } from "react"
import { useReducedMotion } from "react-native-reanimated"

const CHAR_MS = 28
// Long titles speed up so the whole reveal stays short.
const MAX_REVEAL_MS = 900

// Text that types itself out when it changes in front of you and `animate`
// is set, like a session title Lor generated. People's edits change at once,
// and the first render shows the text as is. Render it inside a <Text>.
// Mirrors web's typewriter-text.tsx.
export function TypewriterText({
  text,
  animate,
}: {
  text: string
  animate: boolean
}) {
  const reduceMotion = useReducedMotion()
  const [shown, setShown] = useState(text)
  const lastText = useRef(text)

  useEffect(() => {
    if (lastText.current === text) return
    lastText.current = text
    if (!animate || reduceMotion) {
      setShown(text)
      return
    }
    const chars = Array.from(text)
    const step = Math.min(CHAR_MS, MAX_REVEAL_MS / chars.length)
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const count = Math.min(chars.length, Math.floor((now - start) / step) + 1)
      setShown(chars.slice(0, count).join(""))
      if (count < chars.length) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [text, animate, reduceMotion])

  // An edit shows on its first render, not a frame later from the effect.
  return <>{animate ? shown : text}</>
}
