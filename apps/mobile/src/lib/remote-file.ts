import { File, Paths } from "expo-file-system"
import * as Sharing from "expo-sharing"
import { Platform, Share } from "react-native"

type RemoteFile = { url: string; filename: string; contentType: string }

function safeFilename(filename: string) {
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "_")
  return sanitized || "file"
}

export function downloadToCache(file: RemoteFile) {
  const destination = new File(
    Paths.cache,
    `lor-${Date.now()}-${safeFilename(file.filename)}`
  )
  return File.downloadFileAsync(file.url, destination)
}

export function deleteCachedFile(file: File | null) {
  if (!file?.exists) return

  try {
    file.delete()
  } catch {
    // Cache cleanup should never block the action that used the file.
  }
}

// Downloads to the cache and opens the system share sheet with the file
// itself, not its link. Throws when the download or the sheet fails.
export async function shareRemoteFile(file: RemoteFile) {
  let downloaded: File | null = null
  try {
    downloaded = await downloadToCache(file)
    if (Platform.OS === "ios") {
      await Share.share({ title: file.filename, url: downloaded.uri })
    } else {
      await Sharing.shareAsync(downloaded.uri, {
        dialogTitle: file.filename,
        mimeType: file.contentType,
      })
    }
  } finally {
    deleteCachedFile(downloaded)
  }
}
