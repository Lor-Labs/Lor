import { toast } from "@repo/ui/components/toast"
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import {
  highlightMessage,
  jumpScrollBehavior,
  signalMessageScrollerInteraction,
  useRegisteredMessageScroller,
} from "@/components/chat/message-scroller-controls"
import {
  useMessageLocation,
  useMessageSearchNavigation,
} from "@/hooks/use-message-search-navigation"
import type { Message } from "@/lib/api-types"

// Scrolling for a thread or session transcript: where it opens, following a
// send to the end, and jumping to a message (loading it, or navigating away
// when it lives in another conversation).
export function useConversationScroll({
  threadRootId,
  targetMessageId,
  messages,
  isLoading,
  ensureMessage,
}: {
  threadRootId: string
  // Message to reveal on open (search result, citation).
  targetMessageId?: string
  messages: Message[]
  isLoading: boolean
  ensureMessage: (messageId: string) => Promise<boolean>
}) {
  const { resolve: resolveMessageLocation } = useMessageLocation()
  const navigateToMessage = useMessageSearchNavigation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const {
    commandRef: messageScrollCommandRef,
    register: registerScrollCommand,
    scrollToEndRef,
    registerScrollToEnd,
  } = useRegisteredMessageScroller()

  // Anchors are only for the initial view of an existing thread. Freeze them
  // from the first loaded snapshot so a message sent while this panel is open
  // stays at the live edge instead of creating an empty anchored viewport.
  const openingAnchorsRef = useRef({
    threadRootId,
    initialized: false,
    messageIds: new Set<string>(),
  })
  if (openingAnchorsRef.current.threadRootId !== threadRootId) {
    openingAnchorsRef.current = {
      threadRootId,
      initialized: false,
      messageIds: new Set<string>(),
    }
  }
  if (!isLoading && !openingAnchorsRef.current.initialized) {
    openingAnchorsRef.current.initialized = true
    // Anchor only triggers of runs still streaming at open. The scroller pins
    // an anchor to the top with a spacer below so the answer can grow into
    // it — right for a live run, but anchoring a *completed* run from
    // history leaves that spacer as a dead gap under the last message
    // (thread opens with messages hoisted up and blank space above the
    // composer). Finished threads open at the live edge instead.
    openingAnchorsRef.current.messageIds = new Set(
      messages
        .filter((message) => message.status === "pending")
        .map((message) => message.lorTriggerMessageId)
        .filter((id): id is string => Boolean(id))
    )
  }

  const [sendScrollVersion, setSendScrollVersion] = useState(0)
  useLayoutEffect(() => {
    if (!sendScrollVersion) return
    scrollToEndRef.current?.({ behavior: "auto" })
    // Query notifications and composer resizing may land after the send commit.
    const viewport = scrollRef.current
    const frame = window.requestAnimationFrame(() => {
      if (viewport && scrollRef.current === viewport) {
        scrollToEndRef.current?.({ behavior: "auto" })
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [sendScrollVersion, scrollToEndRef])
  // Retires the opening anchors so a later resize cannot recapture them.
  const scrollAfterSend = useCallback(() => {
    openingAnchorsRef.current.messageIds.clear()
    scrollToEndRef.current?.({ behavior: "auto" })
    setSendScrollVersion((version) => version + 1)
  }, [scrollToEndRef])

  // Scoped to this transcript's scroll container so it never grabs the
  // channel feed's copy of the same message id (the root appears in both).
  const jumpToMessage = useCallback(
    (messageId: string) => {
      const scrollToTarget = () => {
        const didScroll =
          messageScrollCommandRef.current?.(messageId, {
            align: "center",
            behavior: jumpScrollBehavior(),
          }) ?? false
        if (didScroll) {
          window.requestAnimationFrame(() =>
            highlightMessage(messageId, scrollRef.current ?? document)
          )
        }
        return didScroll
      }

      if (scrollToTarget()) return
      // Resolve the location first (cached; citations prefetch it on hover) so
      // a message outside this thread navigates without a wasted thread fetch.
      void (async () => {
        const loc = await resolveMessageLocation(messageId)
        if (loc && (loc.threadRootId ?? loc.messageId) !== threadRootId) {
          navigateToMessage({
            id: loc.messageId,
            channelId: loc.channelId,
            threadRootId: loc.threadRootId,
            sessionId: loc.sessionId,
          })
          return
        }
        if (!(await ensureMessage(messageId))) {
          toast.error("Couldn't find that message")
          return
        }
        window.requestAnimationFrame(scrollToTarget)
      })().catch(() => toast.error("Couldn't load that message"))
    },
    [
      ensureMessage,
      messageScrollCommandRef,
      resolveMessageLocation,
      navigateToMessage,
      threadRootId,
    ]
  )

  // Search results can deep-link to an older reply outside the initial
  // live-tail page: load that slice, then center + highlight it.
  useEffect(() => {
    if (!targetMessageId) return
    jumpToMessage(targetMessageId)
  }, [targetMessageId, jumpToMessage])

  const onReaderPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      signalMessageScrollerInteraction(
        event.target,
        messageScrollCommandRef.current
      )
    },
    [messageScrollCommandRef]
  )

  return {
    scrollRef,
    registerScrollCommand,
    registerScrollToEnd,
    scrollToEndRef,
    openingLorTriggerMessageIds: openingAnchorsRef.current.messageIds,
    scrollAfterSend,
    jumpToMessage,
    onReaderPointerDown,
  }
}
