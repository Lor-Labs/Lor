import { useEffect, useRef } from "react"

// Text for an open session's composer from outside it: the review card's
// Fix with Lor. The session's thread view listens for its own thread while
// its composer shows. Mirrors web's session-composer-inbox.ts.

type Listener = (text: string) => void

const listeners = new Map<string, Set<Listener>>()

// False when that session's composer isn't showing, so the sender can say so.
export function sendToSessionComposer(
  threadRootId: string,
  text: string
): boolean {
  const set = listeners.get(threadRootId)
  if (!set || set.size === 0) return false
  for (const listener of set) listener(text)
  return true
}

export function useSessionComposerInbox(
  threadRootId: string,
  onText: Listener,
  enabled = true
) {
  const latest = useRef(onText)
  useEffect(() => {
    latest.current = onText
  }, [onText])
  useEffect(() => {
    if (!enabled) return
    const listener: Listener = (text) => latest.current(text)
    const set = listeners.get(threadRootId) ?? new Set<Listener>()
    set.add(listener)
    listeners.set(threadRootId, set)
    return () => {
      set.delete(listener)
      if (set.size === 0) listeners.delete(threadRootId)
    }
  }, [threadRootId, enabled])
}
