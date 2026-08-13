import { env } from "@repo/env/client"
import {
  ALLOWED_MIME_TYPES,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from "@repo/realtime-types/uploads"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { apiClient } from "@/lib/api-client"
import type { Message } from "@/lib/api-types"

const ALLOWED_MIME_TYPES_SET = new Set<string>(ALLOWED_MIME_TYPES)

export type PendingAttachment = {
  id: string
  file: File
  filename: string
  contentType: string
  size: number
  width?: number
  height?: number
  status: "uploading" | "done" | "error"
  previewUrl?: string
  url?: string
  /** 0–100 while uploading; cleared once the upload settles. */
  progress?: number
}

async function getImageDimensions(
  file: File
): Promise<{ width: number; height: number } | null> {
  if (!file.type.startsWith("image/")) return null
  try {
    const bitmap = await createImageBitmap(file)
    const { width, height } = bitmap
    bitmap.close()
    return { width, height }
  } catch {
    return null
  }
}

const PRESIGN_TIMEOUT_MS = 20_000
const PUT_TIMEOUT_MS = 180_000
const READ_TIMEOUT_MS = 15_000
const UPLOAD_CONCURRENCY = 4

export class FileReadError extends Error {}

// Non-2xx from the storage PUT. Carries the status so the caller can log it and
// fall back to the generic "Upload failed" path.
class UploadHttpError extends Error {
  status: number
  constructor(status: number) {
    super(`upload failed with ${status}`)
    this.status = status
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new FileReadError("file read timed out")),
      ms
    )
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

function readViaFileReader(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () =>
      reject(reader.error ?? new FileReadError("file read failed"))
    reader.readAsArrayBuffer(file)
  })
}

// Dropped Files are lazy handles into browser drag plumbing; WKWebView (the
// desktop app) can stall Blob.arrayBuffer() on them forever while the same
// file reads fine through FileReader. Try both, each with a timeout, so a
// broken handle becomes a fast visible error instead of an infinite spinner.
async function readFileBytes(file: File): Promise<ArrayBuffer> {
  try {
    return await withTimeout(file.arrayBuffer(), READ_TIMEOUT_MS)
  } catch {
    try {
      return await withTimeout(readViaFileReader(file), READ_TIMEOUT_MS)
    } catch (err) {
      throw err instanceof FileReadError
        ? err
        : new FileReadError("file read failed")
    }
  }
}

// fetch() can't report upload progress — request streaming needs HTTP/2 and a
// duplex body, which the presigned PUT doesn't give us. XHR still exposes
// upload.onprogress, so it's the only way to get real byte counts here.
function putWithProgress(
  uploadUrl: string,
  body: ArrayBuffer,
  contentType: string,
  onProgress: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", uploadUrl, true)
    xhr.setRequestHeader("Content-Type", contentType)
    xhr.timeout = PUT_TIMEOUT_MS

    // Bytes sent is the only phase with real numbers, so hold at 99 until the
    // response lands — otherwise the bar sits at "finished" while storage is
    // still replying.
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total === 0) return
      onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)))
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
        return
      }
      reject(new UploadHttpError(xhr.status))
    }
    xhr.onerror = () => reject(new Error("upload network error"))
    // Mirrors the old AbortSignal.timeout so the caller's existing TimeoutError
    // branch still produces the "Upload timed out" toast.
    xhr.ontimeout = () =>
      reject(new DOMException("upload timed out", "TimeoutError"))

    xhr.send(body)
  })
}

async function uploadFile(
  channelId: string,
  attachment: PendingAttachment,
  onProgress: (percent: number) => void
): Promise<{ url: string } | null> {
  // Read the bytes BEFORE sending: streaming the handle as the fetch body
  // hangs on unreadable handles, and reading up front also guarantees the
  // signed Content-Length matches what we actually send.
  const body = await readFileBytes(attachment.file)

  const presignRes = await apiClient.v1.uploads.presign.$post(
    {
      json: {
        channelId,
        filename: attachment.filename,
        contentType: attachment.contentType,
        size: body.byteLength,
      },
    },
    { init: { signal: AbortSignal.timeout(PRESIGN_TIMEOUT_MS) } }
  )

  if (!presignRes.ok) {
    console.error(
      `attachment presign failed: ${attachment.contentType} → ${presignRes.status}`
    )
    return null
  }

  const { uploadUrl, fileUrl } = await presignRes.json()

  try {
    await putWithProgress(uploadUrl, body, attachment.contentType, onProgress)
  } catch (err) {
    if (err instanceof UploadHttpError) {
      console.error(
        `attachment upload failed: ${attachment.contentType} → ${err.status}`
      )
      return null
    }
    // Timeouts and network failures keep their own toasts upstream.
    throw err
  }

  return { url: fileUrl }
}

export function useFileUpload(channelId: string) {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  // Mirror for reads outside render: state updaters must stay pure (React
  // defers them in batched async contexts), so slot checks read this instead.
  const attachmentsRef = useRef<PendingAttachment[]>([])
  useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  const addFiles = useCallback(
    async (files: File[]) => {
      // Validate files first (before touching state)
      const maxSize = env.NEXT_PUBLIC_MAX_FILE_UPLOAD_SIZE
      const maxMB = Math.round(maxSize / 1024 / 1024)
      const validated: File[] = []
      for (const f of files) {
        if (!ALLOWED_MIME_TYPES_SET.has(f.type)) {
          toast.error("Unsupported file type", { description: f.name })
        } else if (f.size > maxSize) {
          toast.error(`File exceeds ${maxMB}MB limit`, { description: f.name })
        } else {
          validated.push(f)
        }
      }

      if (validated.length === 0) return

      // Build PendingAttachment objects for validated files
      const prepared: PendingAttachment[] = await Promise.all(
        validated.map(async (file) => {
          const dims = await getImageDimensions(file)
          const previewUrl = file.type.startsWith("image/")
            ? URL.createObjectURL(file)
            : undefined
          return {
            id: crypto.randomUUID(),
            file,
            filename: file.name,
            contentType: file.type,
            size: file.size,
            width: dims?.width,
            height: dims?.height,
            status: "uploading" as const,
            previewUrl,
            progress: 0,
          }
        })
      )

      // Check remaining slots OUTSIDE the state updater: React defers
      // updaters in batched async contexts, so a closure variable assigned
      // inside one is not readable synchronously after — that pattern
      // silently dropped every upload whose updater ran deferred.
      const remaining =
        MAX_ATTACHMENTS_PER_MESSAGE - attachmentsRef.current.length
      const accepted = prepared.slice(0, Math.max(0, remaining))
      if (prepared.length > accepted.length) {
        // The cut-off items never reach state, so nothing else revokes their
        // preview URLs.
        for (const rejected of prepared.slice(accepted.length)) {
          if (rejected.previewUrl) URL.revokeObjectURL(rejected.previewUrl)
        }
        toast.error(
          `You can only attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message`
        )
      }
      if (accepted.length === 0) return
      // Advance the mirror synchronously: a second addFiles arriving before
      // React flushes must see these slots as taken.
      attachmentsRef.current = [...attachmentsRef.current, ...accepted]
      setAttachments((prev) => [...prev, ...accepted])

      // Upload immediately, a few at a time: each upload buffers the whole
      // file in memory, so unbounded parallelism over 20×100MB would spike
      // gigabytes. A small pool keeps peak memory flat.
      const queue = [...accepted]
      const worker = async () => {
        for (
          let attachment = queue.shift();
          attachment;
          attachment = queue.shift()
        ) {
          try {
            // XHR fires progress far more often than the percentage changes;
            // gate on the rounded value so a 100MB upload costs ~100 renders
            // rather than thousands.
            let lastPercent = -1
            const result = await uploadFile(
              channelId,
              attachment,
              (percent) => {
                if (percent === lastPercent) return
                lastPercent = percent
                setAttachments((prev) =>
                  prev.map((a) =>
                    a.id === attachment.id ? { ...a, progress: percent } : a
                  )
                )
              }
            )
            if (result) {
              setAttachments((prev) =>
                prev.map((a) =>
                  a.id === attachment.id
                    ? {
                        ...a,
                        status: "done" as const,
                        url: result.url,
                        progress: undefined,
                      }
                    : a
                )
              )
            } else {
              toast.error("Upload failed", { description: attachment.filename })
              setAttachments((prev) =>
                prev.map((a) =>
                  a.id === attachment.id
                    ? { ...a, status: "error" as const, progress: undefined }
                    : a
                )
              )
            }
          } catch (err) {
            const timedOut =
              err instanceof DOMException && err.name === "TimeoutError"
            const unreadable = err instanceof FileReadError
            toast.error(
              unreadable
                ? "Couldn't read the dropped file — try the + upload button"
                : timedOut
                  ? "Upload timed out"
                  : "Upload failed",
              { description: attachment.filename }
            )
            setAttachments((prev) =>
              prev.map((a) =>
                a.id === attachment.id
                  ? { ...a, status: "error" as const, progress: undefined }
                  : a
              )
            )
          }
        }
      }
      await Promise.all(
        Array.from(
          { length: Math.min(UPLOAD_CONCURRENCY, accepted.length) },
          worker
        )
      )
    },
    [channelId]
  )

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const removed = prev.find((a) => a.id === id)
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl)
      return prev.filter((a) => a.id !== id)
    })
  }, [])

  const clearAttachments = useCallback(() => {
    setAttachments((prev) => {
      for (const a of prev) {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl)
      }
      return []
    })
  }, [])

  const getUploadedAttachments = useCallback((): NonNullable<
    Message["attachments"]
  > => {
    return attachments
      .filter(
        (a): a is PendingAttachment & { url: string } =>
          a.status === "done" && !!a.url
      )
      .map((a) => ({
        url: a.url,
        filename: a.filename,
        size: a.size,
        contentType: a.contentType,
        width: a.width,
        height: a.height,
      }))
  }, [attachments])

  const isUploading = attachments.some((a) => a.status === "uploading")
  const hasError = attachments.some((a) => a.status === "error")

  return {
    attachments,
    addFiles,
    removeAttachment,
    clearAttachments,
    getUploadedAttachments,
    isUploading,
    hasError,
  }
}
