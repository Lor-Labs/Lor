import { PutObjectCommand } from "@aws-sdk/client-s3"
import { env } from "@repo/env/server"
import { logger } from "@/lib/logger"
import { s3Client } from "@/lib/s3"

const ICON_FETCH_TIMEOUT_MS = 4_000
const ICON_MAX_BYTES = 512 * 1024
// Google's favicon service never upscales: a site with only a 16px icon
// returns 16px, and an unknown site returns 404 with a generic globe.
const ICON_REQUEST_SIZE = 128
const ICON_MIN_SIZE = 64

type SiteIcon = {
  body: Uint8Array
  contentType: "image/png" | "image/jpeg"
}

// Workspace icon from the company website: the same Google favicon the
// onboarding Website field shows, kept only when it is sharp enough.
export async function fetchSiteIcon(domain: string): Promise<SiteIcon | null> {
  try {
    const res = await fetch(
      `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${ICON_REQUEST_SIZE}`,
      { signal: AbortSignal.timeout(ICON_FETCH_TIMEOUT_MS) }
    )
    if (!res.ok) return null
    const body = new Uint8Array(await res.arrayBuffer())
    if (body.byteLength > ICON_MAX_BYTES) return null
    const image = readImageSize(body)
    if (!image || Math.min(image.width, image.height) < ICON_MIN_SIZE) {
      return null
    }
    return { body, contentType: image.contentType }
  } catch (err) {
    logger.warn({ err, domain }, "Site icon fetch failed")
    return null
  }
}

export async function storeWorkspaceIcon(
  workspaceId: string,
  icon: SiteIcon
): Promise<string | null> {
  const extension = icon.contentType === "image/png" ? "png" : "jpg"
  const key = `workspace-icons/${workspaceId}/${crypto.randomUUID()}/site-icon.${extension}`
  try {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET_NAME,
        Key: key,
        Body: icon.body,
        ContentType: icon.contentType,
      })
    )
    return `${env.S3_PUBLIC_URL.replace(/\/$/, "")}/${key}`
  } catch (err) {
    logger.warn({ err, workspaceId }, "Workspace icon upload failed")
    return null
  }
}

// Google serves favicons as PNG or JPEG. PNG keeps the size in its IHDR
// chunk; JPEG keeps it in the first start-of-frame segment.
function readImageSize(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.byteLength >= 24 && view.getUint32(0) === 0x89504e47) {
    return {
      contentType: "image/png" as const,
      width: view.getUint32(16),
      height: view.getUint32(20),
    }
  }
  if (bytes.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null
  let offset = 2
  while (offset + 9 <= bytes.byteLength) {
    if (view.getUint8(offset) !== 0xff) return null
    const marker = view.getUint8(offset + 1)
    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    if (isStartOfFrame) {
      return {
        contentType: "image/jpeg" as const,
        height: view.getUint16(offset + 5),
        width: view.getUint16(offset + 7),
      }
    }
    offset += 2 + view.getUint16(offset + 2)
  }
  return null
}
