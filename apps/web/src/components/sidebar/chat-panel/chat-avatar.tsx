import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/avatar"
import { cn } from "@repo/ui/lib/utils"
import { getAvatarInitials } from "@repo/utils/avatar-colors"
import { AgentCreature } from "@/components/agent/agent-creature"
import { agentCreature, type WorkspaceAgent } from "@/hooks/use-agents"

export type ChatPerson = {
  id: string
  name: string
  image: string | null
  avatarColor: string | null
}

// Where the faces of a chat sit inside its round avatar, by how many show.
// Laid out for a 44px circle and scaled to the size asked for.
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

function PersonFace({ person, size }: { person: ChatPerson; size: number }) {
  return (
    <Avatar style={{ width: size, height: size }} title={person.name}>
      {person.image && <AvatarImage src={person.image} alt={person.name} />}
      <AvatarFallback
        avatarColor={person.avatarColor}
        fallbackSeed={person.name}
        className="font-semibold"
        style={{ fontSize: Math.max(8, Math.round(size * 0.42)) }}
      >
        {getAvatarInitials(person.name).slice(0, size < 18 ? 1 : 2)}
      </AvatarFallback>
    </Avatar>
  )
}

// A chat's face: its agents, then the people in it besides you (you alone
// when nobody else is). `total` counts everyone the chat holds besides you,
// shown or not: past four, three faces and a count. `grow` is for New chat,
// where faces arrive one at a time and the others make room.
export function ChatAvatar({
  agents,
  people,
  total,
  size = 40,
  grow,
}: {
  agents: WorkspaceAgent[]
  people: ChatPerson[]
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
      // A transform, so a face moving to make room costs no layout.
      style: {
        left: 0,
        top: 0,
        transform: `translate(${Math.round(spot.x * k)}px, ${Math.round(spot.y * k)}px)`,
      },
    }
  }
  const more = at(3)
  return (
    <span
      aria-hidden="true"
      className="relative block shrink-0 rounded-full bg-foreground/[0.07]"
      style={{ width: size, height: size }}
    >
      {shown.map((face, index) => {
        const spot = at(index)
        return (
          <span
            key={face.kind === "agent" ? face.agent.id : face.person.id}
            className={cn(
              "absolute flex",
              grow &&
                "transition-[transform,opacity,scale] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] starting:scale-75 starting:opacity-0 motion-reduce:transition-none"
            )}
            style={spot.style}
          >
            {face.kind === "agent" ? (
              <AgentCreature
                creature={agentCreature(face.agent)}
                size={spot.size}
                still
              />
            ) : (
              <PersonFace person={face.person} size={spot.size} />
            )}
          </span>
        )
      })}
      {count > 4 && (
        <span
          className="absolute flex items-center justify-center rounded-full bg-foreground/15 font-semibold text-foreground/80"
          style={{
            ...more.style,
            width: more.size,
            height: more.size,
            fontSize: Math.max(8, Math.round(more.size * 0.5)),
          }}
        >
          +{count - 3}
        </span>
      )}
    </span>
  )
}
