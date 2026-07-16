import {
  AssetField,
  addListener,
  getPermissionsAsync,
  MediaType,
  type PermissionResponse,
  Query,
  requestPermissionsAsync,
} from "expo-media-library"
import { useCallback, useEffect, useRef, useState } from "react"

const RECENT_PHOTO_LIMIT = 24

export type RecentPhoto = {
  id: string
  uri: string
  filename: string
  width?: number
  height?: number
}

type PhotoPermission = "loading" | "granted" | "limited" | "denied"

function permissionState(permission: PermissionResponse): PhotoPermission {
  if (!permission.granted) return "denied"
  return permission.accessPrivileges === "limited" ? "limited" : "granted"
}

async function fetchRecentPhotos() {
  const assets = await new Query()
    .eq(AssetField.MEDIA_TYPE, MediaType.IMAGE)
    .orderBy({ key: AssetField.CREATION_TIME, ascending: false })
    .limit(RECENT_PHOTO_LIMIT)
    .exe()

  return await Promise.all(
    assets.map(async (asset): Promise<RecentPhoto> => {
      const info = await asset.getInfo()
      return {
        id: info.id,
        uri: info.uri,
        filename: info.filename,
        width: info.width || undefined,
        height: info.height || undefined,
      }
    })
  )
}

export function useRecentPhotos() {
  const loadIdRef = useRef(0)
  const [photos, setPhotos] = useState<RecentPhoto[]>([])
  const [permission, setPermission] = useState<PhotoPermission>("loading")
  const [canAskAgain, setCanAskAgain] = useState(true)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (shouldRequestPermission: boolean) => {
    const loadId = ++loadIdRef.current
    setIsLoading(true)
    setError(null)

    try {
      let nextPermission = await getPermissionsAsync(false, ["photo"])
      if (!nextPermission.granted && shouldRequestPermission) {
        nextPermission = await requestPermissionsAsync(false, ["photo"])
      }

      const nextPermissionState = permissionState(nextPermission)
      if (loadId !== loadIdRef.current) return
      setCanAskAgain(nextPermission.canAskAgain)
      setPermission(nextPermissionState)

      if (nextPermissionState === "denied") {
        setPhotos([])
        return
      }

      const nextPhotos = await fetchRecentPhotos()
      if (loadId !== loadIdRef.current) return
      setPhotos(nextPhotos)
    } catch {
      if (loadId !== loadIdRef.current) return
      setError("Recent photos could not be loaded.")
    } finally {
      if (loadId === loadIdRef.current) setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(true)
    const subscription = addListener(() => void load(false))
    return () => {
      loadIdRef.current += 1
      subscription.remove()
    }
  }, [load])

  return {
    canAskAgain,
    error,
    isLoading,
    permission,
    photos,
    reload: () => load(false),
    requestPermission: () => load(true),
  }
}
