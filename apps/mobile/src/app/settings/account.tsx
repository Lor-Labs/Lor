import { File, UploadType } from "expo-file-system"
import * as ImagePicker from "expo-image-picker"
import { Redirect, router } from "expo-router"
import { SymbolView } from "expo-symbols"
import { Description } from "heroui-native/description"
import { FieldError } from "heroui-native/field-error"
import { useThemeColor } from "heroui-native/hooks"
import { Input } from "heroui-native/input"
import { Label } from "heroui-native/label"
import { TextField } from "heroui-native/text-field"
import { useToast } from "heroui-native/toast"
import { useState } from "react"
import { Pressable, Text, View } from "react-native"
import { KeyboardAwareScrollView } from "react-native-keyboard-controller"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Screen } from "@/components/ui/screen"
import { useWorkspace } from "@/context/workspace-context"
import { api } from "@/lib/api"
import { authClient } from "@/lib/auth-client"

const MAX_NAME_LENGTH = 50
const MAX_STATUS_LENGTH = 128
const MAX_AVATAR_BYTES = 2 * 1024 * 1024
const AVATAR_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
])

type PickedAvatar = {
  uri: string
  filename: string
  contentType: string
  size: number
}

async function uploadAvatar(picked: PickedAvatar): Promise<string> {
  const presign = await api.v1.uploads.avatar.presign.$post({
    json: {
      filename: picked.filename,
      contentType: picked.contentType,
      size: picked.size,
    },
  })
  if (!presign.ok) throw new Error("Could not prepare the avatar upload")
  const { uploadUrl, fileUrl } = await presign.json()

  const file = new File(picked.uri)
  const task = file.createUploadTask(uploadUrl, {
    headers: { "Content-Type": picked.contentType },
    httpMethod: "PUT",
    mimeType: picked.contentType,
    sessionType: "foreground",
    uploadType: UploadType.BINARY_CONTENT,
  })
  const result = await task.uploadAsync()
  if (!result || result.status < 200 || result.status >= 300) {
    throw new Error("The avatar upload was rejected")
  }
  return fileUrl
}

type SessionUser = (typeof authClient.$Infer.Session)["user"]

export default function AccountSettingsScreen() {
  const { data: session, isPending } = authClient.useSession()
  if (isPending) return null
  if (!session?.user) return <Redirect href="/sign-in" />
  return <AccountForm user={session.user} />
}

function AccountForm({ user }: { user: SessionUser }) {
  const foreground = useThemeColor("foreground")
  const { avatarColor } = useWorkspace()
  const { toast } = useToast()

  const [name, setName] = useState(user.name)
  const [status, setStatus] = useState(user.status ?? "")
  const [pickedAvatar, setPickedAvatar] = useState<PickedAvatar | null>(null)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const nameValid = name.trim().length > 0
  const dirty =
    pickedAvatar !== null ||
    name.trim() !== user.name ||
    status.trim() !== (user.status ?? "")

  const canSave = dirty && nameValid && !isSaving

  const pickAvatar = async () => {
    setAvatarError(null)
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: true,
        aspect: [1, 1],
        mediaTypes: ["images"],
        quality: 0.9,
        selectionLimit: 1,
      })
      if (result.canceled) return
      const asset = result.assets[0]
      if (!asset) return

      const filename = asset.fileName ?? "avatar.jpg"
      const contentType = asset.mimeType ?? "image/jpeg"
      if (!AVATAR_MIME_TYPES.has(contentType)) {
        setAvatarError("Use a JPEG, PNG, GIF, or WebP image.")
        return
      }
      const size = asset.fileSize ?? new File(asset.uri).size ?? 0
      if (size <= 0) {
        setAvatarError("Could not read that image. Try a different one.")
        return
      }
      if (size > MAX_AVATAR_BYTES) {
        setAvatarError("Avatars can be up to 2 MB.")
        return
      }
      setPickedAvatar({ uri: asset.uri, filename, contentType, size })
    } catch {
      setAvatarError("Could not open the photo library.")
    }
  }

  const save = async () => {
    if (!canSave) return
    setIsSaving(true)
    try {
      const imageUrl = pickedAvatar ? await uploadAvatar(pickedAvatar) : null
      const { error } = await authClient.updateUser({
        name: name.trim(),
        ...(imageUrl ? { image: imageUrl } : {}),
        status: status.trim(),
      })
      if (error) {
        throw new Error(error.message ?? "Could not save your profile")
      }
      setPickedAvatar(null)
      toast.show({
        variant: "success",
        label: "Profile updated",
        description: "Your changes are live across Lor.",
      })
      router.back()
    } catch (cause) {
      toast.show({
        variant: "danger",
        label: "Profile not saved",
        description:
          cause instanceof Error
            ? cause.message
            : "Please try again in a moment.",
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Screen className="bg-background" edges={["top", "bottom"]}>
      <View className="min-h-[60px] flex-row items-center gap-two border-b border-separator px-three">
        <IconButton
          accessibilityLabel="Back"
          onPress={() => router.back()}
          variant="ghost"
        >
          <SymbolView
            name={{
              ios: "chevron.left",
              android: "arrow_back",
              web: "arrow_back",
            }}
            size={21}
            tintColor={foreground}
          />
        </IconButton>
        <Text className="flex-1 text-[17px] font-bold text-foreground">
          My Account
        </Text>
        <Button isDisabled={!canSave} onPress={() => void save()} size="sm">
          {isSaving ? "Saving…" : "Save"}
        </Button>
      </View>

      <KeyboardAwareScrollView
        bottomOffset={24}
        contentContainerClassName="gap-six px-four pb-eight pt-five"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="items-center gap-three">
          <Pressable
            accessibilityHint="Opens your photo library"
            accessibilityLabel="Change avatar"
            accessibilityRole="button"
            className="active:opacity-70"
            onPress={() => void pickAvatar()}
          >
            <Avatar
              avatarColor={avatarColor}
              image={pickedAvatar?.uri ?? user.image}
              name={user.name}
              size="lg"
            />
            <View className="absolute -bottom-one -right-one size-7 items-center justify-center rounded-full border-2 border-background bg-surface-secondary">
              <SymbolView
                name={{
                  ios: "camera.fill",
                  android: "photo_camera",
                  web: "photo_camera",
                }}
                size={13}
                tintColor={foreground}
              />
            </View>
          </Pressable>
          <Text className="text-xs text-muted">
            JPEG, PNG, GIF, or WebP · up to 2 MB
          </Text>
          {avatarError ? (
            <Text className="text-xs font-medium text-danger">
              {avatarError}
            </Text>
          ) : null}
        </View>

        <TextField isInvalid={!nameValid} isRequired>
          <Label>Display Name</Label>
          <Input
            maxLength={MAX_NAME_LENGTH}
            onChangeText={setName}
            placeholder="Your name"
            value={name}
          />
          {nameValid ? null : (
            <FieldError>Display name can’t be empty.</FieldError>
          )}
        </TextField>

        <TextField>
          <Label>Status</Label>
          <Input
            maxLength={MAX_STATUS_LENGTH}
            onChangeText={setStatus}
            placeholder="What are you up to?"
            value={status}
          />
          <Description>
            {status.length}/{MAX_STATUS_LENGTH}
          </Description>
        </TextField>

        <TextField isDisabled>
          <Label>Email</Label>
          <Input value={user.email} />
          <Description>Your email can’t be changed here yet.</Description>
        </TextField>
      </KeyboardAwareScrollView>
    </Screen>
  )
}
