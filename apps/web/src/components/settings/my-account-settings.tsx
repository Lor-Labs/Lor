import { Camera01Icon, Upload01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/avatar"
import { Button } from "@repo/ui/components/button"
import { Input } from "@repo/ui/components/input"
import { Label } from "@repo/ui/components/label"
import { Separator } from "@repo/ui/components/separator"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { getAvatarInitials } from "@repo/utils/avatar-colors"
import { useCallback, useEffect, useRef, useState } from "react"
import { apiClient } from "@/lib/api-client"

const MAX_STATUS_LENGTH = 128
const MAX_AVATAR_BYTES = 2 * 1024 * 1024
const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]

function validateAvatarFile(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return "Only JPEG, PNG, GIF, and WebP images are allowed"
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return "Avatar must be under 2 MB"
  }
  return null
}

export function MyAccountSettings() {
  const { data: session } = authClient.useSession()
  const user = session?.user

  const [name, setName] = useState("")
  const [status, setStatus] = useState("")
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCountRef = useRef(0)
  const avatarPreviewRef = useRef<string | null>(null)

  useEffect(() => {
    if (!user) return
    setName(user.name ?? "")
    setStatus((user.status as string) ?? "")
  }, [user])

  useEffect(() => {
    return () => {
      if (avatarPreviewRef.current)
        URL.revokeObjectURL(avatarPreviewRef.current)
    }
  }, [])

  const setAvatarFromFile = useCallback((file: File) => {
    const error = validateAvatarFile(file)
    if (error) {
      toast.error(error)
      return
    }
    setAvatarFile(file)
    if (avatarPreviewRef.current) URL.revokeObjectURL(avatarPreviewRef.current)
    const url = URL.createObjectURL(file)
    avatarPreviewRef.current = url
    setAvatarPreview(url)
  }, [])

  const handleAvatarSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) setAvatarFromFile(file)
    },
    [setAvatarFromFile]
  )

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCountRef.current += 1
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCountRef.current -= 1
    if (dragCountRef.current === 0) {
      setIsDragging(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCountRef.current = 0
      setIsDragging(false)

      const file = e.dataTransfer.files[0]
      if (file) setAvatarFromFile(file)
    },
    [setAvatarFromFile]
  )

  const uploadAvatar = useCallback(async (file: File): Promise<string> => {
    const res = await apiClient.v1.uploads.avatar.presign.$post({
      json: {
        filename: file.name,
        contentType: file.type,
        size: file.size,
      },
    })

    if (!res.ok) {
      throw new Error("Failed to get upload URL")
    }

    const { uploadUrl, fileUrl } = await res.json()

    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type },
    })

    if (!uploadRes.ok) {
      throw new Error("Failed to upload avatar")
    }

    return fileUrl
  }, [])

  const handleSave = useCallback(async () => {
    if (!user) return
    setIsSaving(true)
    setSaved(false)

    try {
      let imageUrl = user.image

      if (avatarFile) {
        imageUrl = await uploadAvatar(avatarFile)
      }

      await authClient.updateUser({
        name: name.trim(),
        image: imageUrl ?? undefined,
        status: status.trim() || undefined,
      })

      setAvatarFile(null)
      if (avatarPreview) {
        URL.revokeObjectURL(avatarPreview)
        avatarPreviewRef.current = null
        setAvatarPreview(null)
      }

      setSaved(true)
    } catch {
      toast.error("Failed to update profile")
    } finally {
      setIsSaving(false)
    }
  }, [user, name, status, avatarFile, avatarPreview, uploadAvatar])

  const hasChanges =
    user &&
    (name.trim() !== (user.name ?? "") ||
      status.trim() !== ((user.status as string) ?? "") ||
      avatarFile !== null)

  const isValid = name.trim().length > 0

  if (!user) return null

  const displayAvatar = avatarPreview ?? user.image
  const initials = getAvatarInitials(user.name)

  return (
    <div className="space-y-6">
      <div
        className={cn(
          "flex items-center gap-4 rounded-lg border-2 border-dashed p-4 transition-colors",
          isDragging ? "border-primary bg-primary/5" : "border-transparent"
        )}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <button
          type="button"
          className="group relative shrink-0"
          onClick={() => fileInputRef.current?.click()}
        >
          <Avatar className="size-20">
            {displayAvatar && (
              <AvatarImage src={displayAvatar} alt={user.name} />
            )}
            <AvatarFallback
              className="text-lg font-semibold"
              fallbackSeed={user.name}
            >
              {initials ?? "?"}
            </AvatarFallback>
          </Avatar>
          <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
            <HugeiconsIcon
              icon={Camera01Icon}
              className="size-5 text-white"
              strokeWidth={2}
            />
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="hidden"
            onChange={handleAvatarSelect}
          />
        </button>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{user.name}</p>
          <div className="mt-2 flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              Change avatar
            </Button>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <HugeiconsIcon
                icon={Upload01Icon}
                className="size-3"
                strokeWidth={2}
              />
              or drag & drop
            </span>
          </div>
        </div>
      </div>

      <Separator />

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="display-name">Display Name</Label>
          <Input
            id="display-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={50}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" value={user.email} disabled />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="status">Status</Label>
            <span className="text-xs text-muted-foreground">
              {status.length}/{MAX_STATUS_LENGTH}
            </span>
          </div>
          <Input
            id="status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            placeholder="What are you up to?"
            maxLength={MAX_STATUS_LENGTH}
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={!hasChanges || !isValid}
          loading={isSaving}
          success={saved}
        >
          Save Changes
        </Button>
      </div>
    </div>
  )
}
