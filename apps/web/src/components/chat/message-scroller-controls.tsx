import { ArrowDown01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import {
  MessageScrollerButton,
  useMessageScroller,
  useMessageScrollerScrollable,
} from "@repo/ui/components/message-scroller"
import { Spinner } from "@repo/ui/components/spinner"
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"

export type MessageScrollCommand = ReturnType<
  typeof useMessageScroller
>["scrollToMessage"]

export type MessageScrollToEndCommand = ReturnType<
  typeof useMessageScroller
>["scrollToEnd"]

const JUMP_TO_LATEST_REVEAL_DISTANCE = 160

export function highlightMessage(
  messageId: string,
  container: ParentNode = document
) {
  const element = container.querySelector(
    `[data-message-id="${CSS.escape(messageId)}"]`
  ) as HTMLElement | null
  if (!element) return
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

  element.animate(
    [
      { backgroundColor: "transparent", offset: 0 },
      {
        backgroundColor: "color-mix(in oklch, var(--primary) 15%, transparent)",
        offset: 0.08,
      },
      {
        backgroundColor: "color-mix(in oklch, var(--primary) 15%, transparent)",
        offset: 0.72,
      },
      { backgroundColor: "transparent", offset: 1 },
    ],
    { duration: 2400, easing: "ease-out" }
  )
}

export function signalMessageScrollerInteraction(
  target: EventTarget | null,
  command: MessageScrollCommand | null
) {
  if (!(target instanceof Element)) return
  const viewport = target.closest<HTMLElement>(
    '[data-slot="message-scroller-viewport"]'
  )
  if (!viewport) return
  const viewportRect = viewport.getBoundingClientRect()
  const targetRow = target.closest<HTMLElement>(
    '[data-slot="message-scroller-item"][data-message-id]'
  )
  const isFullyVisible = (row: HTMLElement) => {
    const rect = row.getBoundingClientRect()
    return rect.top >= viewportRect.top && rect.bottom <= viewportRect.bottom
  }
  const stableRow =
    targetRow && isFullyVisible(targetRow)
      ? targetRow
      : Array.from(
          viewport.querySelectorAll<HTMLElement>(
            '[data-slot="message-scroller-item"][data-message-id]'
          )
        ).find(isFullyVisible)
  const messageId = stableRow?.dataset.messageId
  if (!messageId) return
  // A nearest no-op still changes the primitive from follow-output to an
  // explicit message jump, so selection, links, reactions, and menus count as
  // reader intent without visually moving the transcript.
  command?.(messageId, { align: "nearest", behavior: "auto" })
}

export function MessageScrollerCommandBridge({
  register,
  registerScrollToEnd,
}: {
  register: (command: MessageScrollCommand | null) => void
  // Optional: lets a parent outside the provider jump to the live edge, which
  // also releases the scroller from "anchored to a message" mode.
  registerScrollToEnd?: (command: MessageScrollToEndCommand | null) => void
}) {
  const { scrollToMessage, scrollToEnd } = useMessageScroller()

  useLayoutEffect(() => {
    register(scrollToMessage)
    return () => register(null)
  }, [register, scrollToMessage])

  useLayoutEffect(() => {
    if (!registerScrollToEnd) return
    registerScrollToEnd(scrollToEnd)
    return () => registerScrollToEnd(null)
  }, [registerScrollToEnd, scrollToEnd])

  return null
}

export function MessageScrollTarget({
  messageId,
  contentVersion,
  containerRef,
}: {
  messageId: string | null | undefined
  contentVersion: string
  containerRef?: RefObject<HTMLElement | null>
}) {
  const { scrollToMessage } = useMessageScroller()
  const handledMessageIdRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    if (!messageId) {
      handledMessageIdRef.current = null
      return
    }
    if (handledMessageIdRef.current === messageId) return
    if (
      !scrollToMessage(messageId, {
        align: "center",
        behavior: "auto",
      })
    ) {
      return
    }
    handledMessageIdRef.current = messageId
    window.requestAnimationFrame(() =>
      highlightMessage(messageId, containerRef?.current ?? document)
    )
  }, [messageId, contentVersion, containerRef, scrollToMessage])

  return null
}

export function MessageScrollerJumpToLatest({
  newestMessageId,
  viewportRef,
  isMerlinResponding = false,
  pendingCount = 0,
  hasUnloadedNewer = false,
  onJumpToPresent,
}: {
  newestMessageId: string | null
  viewportRef: RefObject<HTMLDivElement | null>
  isMerlinResponding?: boolean
  pendingCount?: number
  hasUnloadedNewer?: boolean
  onJumpToPresent?: () => void
}) {
  const { end: canScrollToEnd } = useMessageScrollerScrollable()
  const previousNewestIdRef = useRef(newestMessageId)
  const [hasNewActivity, setHasNewActivity] = useState(false)
  const [isMeaningfullyScrolledUp, setIsMeaningfullyScrolledUp] =
    useState(false)

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    let frame: number | null = null
    const syncDistance = () => {
      frame = null
      const distanceFromEnd = Math.max(
        0,
        viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop
      )
      setIsMeaningfullyScrolledUp(
        distanceFromEnd >= JUMP_TO_LATEST_REVEAL_DISTANCE
      )
    }
    const scheduleDistanceSync = () => {
      if (frame !== null) return
      frame = window.requestAnimationFrame(syncDistance)
    }

    syncDistance()
    viewport.addEventListener("scroll", scheduleDistanceSync, {
      passive: true,
    })

    const resizeObserver = new ResizeObserver(scheduleDistanceSync)
    resizeObserver.observe(viewport)
    const content = viewport.querySelector<HTMLElement>(
      '[data-slot="message-scroller-content"]'
    )
    if (content) resizeObserver.observe(content)

    return () => {
      viewport.removeEventListener("scroll", scheduleDistanceSync)
      resizeObserver.disconnect()
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [viewportRef])

  useEffect(() => {
    const previousNewestId = previousNewestIdRef.current
    if (
      previousNewestId &&
      newestMessageId &&
      previousNewestId !== newestMessageId &&
      canScrollToEnd
    ) {
      setHasNewActivity(true)
    }
    previousNewestIdRef.current = newestMessageId
  }, [newestMessageId, canScrollToEnd])

  useEffect(() => {
    if (!canScrollToEnd) setHasNewActivity(false)
  }, [canScrollToEnd])

  const hasOffscreenLatest =
    canScrollToEnd || hasUnloadedNewer || pendingCount > 0
  const shouldShow =
    hasOffscreenLatest &&
    (isMeaningfullyScrolledUp || hasUnloadedNewer || pendingCount > 0)

  if (!shouldShow) return null

  const label = isMerlinResponding
    ? "Merlin is responding"
    : pendingCount > 0
      ? `${pendingCount} new message${pendingCount === 1 ? "" : "s"}`
      : hasUnloadedNewer || hasNewActivity
        ? "New messages"
        : "Jump to latest"

  const content = (
    <>
      {isMerlinResponding && (
        <Spinner className="size-3.5 motion-reduce:animate-none" />
      )}
      <span>{label}</span>
      <HugeiconsIcon
        icon={ArrowDown01Icon}
        className="size-3.5"
        strokeWidth={2.25}
      />
    </>
  )

  const button = (
    <Button
      size="sm"
      variant="outline"
      className="h-8 rounded-full bg-background/95 px-3 text-xs shadow-sm backdrop-blur-sm hover:bg-accent"
    />
  )

  // Anchored search/history mode can be at the end of the mounted slice while
  // newer pages still exist. In that case the primitive correctly sees no DOM
  // distance to scroll, so use a normal button to return to the live query.
  if (hasUnloadedNewer || pendingCount > 0) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onJumpToPresent}
        className="absolute bottom-3 left-1/2 z-10 h-8 -translate-x-1/2 rounded-full bg-background/95 px-3 text-xs shadow-sm backdrop-blur-sm hover:bg-accent"
      >
        {content}
      </Button>
    )
  }

  return (
    <MessageScrollerButton render={button} onClick={onJumpToPresent}>
      {content}
    </MessageScrollerButton>
  )
}

export function useRegisteredMessageScroller() {
  const commandRef = useRef<MessageScrollCommand | null>(null)
  const register = useCallback((command: MessageScrollCommand | null) => {
    commandRef.current = command
  }, [])
  const scrollToEndRef = useRef<MessageScrollToEndCommand | null>(null)
  const registerScrollToEnd = useCallback(
    (command: MessageScrollToEndCommand | null) => {
      scrollToEndRef.current = command
    },
    []
  )

  return { commandRef, register, scrollToEndRef, registerScrollToEnd }
}
