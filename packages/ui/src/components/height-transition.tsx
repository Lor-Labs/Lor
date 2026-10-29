"use client"

import { EASE_OUT } from "@repo/ui/lib/motion"
import type React from "react"
import { useEffect, useLayoutEffect, useRef } from "react"

const DURATION_MS = 200
const EASING = `cubic-bezier(${EASE_OUT.join(", ")})`

// Eases its height between two versions of its content (clamped text and the
// full text, a short list and the whole list). `contentKey` names the version
// showing; `fadeIn` also fades the new version in when it replaces the old
// one rather than extending it. Nothing moves on first paint or under reduced
// motion, and a swap mid-move starts from the current height.
export function HeightTransition({
  contentKey,
  fadeIn = false,
  className,
  children,
}: {
  contentKey: string
  fadeIn?: boolean
  className?: string
  children: React.ReactNode
}): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  const settledHeight = useRef<number | null>(null)
  const running = useRef<Animation | null>(null)

  // Content can also change size on its own (text reflow, new rows), so the
  // starting height for the next swap is kept current while at rest.
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      if (!running.current) {
        settledHeight.current = element.getBoundingClientRect().height
      }
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Runs only when the content version changes.
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const from = running.current
      ? element.getBoundingClientRect().height
      : settledHeight.current
    running.current?.cancel()
    const to = element.getBoundingClientRect().height
    settledHeight.current = to
    if (from === null || from === to) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    element.style.overflow = "hidden"
    const animation = element.animate(
      [{ height: `${from}px` }, { height: `${to}px` }],
      { duration: DURATION_MS, easing: EASING }
    )
    if (fadeIn) {
      for (const child of element.children) {
        child.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: DURATION_MS,
          easing: EASING,
        })
      }
    }
    running.current = animation
    const settle = () => {
      if (running.current !== animation) return
      running.current = null
      element.style.overflow = ""
      settledHeight.current = element.getBoundingClientRect().height
    }
    animation.onfinish = settle
    animation.oncancel = settle
  }, [contentKey])

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}
