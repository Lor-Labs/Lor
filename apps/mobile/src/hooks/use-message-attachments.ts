import {
  ALLOWED_MIME_TYPES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  presignedUploadHeaders,
} from "@repo/realtime-types/uploads"
import * as DocumentPicker from "expo-document-picker"
import { File, type UploadTask, UploadType } from "expo-file-system"
import { ImageManipulator, SaveFormat } from "expo-image-manipulator"
import * as ImagePicker from "expo-image-picker"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Alert, Linking, Platform } from "react-native"
import { api, responseMessage } from "@/lib/api"
import type { Message } from "@/lib/api-types"

const DEFAULT_MAX_FILE_SIZE = 20 * 1024 * 1024
const ALLOWED_MIME_TYPES_SET = new Set<string>(ALLOWED_MIME_TYPES)

export type LocalAttachmentAsset = {
  uri: string
  sourceUri?: string
  filename: string
  contentType: string
  size: number
  width?: number
  height?: number
}

export type PendingMessageAttachment = LocalAttachmentAsset & {
  id: string
  status: "uploading" | "done" | "error"
  progress: number
  url?: string
  error?: string
}

function attachmentId() {
  return `attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function fileNameFromUri(uri: string, fallback: string) {
  const path = uri.split("?")[0]
  const encodedName = path?.split("/").at(-1)
  if (!encodedName) return fallback
  try {
    return decodeURIComponent(encodedName)
  } catch {
    return encodedName
  }
}

function mimeTypeFromName(filename: string) {
  const extension = filename.split(".").at(-1)?.toLowerCase()
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg"
    case "png":
      return "image/png"
    case "gif":
      return "image/gif"
    case "webp":
      return "image/webp"
    case "pdf":
      return "application/pdf"
    case "txt":
      return "text/plain"
    case "md":
      return "text/markdown"
    case "csv":
      return "text/csv"
    case "json":
      return "application/json"
    case "zip":
      return "application/zip"
    case "mp4":
      return "video/mp4"
    case "mov":
      return "video/quicktime"
    case "webm":
      return "video/webm"
    case "mp3":
      return "audio/mpeg"
    case "wav":
      return "audio/wav"
    default:
      return "application/octet-stream"
  }
}

function mediaAssetToLocalAsset(
  asset: ImagePicker.ImagePickerAsset
): LocalAttachmentAsset {
  const videoExtension =
    asset.mimeType === "video/mp4"
      ? "mp4"
      : asset.mimeType === "video/quicktime"
        ? "mov"
        : asset.mimeType === "video/webm"
          ? "webm"
          : asset.type === "video"
            ? "mp4"
            : null
  const fallbackName = videoExtension
    ? `video-${Date.now()}.${videoExtension}`
    : `photo-${Date.now()}.jpg`
  const filename = asset.fileName ?? fileNameFromUri(asset.uri, fallbackName)
  const file = new File(asset.uri)
  return {
    uri: asset.uri,
    filename,
    contentType: asset.mimeType ?? mimeTypeFromName(filename),
    size: asset.fileSize ?? file.size ?? 0,
    width: asset.width || undefined,
    height: asset.height || undefined,
  }
}

const DIRECT_UPLOAD_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
])

async function photoAssetToLocalAsset(asset: {
  uri: string
  filename: string
  width?: number
  height?: number
}): Promise<LocalAttachmentAsset> {
  const contentType = mimeTypeFromName(asset.filename)
  if (DIRECT_UPLOAD_IMAGE_TYPES.has(contentType)) {
    const file = new File(asset.uri)
    return { ...asset, sourceUri: asset.uri, contentType, size: file.size ?? 0 }
  }

  const image = await ImageManipulator.manipulate(asset.uri).renderAsync()
  const result = await image.saveAsync({
    compress: 0.9,
    format: SaveFormat.JPEG,
  })
  const file = new File(result.uri)
  return {
    uri: result.uri,
    sourceUri: asset.uri,
    filename: `${asset.filename.replace(/\.[^.]+$/, "")}.jpg`,
    contentType: "image/jpeg",
    size: file.size ?? 0,
    width: result.width || undefined,
    height: result.height || undefined,
  }
}

function documentAssetToLocalAsset(
  asset: DocumentPicker.DocumentPickerAsset
): LocalAttachmentAsset {
  const file = new File(asset.uri)
  return {
    uri: asset.uri,
    filename: asset.name,
    contentType: asset.mimeType ?? mimeTypeFromName(asset.name),
    size: asset.size ?? file.size ?? 0,
  }
}

export function useMessageAttachments(channelId: string) {
  const [attachments, setAttachments] = useState<PendingMessageAttachment[]>([])
  const [error, setError] = useState<string | null>(null)
  const attachmentsRef = useRef<PendingMessageAttachment[]>([])
  const tasksRef = useRef(new Map<string, UploadTask>())

  const updateAttachments = useCallback(
    (
      update: (
        current: PendingMessageAttachment[]
      ) => PendingMessageAttachment[]
    ) => {
      const next = update(attachmentsRef.current)
      attachmentsRef.current = next
      setAttachments(next)
    },
    []
  )

  const cancelAll = useCallback(() => {
    for (const task of tasksRef.current.values()) task.cancel()
    tasksRef.current.clear()
  }, [])

  useEffect(() => {
    return cancelAll
  }, [cancelAll])

  useEffect(() => {
    cancelAll()
    attachmentsRef.current = []
    setAttachments([])
    setError(null)
  }, [cancelAll, channelId])

  const uploadAttachment = useCallback(
    async (attachment: PendingMessageAttachment) => {
      let uploadTask: UploadTask | null = null
      try {
        const response = await api.v1.uploads.presign.$post({
          json: {
            channelId,
            filename: attachment.filename,
            contentType: attachment.contentType,
            size: attachment.size,
          },
        })
        if (!response.ok) {
          throw new Error(
            await responseMessage(response, "Could not prepare this upload")
          )
        }

        const { uploadUrl, fileUrl } = await response.json()
        const file = new File(attachment.uri)
        const task = file.createUploadTask(uploadUrl, {
          headers: presignedUploadHeaders(attachment.contentType),
          httpMethod: "PUT",
          mimeType: attachment.contentType,
          onProgress: ({ bytesSent, totalBytes }) => {
            const progress = totalBytes > 0 ? bytesSent / totalBytes : 0
            updateAttachments((current) =>
              current.map((item) =>
                item.id === attachment.id
                  ? { ...item, progress: Math.min(1, progress) }
                  : item
              )
            )
          },
          sessionType: "foreground",
          uploadType: UploadType.BINARY_CONTENT,
        })
        uploadTask = task
        tasksRef.current.set(attachment.id, task)
        const result = await task.uploadAsync()
        if (result.status < 200 || result.status >= 300) {
          throw new Error("The file upload was rejected")
        }
        if (tasksRef.current.get(attachment.id) !== task) return
        updateAttachments((current) =>
          current.map((item) =>
            item.id === attachment.id
              ? {
                  ...item,
                  error: undefined,
                  progress: 1,
                  status: "done",
                  url: fileUrl,
                }
              : item
          )
        )
      } catch (cause) {
        if (!attachmentsRef.current.some((item) => item.id === attachment.id)) {
          return
        }
        updateAttachments((current) =>
          current.map((item) =>
            item.id === attachment.id
              ? {
                  ...item,
                  error:
                    cause instanceof Error
                      ? cause.message
                      : "Could not upload this file",
                  status: "error",
                }
              : item
          )
        )
      } finally {
        uploadTask?.release()
        if (tasksRef.current.get(attachment.id) === uploadTask) {
          tasksRef.current.delete(attachment.id)
        }
      }
    },
    [channelId, updateAttachments]
  )

  const addAssets = useCallback(
    (assets: LocalAttachmentAsset[]) => {
      setError(null)
      const valid: LocalAttachmentAsset[] = []
      for (const asset of assets) {
        if (!ALLOWED_MIME_TYPES_SET.has(asset.contentType)) {
          setError(`${asset.filename} is not a supported file type.`)
        } else if (asset.size <= 0) {
          setError(`${asset.filename} could not be read.`)
        } else if (asset.size > DEFAULT_MAX_FILE_SIZE) {
          setError(`${asset.filename} exceeds the 20 MB upload limit.`)
        } else if (asset.filename.length > 256) {
          setError("Attachment filenames must be 256 characters or fewer.")
        } else {
          valid.push(asset)
        }
      }

      const remaining =
        MAX_ATTACHMENTS_PER_MESSAGE - attachmentsRef.current.length
      const accepted = valid.slice(0, Math.max(0, remaining)).map((asset) => ({
        ...asset,
        id: attachmentId(),
        progress: 0,
        status: "uploading" as const,
      }))
      if (valid.length > remaining) {
        setError(
          `You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files to a message.`
        )
      }
      if (accepted.length === 0) return

      updateAttachments((current) => [...current, ...accepted])
      for (const attachment of accepted) void uploadAttachment(attachment)
    },
    [updateAttachments, uploadAttachment]
  )

  const addPhotoAssets = useCallback(
    async (
      assets: Array<{
        uri: string
        filename: string
        width?: number
        height?: number
      }>
    ) => {
      try {
        addAssets(await Promise.all(assets.map(photoAssetToLocalAsset)))
      } catch {
        setError("This photo could not be read.")
      }
    },
    [addAssets]
  )

  const pickMedia = useCallback(async () => {
    if (attachmentsRef.current.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
      setError(
        `You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files to a message.`
      )
      return
    }
    try {
      if (Platform.OS === "ios") {
        const permission =
          await ImagePicker.requestMediaLibraryPermissionsAsync()
        if (!permission.granted) {
          setError("Camera roll access is needed to choose media.")
          return
        }
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsMultipleSelection: true,
        mediaTypes: ["images", "videos"],
        orderedSelection: true,
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
        quality: 0.9,
        selectionLimit:
          MAX_ATTACHMENTS_PER_MESSAGE - attachmentsRef.current.length,
        shouldDownloadFromNetwork: true,
      })
      if (!result.canceled) addAssets(result.assets.map(mediaAssetToLocalAsset))
    } catch {
      setError("Could not open the photo and video library.")
    }
  }, [addAssets])

  const takeMedia = useCallback(async () => {
    if (attachmentsRef.current.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
      setError(
        `You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files to a message.`
      )
      return
    }
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync()
      if (!permission.granted) {
        setError("Camera access is needed to take a photo or video.")
        if (!permission.canAskAgain) {
          Alert.alert(
            "Camera access is off",
            "Enable camera access in Settings to take a photo or video.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Open Settings",
                onPress: () => void Linking.openSettings(),
              },
            ]
          )
        }
        return
      }
      const result = await ImagePicker.launchCameraAsync({
        cameraType: ImagePicker.CameraType.back,
        mediaTypes: ["images", "videos"],
        quality: 0.9,
      })
      if (!result.canceled) addAssets(result.assets.map(mediaAssetToLocalAsset))
    } catch {
      setError("Could not open the camera.")
    }
  }, [addAssets])

  const pickFiles = useCallback(async () => {
    if (attachmentsRef.current.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
      setError(
        `You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files to a message.`
      )
      return
    }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: true,
        type: [...ALLOWED_MIME_TYPES],
      })
      if (!result.canceled) {
        addAssets(result.assets.map(documentAssetToLocalAsset))
      }
    } catch {
      setError("Could not open the file picker.")
    }
  }, [addAssets])

  const removeAttachment = useCallback(
    (id: string) => {
      tasksRef.current.get(id)?.cancel()
      tasksRef.current.delete(id)
      updateAttachments((current) =>
        current.filter((attachment) => attachment.id !== id)
      )
    },
    [updateAttachments]
  )

  const retryAttachment = useCallback(
    (id: string) => {
      const attachment = attachmentsRef.current.find((item) => item.id === id)
      if (!attachment || attachment.status !== "error") return
      const retrying = {
        ...attachment,
        error: undefined,
        progress: 0,
        status: "uploading" as const,
      }
      setError(null)
      updateAttachments((current) =>
        current.map((item) => (item.id === id ? retrying : item))
      )
      void uploadAttachment(retrying)
    },
    [updateAttachments, uploadAttachment]
  )

  const clearAttachments = useCallback(() => {
    cancelAll()
    attachmentsRef.current = []
    setAttachments([])
    setError(null)
  }, [cancelAll])

  const uploadedAttachments = useMemo<NonNullable<Message["attachments"]>>(
    () =>
      attachments.flatMap((attachment) =>
        attachment.status === "done" && attachment.url
          ? [
              {
                url: attachment.url,
                filename: attachment.filename,
                size: attachment.size,
                contentType: attachment.contentType,
                width: attachment.width,
                height: attachment.height,
              },
            ]
          : []
      ),
    [attachments]
  )

  return {
    addPhotoAssets,
    attachments,
    clearAttachments,
    error,
    hasError: attachments.some((attachment) => attachment.status === "error"),
    isUploading: attachments.some(
      (attachment) => attachment.status === "uploading"
    ),
    pickFiles,
    pickMedia,
    removeAttachment,
    retryAttachment,
    takeMedia,
    uploadedAttachments,
  }
}
