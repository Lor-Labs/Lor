import { useEffect, useRef } from "react"

// The open session document's composer send, by thread root. Panel buttons
// that ask Lor (the Browser tab's "Ask Lor to set up the app") post through
// it, so the message and Lor's working turn show optimistically: the server's
// message:created echo skips the sender's own socket. False when not sent.
type SessionSend = (
  content: string,
  onFailed: (error: string) => void
) => boolean

const senders = new Map<string, SessionSend>()

export function useProvideSessionSend(threadRootId: string, send: SessionSend) {
  const sendRef = useRef(send)
  // After commit: a render React discards must not change which thread a
  // panel's send posts to.
  useEffect(() => {
    sendRef.current = send
  })
  useEffect(() => {
    const entry: SessionSend = (content, onFailed) =>
      sendRef.current(content, onFailed)
    senders.set(threadRootId, entry)
    return () => {
      if (senders.get(threadRootId) === entry) senders.delete(threadRootId)
    }
  }, [threadRootId])
}

export const sessionSend = (threadRootId: string) => senders.get(threadRootId)
