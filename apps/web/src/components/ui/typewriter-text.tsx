import { useEffect, useRef, useState } from "react"

const CHAR_MS = 28
// Long titles speed up so the whole reveal stays short.
const MAX_REVEAL_MS = 900

// A text that types itself out when it changes in front of you and `animate`
// is set, like a session title Lor generated. People's edits change at once,
// and the first render shows the text as is.
export function TypewriterText({
  text,
  animate,
  className,
}: {
  text: string
  animate: boolean
  className?: string
}) {
  const [shown, setShown] = useState(text)
  const lastText = useRef(text)

  useEffect(() => {
    if (lastText.current === text) return
    lastText.current = text
    if (
      !animate ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
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
  }, [text, animate])

  // An edit shows on its first render, not a frame later from the effect.
  const visible = animate ? shown : text

  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {visible}
        {visible !== text && (
          <span className="ml-px inline-block h-[0.9em] w-[1.5px] translate-y-[0.12em] bg-current motion-safe:animate-pulse" />
        )}
      </span>
    </span>
  )
}
