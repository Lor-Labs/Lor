import type { CreatureId } from "@repo/utils/bestiary"

export interface MentionCandidate {
  id: string
  label: string
  search?: string
  name?: string
  image?: string | null
  // The channel agent: drawn as its creature instead of an avatar.
  creature?: CreatureId
}
