"use client"

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { Cancel01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { cn } from "@repo/ui/lib/utils"
import type React from "react"
import { useLayoutEffect, useRef, useState } from "react"

type Size = { width: number; height: number }
type Point = { x: number; y: number }

// Backdrop left visible around the fitted image, so a click beside it closes.
const STAGE_PADDING = 48
const DRAG_THRESHOLD = 4
const CENTER: Point = { x: 0, y: 0 }
// Keyboard panning while zoomed: an arrow reveals more of the image that way.
const PAN_STEP = 60
const KEY_PAN: Record<string, Point> = {
  ArrowLeft: { x: PAN_STEP, y: 0 },
  ArrowRight: { x: -PAN_STEP, y: 0 },
  ArrowUp: { x: 0, y: PAN_STEP },
  ArrowDown: { x: 0, y: -PAN_STEP },
}

function ZoomStage({
  src,
  alt,
  vector,
}: {
  src: string
  alt: string
  vector: boolean
}) {
  const stageRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState<Size | null>(null)
  const [natural, setNatural] = useState<Size | null>(null)
  const [zoomed, setZoomed] = useState(false)
  const [offset, setOffset] = useState(CENTER)
  const [dragging, setDragging] = useState(false)
  // Only the zoom toggle animates; panning must track the pointer directly.
  const [animate, setAnimate] = useState(false)
  const drag = useRef<{
    pointerId: number
    start: Point
    origin: Point
    active: boolean
    moved: boolean
  } | null>(null)

  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () =>
      setStage({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Raster images never upscale to fit; zooming goes to actual size, or 2x
  // when the image already fits at actual size.
  const fit =
    stage && natural
      ? Math.min(
          vector ? Number.POSITIVE_INFINITY : 1,
          Math.max(1, stage.width - STAGE_PADDING * 2) / natural.width,
          Math.max(1, stage.height - STAGE_PADDING * 2) / natural.height
        )
      : 1
  const width = natural ? natural.width * fit : 0
  const height = natural ? natural.height * fit : 0
  const zoomScale = Math.max(2, 1 / fit)

  const clampOffset = (point: Point): Point => {
    if (!stage) return CENTER
    const maxX = Math.max(0, (width * zoomScale - stage.width) / 2)
    const maxY = Math.max(0, (height * zoomScale - stage.height) / 2)
    return {
      x: Math.min(maxX, Math.max(-maxX, point.x)),
      y: Math.min(maxY, Math.max(-maxY, point.y)),
    }
  }

  const shown = zoomed ? clampOffset(offset) : CENTER

  const toggleZoom = (event: React.MouseEvent<HTMLButtonElement>) => {
    // detail 0 is keyboard activation: no drag to ignore, no pointer position.
    const fromPointer = event.detail > 0
    if (fromPointer && drag.current?.moved) return
    setAnimate(true)
    if (zoomed) {
      setZoomed(false)
      setOffset(CENTER)
      return
    }
    const rect = stageRef.current?.getBoundingClientRect()
    const cursor =
      fromPointer && rect
        ? {
            x: event.clientX - rect.left - rect.width / 2,
            y: event.clientY - rect.top - rect.height / 2,
          }
        : CENTER
    // Keeps the clicked spot under the cursor after scaling.
    setOffset(
      clampOffset({
        x: cursor.x * (1 - zoomScale),
        y: cursor.y * (1 - zoomScale),
      })
    )
    setZoomed(true)
  }

  const endDrag = () => {
    if (drag.current) drag.current.active = false
    setDragging(false)
  }

  return (
    <div
      ref={stageRef}
      className="absolute inset-0 flex items-center justify-center"
    >
      <button
        type="button"
        aria-label={zoomed ? "Zoom out" : "Zoom in"}
        className={cn(
          "pointer-events-auto shrink-0 touch-none select-none rounded outline-none focus-visible:ring-2 focus-visible:ring-white/70 motion-reduce:transition-none",
          !natural && "invisible",
          animate && "transition-transform duration-200 ease-out",
          dragging
            ? "cursor-grabbing"
            : zoomed
              ? "cursor-zoom-out"
              : "cursor-zoom-in"
        )}
        style={{
          width: natural ? width : undefined,
          height: natural ? height : undefined,
          transform: `translate3d(${shown.x}px, ${shown.y}px, 0) scale(${zoomed ? zoomScale : 1})`,
        }}
        onClick={toggleZoom}
        onKeyDown={(event) => {
          const step = KEY_PAN[event.key]
          if (!zoomed || !step) return
          event.preventDefault()
          setAnimate(true)
          setOffset((previous) =>
            clampOffset({ x: previous.x + step.x, y: previous.y + step.y })
          )
        }}
        onPointerDown={(event) => {
          drag.current =
            zoomed && event.button === 0
              ? {
                  pointerId: event.pointerId,
                  start: { x: event.clientX, y: event.clientY },
                  origin: shown,
                  active: true,
                  moved: false,
                }
              : null
        }}
        onPointerMove={(event) => {
          const current = drag.current
          if (!current?.active || current.pointerId !== event.pointerId) return
          const dx = event.clientX - current.start.x
          const dy = event.clientY - current.start.y
          if (!current.moved) {
            if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
            current.moved = true
            event.currentTarget.setPointerCapture(event.pointerId)
            setAnimate(false)
            setDragging(true)
          }
          setOffset(
            clampOffset({ x: current.origin.x + dx, y: current.origin.y + dy })
          )
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={(event) => {
          // ctrlKey is a trackpad pinch, which belongs to the browser.
          if (!zoomed || event.ctrlKey) return
          setAnimate(false)
          const { deltaX, deltaY } = event
          setOffset((previous) =>
            clampOffset({ x: previous.x - deltaX, y: previous.y - deltaY })
          )
        }}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          className={cn("block rounded", natural && "size-full")}
          onLoad={(event) => {
            const img = event.currentTarget
            setNatural({
              width: Math.max(1, img.naturalWidth || img.width),
              height: Math.max(1, img.naturalHeight || img.height),
            })
          }}
        />
      </button>
    </div>
  )
}

// Full-screen image viewer: click the image to zoom in on that spot, drag or
// scroll to pan while zoomed, click again to zoom out. `vector` lets an SVG
// grow past its intrinsic size.
export function ImageLightbox({
  src,
  alt,
  open,
  onOpenChange,
  vector = false,
}: {
  src: string
  alt: string
  open: boolean
  onOpenChange: (open: boolean) => void
  vector?: boolean
}): React.ReactElement {
  const fade =
    "transition-opacity duration-200 ease-out data-ending-style:opacity-0 data-ending-style:duration-150 data-starting-style:opacity-0"
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          className={cn("fixed inset-0 z-50 bg-black/90", fade)}
        />
        {/* pointer-events-none: a click beside the image lands on the backdrop and closes. */}
        <DialogPrimitive.Popup
          aria-label={alt}
          className={cn(
            "pointer-events-none fixed inset-0 z-50 overflow-hidden outline-none",
            fade
          )}
        >
          <ZoomStage src={src} alt={alt} vector={vector} />
          <DialogPrimitive.Close
            aria-label="Close"
            className="pointer-events-auto absolute top-4 right-4 cursor-pointer rounded-md bg-black/50 p-2 text-white/70 outline-none transition-colors hover:bg-black/70 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <HugeiconsIcon
              icon={Cancel01Icon}
              className="size-5"
              strokeWidth={2}
            />
          </DialogPrimitive.Close>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
