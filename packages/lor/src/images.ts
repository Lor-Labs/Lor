import { Worker } from "node:worker_threads"
import { readAttachmentBytes } from "./attachments/storage"
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
export const MAX_IMAGE_PIXELS = 50_000_000

const HEIF_CONTAINER_BOXES = new Map([
  ["meta", 4],
  ["iprp", 0],
  ["ipco", 0],
])
const MAX_HEIF_BOX_DEPTH = 4

function boxType(bytes: Uint8Array, offset: number): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  )
}

function readUint64(view: DataView, offset: number): number | null {
  const value = view.getBigUint64(offset)
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null
}

export function readHeifDimensions(
  bytes: Uint8Array
): Array<{ width: number; height: number }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const dimensions: Array<{ width: number; height: number }> = []

  const visit = (start: number, end: number, depth: number): void => {
    if (depth > MAX_HEIF_BOX_DEPTH) return

    let offset = start
    while (offset + 8 <= end) {
      let size = view.getUint32(offset)
      const type = boxType(bytes, offset + 4)
      let headerSize = 8

      if (size === 1) {
        if (offset + 16 > end) return
        const extendedSize = readUint64(view, offset + 8)
        if (extendedSize === null) return
        size = extendedSize
        headerSize = 16
      } else if (size === 0) {
        size = end - offset
      }

      if (size < headerSize || offset + size > end) return
      const payloadStart = offset + headerSize
      const boxEnd = offset + size

      if (type === "ispe" && payloadStart + 12 <= boxEnd) {
        const width = view.getUint32(payloadStart + 4)
        const height = view.getUint32(payloadStart + 8)
        if (width > 0 && height > 0) dimensions.push({ width, height })
      }

      const childPrefix = HEIF_CONTAINER_BOXES.get(type)
      if (childPrefix !== undefined && payloadStart + childPrefix <= boxEnd) {
        visit(payloadStart + childPrefix, boxEnd, depth + 1)
      }

      offset = boxEnd
    }
  }

  visit(0, bytes.byteLength, 0)
  return dimensions
}

export function heifExceedsPixelLimit(bytes: Uint8Array): boolean {
  return readHeifDimensions(bytes).some(
    ({ width, height }) => width > Math.floor(MAX_IMAGE_PIXELS / height)
  )
}

export function assertJpegOutputSize(bytes: Uint8Array): void {
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("Converted JPEG exceeds the image byte limit")
  }
}

function convertHeifInWorker(bytes: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./image-conversion-worker.ts", import.meta.url),
      { resourceLimits: { maxOldGenerationSizeMb: 256 } }
    )
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      void worker.terminate()
      reject(new Error("Image conversion timed out"))
    }, 30_000)

    const finish = (result: { bytes?: unknown; error?: unknown }): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      void worker.terminate()

      if (typeof result.error === "string") {
        reject(new Error(result.error))
        return
      }
      if (!(result.bytes instanceof Uint8Array)) {
        reject(new Error("Image conversion worker returned invalid output"))
        return
      }

      try {
        assertJpegOutputSize(result.bytes)
        resolve(result.bytes)
      } catch (error) {
        reject(error)
      }
    }

    worker.once("message", finish)
    worker.once("error", (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    })
    worker.once("exit", (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(new Error(`Image conversion worker exited with code ${code}`))
    })
    const transferList: ArrayBuffer[] = []
    if (bytes.buffer instanceof ArrayBuffer) transferList.push(bytes.buffer)
    worker.postMessage({ bytes, maxOutputBytes: MAX_IMAGE_BYTES }, transferList)
  })
}

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
    const bytes = await readAttachmentBytes(url)
    if (!TRANSCODE_MEDIA_TYPES.has(mediaType)) return { bytes, mediaType }
    if (heifExceedsPixelLimit(bytes)) {
      throw new Error("HEIF image exceeds the pixel limit")
    }
    const jpeg = await convertHeifInWorker(bytes)
    return { bytes: jpeg, mediaType: "image/jpeg" }
  } catch (err) {
    logger.warn({ err, url }, "Image fetch/transcode failed")
    return null
  }
}

// view_image sends its bytes at message-conversion time (toModelOutput), which
// re-runs on EVERY subsequent request of the loop — this cache is what keeps
// that from refetching the same object each step. Keyed by URL; R2 objects are
// immutable. Small LRU: transcoded entries are capped at MAX_IMAGE_BYTES.
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
