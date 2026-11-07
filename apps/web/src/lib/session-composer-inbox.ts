import { useEffect, useRef } from "react"

// Text for an open session's composer from outside it: the review card in
// the thread and the Details panel's Review list ("Fix with Lor"). The
// session page listens for its own thread.

type Listener = (markdown: string) => void

const listeners = new Map<string, Set<Listener>>()

// False when that session's composer isn't open.
export function sendToSessionComposer(
  threadRootId: string,
  markdown: string
): boolean {
  const set = listeners.get(threadRootId)
  if (!set || set.size === 0) return false
  for (const listener of set) listener(markdown)
  return true
}

export function useSessionComposerInbox(
  threadRootId: string,
  onMarkdown: Listener
) {
  const latest = useRef(onMarkdown)
  latest.current = onMarkdown
  useEffect(() => {
    const listener: Listener = (markdown) => latest.current(markdown)
    const set = listeners.get(threadRootId) ?? new Set<Listener>()
    set.add(listener)
    listeners.set(threadRootId, set)
    return () => {
      set.delete(listener)
      if (set.size === 0) listeners.delete(threadRootId)
    }
  }, [threadRootId])
}
