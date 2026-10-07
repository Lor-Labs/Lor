import { useSyncExternalStore } from "react"

// Live-only signals from a running request to Lor: the tools it has started
// and the reactions it chose. Fed by socket events (useVoiceRequests) and the
// dev simulator; never fetched, so a late joiner sees only what comes next.
// Same as web's store.

export type LorReaction = { id: number; emoji: string }

// How long a reaction floats before it's gone.
export const REACTION_MS = 1_800

const EMPTY_TOOLS: string[] = []
const EMPTY_REACTIONS: LorReaction[] = []
const tools = new Map<string, string[]>()
const reactions = new Map<string, LorReaction[]>()
const listeners = new Set<() => void>()
let nextReactionId = 0

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function addLorTool(requestId: string, toolName: string) {
  const list = tools.get(requestId) ?? EMPTY_TOOLS
  if (list.includes(toolName)) return
  tools.set(requestId, [...list, toolName])
  emit()
}

export function addLorReaction(requestId: string, emoji: string) {
  const reaction = { id: nextReactionId++, emoji }
  reactions.set(requestId, [...(reactions.get(requestId) ?? []), reaction])
  emit()
  setTimeout(() => {
    const rest = (reactions.get(requestId) ?? []).filter(
      (entry) => entry.id !== reaction.id
    )
    reactions.set(requestId, rest)
    emit()
  }, REACTION_MS)
}

export function useLorTools(requestId: string) {
  return useSyncExternalStore(
    subscribe,
    () => tools.get(requestId) ?? EMPTY_TOOLS,
    () => EMPTY_TOOLS
  )
}

export function useLorReactions(requestId: string) {
  return useSyncExternalStore(
    subscribe,
    () => reactions.get(requestId) ?? EMPTY_REACTIONS,
    () => EMPTY_REACTIONS
  )
}
