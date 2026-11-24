import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import {
  ImageLightbox,
  type LightboxImage,
} from "@repo/ui/components/image-lightbox"
import { Spinner } from "@repo/ui/components/spinner"
import { Tabs, TabsList, TabsPanel, TabsTab } from "@repo/ui/components/tabs"
import { type ReactNode, useRef, useState } from "react"

export type ImageGallery = {
  images: LightboxImage[]
  onSelect: (index: number) => void
}

function ImageCanvas({
  url,
  path,
  gallery,
}: {
  url: string
  path: string
  gallery?: ImageGallery
}) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const touch = useRef<{ x: number; y: number } | null>(null)
  const swiped = useRef(false)
  const index = gallery?.images.findIndex((image) => image.src === url) ?? -1
  const hasMultiple = index >= 0 && (gallery?.images.length ?? 0) > 1
  return (
    <div className="space-y-3">
      {hasMultiple && gallery && (
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous image"
            disabled={index === 0}
            onClick={() => gallery.onSelect(index - 1)}
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} />
          </Button>
          <span
            aria-live="polite"
            className="text-muted-foreground text-xs tabular-nums"
          >
            {index + 1} of {gallery.images.length}
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next image"
            disabled={index === gallery.images.length - 1}
            onClick={() => gallery.onSelect(index + 1)}
          >
            <HugeiconsIcon icon={ArrowRight01Icon} />
          </Button>
        </div>
      )}
      <div className="relative flex min-h-40 items-center justify-center overflow-auto rounded-lg border border-border/70 bg-muted/30 p-4">
        {failed ? (
          <p role="alert" className="text-muted-foreground text-sm">
            Couldn't preview this image.
          </p>
        ) : (
          <>
            {!loaded && (
              <Spinner aria-label="Loading image" className="absolute size-5" />
            )}
            <button
              type="button"
              aria-label="View full screen"
              title="View full screen"
              disabled={!loaded}
              className="flex min-w-0 max-w-full touch-pan-y cursor-zoom-in rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
              onPointerDown={(event) => {
                swiped.current = false
                touch.current =
                  event.pointerType === "touch"
                    ? { x: event.clientX, y: event.clientY }
                    : null
              }}
              onPointerCancel={() => {
                touch.current = null
              }}
              onPointerUp={(event) => {
                const start = touch.current
                touch.current = null
                if (!start || !hasMultiple || !gallery) return
                const dx = event.clientX - start.x
                const dy = event.clientY - start.y
                if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return
                swiped.current = true
                gallery.onSelect(
                  Math.max(
                    0,
                    Math.min(
                      gallery.images.length - 1,
                      index + (dx < 0 ? 1 : -1)
                    )
                  )
                )
              }}
              onClick={(event) => {
                if (event.detail > 0 && swiped.current) return
                setExpanded(true)
              }}
            >
              <img
                src={url}
                alt={path}
                className="max-h-[70vh] max-w-full object-contain"
                onLoad={() => setLoaded(true)}
                onError={() => setFailed(true)}
              />
            </button>
            <ImageLightbox
              src={url}
              alt={path}
              open={expanded}
              onOpenChange={setExpanded}
              vector={path.toLowerCase().endsWith(".svg")}
              images={gallery?.images}
            />
          </>
        )}
      </div>
    </div>
  )
}

export function ImagePreview({
  url,
  path,
  source,
  gallery,
}: {
  url: string
  path: string
  source?: ReactNode
  gallery?: ImageGallery
}) {
  const preview = (
    <ImageCanvas key={url} url={url} path={path} gallery={gallery} />
  )
  if (source === undefined) return preview
  return (
    <Tabs key={path} defaultValue="preview" className="min-w-0 gap-3">
      <TabsList aria-label="Image view">
        <TabsTab value="preview">Preview</TabsTab>
        <TabsTab value="source">Source</TabsTab>
      </TabsList>
      <TabsPanel value="preview">{preview}</TabsPanel>
      <TabsPanel value="source">{source}</TabsPanel>
    </Tabs>
  )
}
