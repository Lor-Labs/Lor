"use client"

import { useEffect, useState } from "react"

// Claude-Code-style nonsense gerunds Merlin cycles through while it works — a
// mix of made-up words and wizardly flavor. Purely cosmetic.
const WORDS = [
  "Mandibulating",
  "Conjuring",
  "Frobnicating",
  "Incanting",
  "Discombobulating",
  "Percolating",
  "Bamboozling",
  "Enchanting",
  "Ruminating",
  "Hornswoggling",
  "Galumphing",
  "Noodling",
  "Bewitching",
  "Kerfuffling",
  "Perambulating",
  "Summoning",
  "Bumfuzzling",
  "Effervescing",
  "Wizarding",
  "Marinating",
]

const ROTATE_MS = 2200

export function ThinkingIndicator() {
  // Start somewhere random so two concurrent replies don't chant in unison,
  // then walk the list in order.
  const [index, setIndex] = useState(() =>
    Math.floor(Math.random() * WORDS.length)
  )

  useEffect(() => {
    const id = setInterval(
      () => setIndex((i) => (i + 1) % WORDS.length),
      ROTATE_MS
    )
    return () => clearInterval(id)
  }, [])

  return (
    <span className="inline-flex items-center text-sm text-muted-foreground italic">
      {WORDS[index]}
      <span className="ml-1 animate-pulse">…</span>
    </span>
  )
}
