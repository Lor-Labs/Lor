import { useEffect, useState } from "react"
import { MorphText } from "@/components/ui/morph-text"

// Claude-Code-style nonsense gerunds Lor cycles through while it works — a
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
  "Pondering",
  "Spellweaving",
  "Divining",
  "Cogitating",
  "Tinkering",
  "Stargazing",
  "Transmuting",
  "Contemplating",
  "Deciphering",
  "Alchemizing",
  "Untangling",
  "Brewing",
  "Illuminating",
  "Riffing",
  "Dreamweaving",
  "Runesmithing",
  "Wandwaving",
  "Puzzling",
  "Envisioning",
  "Spellchecking",
]

const ROTATE_MS = 5_000

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

  // Every word ends in "ing…", so the suffix glides while the stem morphs.
  return (
    <MorphText className="shimmer-mask text-sm text-foreground italic">
      {`${WORDS[index]}…`}
    </MorphText>
  )
}
