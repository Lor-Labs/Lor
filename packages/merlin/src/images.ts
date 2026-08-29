import { logger } from "./logger"

// What the vision models accept natively.
export const VISION_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
])
// Decodable via wasm libheif and transcoded to JPEG at fetch time — the
// default iPhone photo format was silently unviewable before this. sharp is
// NOT usable here: its prebuilt binaries exclude HEVC decoding (patent
// pools), so heic-convert (libheif-js) does the work.
export const TRANSCODE_MEDIA_TYPES = new Set(["image/heic", "image/heif"])
// Inline images the initial transcript carries; everything older stays
// reachable through the view_image tool instead of a bigger cap (images run
// ~1-1.5k tokens each and cache poorly — a bigger cap is a permanent
// per-run bill).
export const MAX_IMAGES = 8
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export function isViewableImage(mediaType: string): boolean {
  return (
    VISION_MEDIA_TYPES.has(mediaType) || TRANSCODE_MEDIA_TYPES.has(mediaType)
  )
}

export type FetchedImage = { bytes: Uint8Array; mediaType: string }

// Download images because remote model providers cannot fetch private/local
// S3 URLs reliably. HEIC/HEIF come back as JPEG.
export async function fetchImageBytes(
  url: string,
  mediaType: string
): Promise<FetchedImage | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (!TRANSCODE_MEDIA_TYPES.has(mediaType)) return { bytes, mediaType }
    // Lazy import: loading the wasm decoder costs ~MBs of memory and most
    // runs never see a HEIC.
    const { default: convert } = await import("heic-convert")
    const jpeg = await convert({ buffer: bytes, format: "JPEG", quality: 0.8 })
    return { bytes: new Uint8Array(jpeg), mediaType: "image/jpeg" }
  } catch (err) {
    logger.warn({ err, url }, "Image fetch/transcode failed")
    return null
  }
}

// view_image sends its bytes at message-conversion time (toModelOutput), which
// re-runs on EVERY subsequent request of the loop — this cache is what keeps
// that from refetching the same object each step. Keyed by URL; R2 objects are
// immutable. Small LRU: entries are up to MAX_IMAGE_BYTES each.
const VIEW_CACHE_MAX = 8
const viewCache = new Map<string, FetchedImage>()

export async function fetchImageForView(
  url: string,
  mediaType: string
): Promise<FetchedImage | null> {
  const hit = viewCache.get(url)
  if (hit) {
    viewCache.delete(url)
    viewCache.set(url, hit)
    return hit
  }
  const fetched = await fetchImageBytes(url, mediaType)
  if (fetched) {
    viewCache.set(url, fetched)
    while (viewCache.size > VIEW_CACHE_MAX) {
      const oldest = viewCache.keys().next().value
      if (oldest === undefined) break
      viewCache.delete(oldest)
    }
  }
  return fetched
}
