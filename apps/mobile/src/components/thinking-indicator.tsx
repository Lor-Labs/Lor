import { useEffect, useState } from "react"
import { Text } from "react-native"

const WORDS = [
  "Conjuring",
  "Percolating",
  "Ruminating",
  "Noodling",
  "Summoning",
  "Wizarding",
  "Marinating",
]

export function ThinkingIndicator() {
  const [index, setIndex] = useState(() =>
    Math.floor(Math.random() * WORDS.length)
  )

  useEffect(() => {
    const interval = setInterval(
      () => setIndex((current) => (current + 1) % WORDS.length),
      2200
    )
    return () => clearInterval(interval)
  }, [])

  return (
    <Text
      accessibilityLabel="Merlin is thinking"
      accessibilityLiveRegion="polite"
      className="text-sm italic text-muted"
    >
      {WORDS[index]}…
    </Text>
  )
}
