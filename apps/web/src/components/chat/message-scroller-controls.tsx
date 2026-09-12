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

const PANEL_REFLOW_PIN_DURATION_MS = 500
const NEAR_END_ANCHOR_PX = 24
const REFLOW_SETTLE_MS = 250

// Message rows are in document order. Avoid measuring every preceding row
// on each scroll or click in a long conversation.
function findRowAtTop(
  rows: ArrayLike<HTMLElement>,
  viewportTop: number,
  includePartial: boolean
) {
  let low = 0
  let high = rows.length
  while (low < high) {
    const mid = (low + high) >>> 1
    const rect = rows[mid]?.getBoundingClientRect()
    if (
      rect &&
      (includePartial ? rect.bottom > viewportTop : rect.top >= viewportTop)
    ) {
      high = mid
    } else {
      low = mid + 1
    }
  }
  return rows[low] ?? null
}

// True while pinMessageDuringReflow is holding a specific clicked row, so the
// generic width anchor below doesn't double-correct the same reflow.
let explicitReflowPinActive = false
// The active pin's cleanup. A new pin cancels the previous one first, so two
// pins never fight over the viewport and a stale timer can't clear the flag.
let cancelActiveReflowPin: (() => void) | null = null

// Opening or widening the right panel animates the transcript narrower, so
// every row re-wraps taller while scrollTop stays put — the clicked message
// silently drifts out of view. Hold the row at its on-screen position until
// the panel width animation settles.
export function pinMessageDuringReflow(
  viewport: HTMLElement | null,
  messageId: string,
  command?: MessageScrollCommand | null
) {
  if (!viewport) return
  const selector = `[data-slot="message-scroller-item"][data-message-id="${CSS.escape(messageId)}"]`
  let row = viewport.querySelector<HTMLElement>(selector)
  if (!row) return
  // A row that's off-screen isn't what the reader is looking at — leave the
  // reflow to the generic anchor (MessageScrollerReflowAnchor) instead.
  const viewportRect = viewport.getBoundingClientRect()
  const rowRect = row.getBoundingClientRect()
  if (
    rowRect.bottom <= viewportRect.top ||
    rowRect.top >= viewportRect.bottom
  ) {
    return
  }
  // Flip the scroller out of follow-output first, so its own resize handling
  // (snap to end) doesn't fight the pin.
  command?.(messageId, { align: "nearest", behavior: "auto" })
  cancelActiveReflowPin?.()
  explicitReflowPinActive = true
  const targetOffset =
    row.getBoundingClientRect().top - viewport.getBoundingClientRect().top

  const correct = () => {
    if (!row?.isConnected) row = viewport.querySelector<HTMLElement>(selector)
    if (!row) {
      cancel()
      return
    }
    const delta =
      row.getBoundingClientRect().top -
      viewport.getBoundingClientRect().top -
      targetOffset
    if (Math.abs(delta) > 0.5) viewport.scrollTop += delta
  }

  // ResizeObserver callbacks run after layout and before paint, so each
  // correction lands in the same frame as the panel's width step — the pinned
  // row never visibly moves. A rAF loop corrects one frame late and wobbles.
  const observer = new ResizeObserver(correct)
  const cancel = () => {
    explicitReflowPinActive = false
    cancelActiveReflowPin = null
    observer.disconnect()
    window.clearTimeout(timer)
    viewport.removeEventListener("wheel", cancel)
    viewport.removeEventListener("touchmove", cancel)
  }
  cancelActiveReflowPin = cancel
  observer.observe(viewport)
  const content = viewport.querySelector<HTMLElement>(
    '[data-slot="message-scroller-content"]'
  )
  if (content) observer.observe(content)
  const timer = window.setTimeout(cancel, PANEL_REFLOW_PIN_DURATION_MS)
  viewport.addEventListener("wheel", cancel, { passive: true })
  viewport.addEventListener("touchmove", cancel, { passive: true })
}

// Any viewport width change (right panel open/close/drag, sidebar collapse,
// window resize) re-wraps every row while scrollTop stays numerically fixed,
// so the reading position jumps. Anchor the first visible row — or the live
// edge when the reader is near the bottom — through the whole width animation.
// ResizeObserver corrections run after layout and before paint, so the anchored
// row never visibly moves.
export function MessageScrollerReflowAnchor({
  viewportRef,
}: {
  viewportRef: RefObject<HTMLDivElement | null>
}) {
  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    type Anchor =
      | { nearEnd: true }
      | { nearEnd: false; messageId: string; offset: number }
    let anchor: Anchor | null = null
    let lastWidth = viewport.clientWidth
    let holdUntil = 0
    let captureFrame: number | null = null
    let forcedCapture = false
    let holdFrame: number | null = null
    let settleTimer: number | null = null
    const content = viewport.querySelector<HTMLElement>(
      '[data-slot="message-scroller-content"]'
    )
    let rows: HTMLElement[] = []
    const refreshRows = () => {
      rows = Array.from(content?.children ?? []).filter(
        (element): element is HTMLElement =>
          element instanceof HTMLElement && Boolean(element.dataset.messageId)
      )
    }
    refreshRows()
    const rowObserver = new MutationObserver(refreshRows)
    if (content) rowObserver.observe(content, { childList: true })

    const captureAnchor = () => {
      const distanceFromEnd =
        viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop
      if (distanceFromEnd <= NEAR_END_ANCHOR_PX) {
        anchor = { nearEnd: true }
        return
      }
      const viewportTop = viewport.getBoundingClientRect().top
      anchor = null
      const el = findRowAtTop(rows, viewportTop, true)
      if (el) {
        const rect = el.getBoundingClientRect()
        const messageId = el.dataset.messageId
        if (messageId) {
          anchor = { nearEnd: false, messageId, offset: rect.top - viewportTop }
        }
      }
    }
    // Mid-animation scroll events come from our own corrections — keep the
    // pre-reflow anchor until the width settles, unless forced (user input).
    const scheduleCapture = (force = false) => {
      if (force) forcedCapture = true
      if (captureFrame !== null) return
      captureFrame = window.requestAnimationFrame(() => {
        captureFrame = null
        const forced = forcedCapture
        forcedCapture = false
        if (!forced && performance.now() < holdUntil) return
        captureAnchor()
      })
    }

    const restoreAnchor = () => {
      if (explicitReflowPinActive || !anchor) return
      if (anchor.nearEnd) {
        const target = viewport.scrollHeight - viewport.clientHeight
        if (Math.abs(viewport.scrollTop - target) > 0.5) {
          viewport.scrollTop = target
        }
        return
      }
      const row = viewport.querySelector<HTMLElement>(
        `[data-slot="message-scroller-item"][data-message-id="${CSS.escape(anchor.messageId)}"]`
      )
      if (!row) return
      const delta =
        row.getBoundingClientRect().top -
        viewport.getBoundingClientRect().top -
        anchor.offset
      if (Math.abs(delta) > 0.5) viewport.scrollTop += delta
    }
    // Re-assert the anchor every frame while the width is animating: anything
    // that moves scroll between ResizeObserver fires (browser scroll
    // anchoring, the scroller's own handlers, clamping) is corrected within a
    // frame instead of surviving as a visible shift.
    const holdLoop = () => {
      holdFrame = null
      restoreAnchor()
      if (performance.now() < holdUntil) {
        holdFrame = window.requestAnimationFrame(holdLoop)
      }
    }
    const stopHoldLoop = () => {
      if (holdFrame !== null) {
        window.cancelAnimationFrame(holdFrame)
        holdFrame = null
      }
    }
    // Correct once more before re-capturing, so a shift that landed after the
    // last observer fire doesn't get baked in as the new anchor.
    const settle = () => {
      restoreAnchor()
      holdUntil = 0
      stopHoldLoop()
      scheduleCapture(true)
    }
    // A real user scroll mid-animation takes over: re-anchor from wherever
    // they moved to instead of dragging them back.
    const yieldToUser = () => {
      holdUntil = 0
      stopHoldLoop()
      scheduleCapture(true)
    }

    captureAnchor()
    const handleScroll = () => scheduleCapture()
    viewport.addEventListener("scroll", handleScroll, { passive: true })
    viewport.addEventListener("wheel", yieldToUser, { passive: true })
    viewport.addEventListener("touchmove", yieldToUser, { passive: true })

    const observer = new ResizeObserver(() => {
      const width = viewport.clientWidth
      // Height-only changes (composer growing, keyboard) don't re-wrap rows —
      // leave those to the scroller primitive.
      if (width === lastWidth) return
      lastWidth = width
      holdUntil = performance.now() + REFLOW_SETTLE_MS
      if (settleTimer !== null) window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(settle, REFLOW_SETTLE_MS)
      restoreAnchor()
      if (holdFrame === null) {
        holdFrame = window.requestAnimationFrame(holdLoop)
      }
    })
    observer.observe(viewport)

    return () => {
      observer.disconnect()
      rowObserver.disconnect()
      viewport.removeEventListener("scroll", handleScroll)
      viewport.removeEventListener("wheel", yieldToUser)
      viewport.removeEventListener("touchmove", yieldToUser)
      if (captureFrame !== null) window.cancelAnimationFrame(captureFrame)
      stopHoldLoop()
      if (settleTimer !== null) window.clearTimeout(settleTimer)
    }
  }, [viewportRef])

  return null
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
  const firstRow =
    targetRow && isFullyVisible(targetRow)
      ? targetRow
      : findRowAtTop(
          viewport.querySelectorAll<HTMLElement>(
            '[data-slot="message-scroller-item"][data-message-id]'
          ),
          viewportRect.top,
          false
        )
  const stableRow = firstRow && isFullyVisible(firstRow) ? firstRow : null
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
