"use client"

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import { PlanStep } from "@/app/components/mock-parts"

export const PREVIEW_TIMELINES = [
  { beats: [0, 1120, 2560, 4000, 5760], duration: 8000 },
  { beats: [0, 640, 1760, 3360, 5200, 6800], duration: 8400 },
  { beats: [0, 960, 2560, 3760], duration: 5200 },
  { beats: [0, 640, 1680, 2880, 4000, 5200, 6320], duration: 8000 },
  {
    beats: [0, 960, 1920, 3040, 4480, 5600, 6720, 7760, 8800],
    duration: 10400,
  },
  { beats: [0, 640, 1760, 3840], duration: 6400 },
] as const

export const PreviewPlayback = createContext({
  guided: false,
  running: false,
  beat: 0,
  scene: 0,
})

export const usePreviewPlayback = () => useContext(PreviewPlayback)

function easing() {
  return getComputedStyle(document.documentElement)
    .getPropertyValue("--ease-out")
    .trim()
}

export function PreviewReveal({
  at = 0,
  children,
  className,
}: {
  at?: number
  children: ReactNode
  className?: string
}) {
  const { guided, running, beat } = usePreviewPlayback()
  const visible = !guided || beat >= at
  const element = useRef<HTMLDivElement>(null)
  const animation = useRef<Animation | null>(null)

  useEffect(() => {
    if (!guided || !visible || !element.current) return
    const entrance = element.current.animate(
      [
        { opacity: 0, transform: "translateY(8px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 300, easing: easing(), fill: "both" }
    )
    entrance.pause()
    animation.current = entrance
    return () => {
      entrance.cancel()
      animation.current = null
    }
  }, [guided, visible])

  useEffect(() => {
    if (running) animation.current?.play()
    else animation.current?.pause()
  }, [running, guided, visible])

  return (
    <div
      ref={element}
      data-preview-beat={at}
      aria-hidden={!visible || undefined}
      inert={!visible}
      className={className}
      style={{ visibility: visible ? undefined : "hidden" }}
    >
      {children}
    </div>
  )
}

function Working({ detail }: { detail: string }) {
  const { running } = usePreviewPlayback()
  const dots = useRef<HTMLSpanElement>(null)
  const animations = useRef<Animation[]>([])
  useEffect(() => {
    animations.current = Array.from(dots.current?.children ?? []).map(
      (dot, i) => {
        const animation = dot.animate(
          [{ opacity: 0.25 }, { opacity: 1 }, { opacity: 0.25 }],
          { duration: 1200, delay: i * 150, iterations: Infinity }
        )
        animation.pause()
        return animation
      }
    )
    return () => {
      for (const animation of animations.current) animation.cancel()
    }
  }, [])
  useEffect(() => {
    for (const animation of animations.current) {
      if (running) animation.play()
      else animation.pause()
    }
  }, [running])
  return (
    <div className="flex items-center gap-2 pt-1 text-[12.5px] text-lor-text-tertiary-dark">
      <span ref={dots} aria-hidden="true" className="flex gap-1 text-agent">
        {[0, 1, 2].map((dot) => (
          <span key={dot} className="size-1 rounded-full bg-current" />
        ))}
      </span>
      {detail}
    </div>
  )
}

export function PreviewResponse({
  at,
  detail,
  children,
}: {
  at?: number
  detail: string
  children: ReactNode
}) {
  const { guided, beat } = usePreviewPlayback()
  if (at === undefined) return <>{children}</>
  if (guided && at !== undefined && beat < at)
    return <Working detail={detail} />
  return <PreviewReveal at={at}>{children}</PreviewReveal>
}

const CUES: Record<number, Record<number, string>> = {
  1: { 5: "fork" },
  2: { 3: "continue" },
  3: { 6: "review" },
  4: {
    0: "Files",
    1: "folder",
    2: "source",
    3: "Changes",
    4: "stage",
    6: "commit",
    7: "push",
  },
}

export function PreviewPlan({ plan }: { plan: string[] }) {
  const { guided, beat, running } = usePreviewPlayback()
  const completed = guided ? Math.max(0, beat - 1) : plan.length
  return (
    <>
      {plan.map((label, index) => (
        <PlanStep
          key={label}
          label={label}
          status={
            index < completed
              ? "done"
              : index === completed
                ? "active"
                : "pending"
          }
          last={index === plan.length - 1}
          paused={!running}
        />
      ))}
    </>
  )
}

export function PreviewPointer() {
  const { guided, running, scene, beat } = usePreviewPlayback()
  const target = guided ? CUES[scene]?.[beat] : undefined
  const [point, setPoint] = useState<{
    x: number
    y: number
    target: string
  } | null>(null)
  const cursor = useRef<HTMLDivElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const motion = useRef<Animation | null>(null)

  useEffect(() => {
    const root = overlay.current?.parentElement
    if (!root || !target) return
    function measure() {
      const control = root?.querySelector<HTMLElement>(
        `[data-preview-target="${target}"]`
      )
      if (!control || !root || !control.getClientRects().length) {
        setPoint(null)
        return
      }
      const bounds = root.getBoundingClientRect()
      const rect = control.getBoundingClientRect()
      if (rect.top < bounds.top || rect.bottom > bounds.bottom) {
        setPoint(null)
        return
      }
      const next = {
        x: rect.left - bounds.left + rect.width * 0.65,
        y: rect.top - bounds.top + rect.height * 0.6,
        target: target ?? "",
      }
      setPoint((current) =>
        current?.x === next.x &&
        current.y === next.y &&
        current.target === next.target
          ? current
          : next
      )
    }
    const raf = requestAnimationFrame(measure)
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    root.addEventListener("scroll", measure, true)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      root.removeEventListener("scroll", measure, true)
    }
  }, [target])

  useEffect(() => {
    if (!cursor.current || !target || point?.target !== target) return
    const animation = cursor.current.animate(
      [
        { opacity: 0, transform: "translate(28px, 24px)" },
        { opacity: 1, transform: "translate(0, 0)", offset: 0.75 },
        { opacity: 1, transform: "translate(0, 0) scale(0.9)" },
      ],
      { duration: 800, easing: easing(), fill: "both" }
    )
    animation.pause()
    motion.current = animation
    return () => {
      animation.cancel()
      motion.current = null
    }
  }, [point, target])
  useEffect(() => {
    if (running) motion.current?.play()
    else motion.current?.pause()
  }, [running, point, target])

  return (
    <div
      ref={overlay}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-3xl"
    >
      {target && point?.target === target ? (
        <div
          className="absolute top-0 left-0"
          style={{ transform: `translate(${point.x}px, ${point.y}px)` }}
        >
          <div ref={cursor}>
            <svg
              width="24"
              height="28"
              viewBox="0 0 24 28"
              fill="none"
              className="drop-shadow-md"
            >
              <path
                d="M3 2L21 17L12 18L8 26L3 2Z"
                fill="white"
                stroke="#75619e"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>
      ) : null}
    </div>
  )
}
