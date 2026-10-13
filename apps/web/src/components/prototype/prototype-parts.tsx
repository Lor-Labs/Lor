import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/avatar"
import type { Person } from "./prototype-data"

export function PersonAvatar({
  person,
  className,
}: {
  person: Person
  className?: string
}) {
  return (
    <Avatar className={className}>
      <AvatarImage src={person.image} alt={person.name} />
      <AvatarFallback fallbackSeed={person.name} className="text-[10px]">
        {person.name.charAt(0)}
      </AvatarFallback>
    </Avatar>
  )
}

export function MentionText({ text }: { text: string }) {
  let offset = 0
  const parts = text.split(/(@\w+)/g).map((part) => {
    const key = offset
    offset += part.length
    return { key, part }
  })
  return parts.map(({ key, part }) =>
    part.startsWith("@") ? (
      <span key={key} className="font-medium text-primary">
        {part}
      </span>
    ) : (
      <span key={key}>{part}</span>
    )
  )
}
