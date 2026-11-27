import { getAvatarColorStyle } from "@repo/utils/avatar-colors"
import type { CreatureId } from "@repo/utils/bestiary"
import { Text, View } from "react-native"
import Animated, { ZoomIn, ZoomOut } from "react-native-reanimated"
import { AgentCreature } from "@/components/agent-creature"
import { Avatar } from "@/components/ui/avatar"
import { EASE_OUT } from "@/lib/motion"

export type ChatAvatarPerson = {
  id: string
  name: string
  image: string | null
  avatarColor: string | null
}

export type ChatAvatarAgent = { id: string; creature: CreatureId }

// Where the faces of a chat sit inside its round avatar, by how many show.
// Laid out for a 44pt circle and scaled to the size asked for. As web's
// chat-avatar.tsx.
const CLUSTER: Record<number, { x: number; y: number; size: number }[]> = {
  1: [{ x: 7, y: 7, size: 30 }],
  2: [
    { x: 4, y: 9, size: 22 },
    { x: 23, y: 17, size: 17 },
  ],
  3: [
    { x: 12, y: 5, size: 20 },
    { x: 6, y: 23, size: 15 },
    { x: 23, y: 23, size: 15 },
  ],
  4: [
    { x: 5, y: 5, size: 18 },
    { x: 25, y: 7, size: 14 },
    { x: 7, y: 25, size: 14 },
    { x: 23, y: 23, size: 16 },
  ],
}

const GROW = ZoomIn.duration(260).easing(EASE_OUT)
const SHRINK = ZoomOut.duration(160).easing(EASE_OUT)

// A chat's face: its agents, then the people in it besides you (you alone
// when nobody else is). `total` counts everyone it holds besides you: past
// four, three faces and a count. `grow` is for New chat, where faces arrive
// one at a time.
export function ChatAvatar({
  agents,
  people,
  total,
  size = 48,
  grow = false,
}: {
  agents: ChatAvatarAgent[]
  people: ChatAvatarPerson[]
  total: number
  size?: number
  grow?: boolean
}) {
  const faces = [
    ...agents.map((agent) => ({ kind: "agent" as const, agent })),
    ...people.map((person) => ({ kind: "person" as const, person })),
  ]
  const count = Math.max(total, faces.length)
  const shown = count > 4 ? faces.slice(0, 3) : faces.slice(0, 4)
  const spots = CLUSTER[Math.min(count, 4)] ?? []
  const k = size / 44
  const at = (index: number) => {
    const spot = spots[index] ?? { x: 0, y: 0, size: 0 }
    return {
      size: Math.round(spot.size * k),
      left: Math.round(spot.x * k),
      top: Math.round(spot.y * k),
    }
  }
  const more = at(3)
  return (
    <View
      accessibilityElementsHidden
      className="rounded-full bg-surface-secondary"
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size }}
    >
      {shown.map((face, index) => {
        const spot = at(index)
        return (
          <Animated.View
            entering={grow ? GROW : undefined}
            exiting={grow ? SHRINK : undefined}
            key={face.kind === "agent" ? face.agent.id : face.person.id}
            // Moving to make room is a transform, not a layout pass.
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              transform: [{ translateX: spot.left }, { translateY: spot.top }],
            }}
          >
            {face.kind === "agent" ? (
              <AgentCreature
                creature={face.agent.creature}
                size={spot.size}
                still
              />
            ) : (
              <Avatar
                avatarColor={face.person.avatarColor}
                fallback={
                  <Text
                    style={{
                      color: getAvatarColorStyle(
                        face.person.avatarColor,
                        face.person.name
                      ).foregroundColor,
                      fontSize: Math.max(8, Math.round(spot.size * 0.42)),
                      fontWeight: "600",
                    }}
                  >
                    {initials(face.person.name, spot.size < 18 ? 1 : 2)}
                  </Text>
                }
                image={face.person.image}
                name={face.person.name}
                style={{ width: spot.size, height: spot.size }}
              />
            )}
          </Animated.View>
        )
      })}
      {count > 4 ? (
        <View
          className="absolute items-center justify-center rounded-full bg-surface-tertiary"
          style={{
            left: more.left,
            top: more.top,
            width: more.size,
            height: more.size,
          }}
        >
          <Text
            className="font-semibold text-foreground"
            style={{
              fontSize: Math.max(8, Math.round(more.size * 0.5)),
              fontVariant: ["tabular-nums"],
            }}
          >
            +{count - 3}
          </Text>
        </View>
      ) : null}
    </View>
  )
}

function initials(name: string, letters: number) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, letters)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}
