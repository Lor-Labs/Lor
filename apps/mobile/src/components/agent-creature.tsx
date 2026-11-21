import {
  type CreatureId,
  type CreatureState,
  creatureById,
  pixelRuns,
  SPRITE_SIZE,
} from "@repo/utils/bestiary"
import { memo, useMemo } from "react"
import Svg, { Path } from "react-native-svg"

// A channel agent's creature, as on web's agent-creature.tsx (decision 33).
// Still for now: asleep shows it with its eyes shut.
export const AgentCreature = memo(function AgentCreature({
  creature,
  state = "idle",
  size,
}: {
  creature: CreatureId
  state?: CreatureState
  size: number
}) {
  const art = creatureById(creature)
  const asleep = state === "asleep"
  const runs = useMemo(
    () =>
      pixelRuns({
        palette: art.palette,
        rows: asleep ? art.closed : art.open,
      }),
    [art, asleep]
  )
  return (
    <Svg
      height={size}
      viewBox={`0 0 ${SPRITE_SIZE} ${SPRITE_SIZE}`}
      width={size}
    >
      {runs.map(({ color, d }) => (
        <Path key={color} d={d} fill={color} />
      ))}
    </Svg>
  )
})
