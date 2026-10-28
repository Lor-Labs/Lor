import { useQueryClient } from "@tanstack/react-query"
import { File, UploadType } from "expo-file-system"
import * as ImagePicker from "expo-image-picker"
import { router } from "expo-router"
import { SymbolView } from "expo-symbols"
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
import { StatePanel } from "@/components/ui/state-panel"
import { useWorkspace, type Workspace } from "@/context/workspace-context"
import { useBetaEntitlements } from "@/hooks/use-beta"
import { api } from "@/lib/api"
import { confirmDiscard } from "@/lib/confirm-discard"

const MAX_NAME_LENGTH = 100
const MAX_ICON_BYTES = 2 * 1024 * 1024
const UPLOAD_TIMEOUT_MS = 30_000
const ICON_EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/svg+xml": "svg",
}

type PickedIcon = {
  uri: string
  filename: string
  contentType: string
  size: number
}

async function uploadIcon(
  workspaceId: string,
  picked: PickedIcon
): Promise<string> {
  const presign = await api.v1.uploads["workspace-icon"].presign.$post({
    json: {
      workspaceId,
      filename: picked.filename,
      contentType: picked.contentType,
      size: picked.size,
    },
  })
  if (!presign.ok) throw new Error("Could not prepare the icon upload")
  const { uploadUrl, fileUrl } = await presign.json()

  const file = new File(picked.uri)
  const task = file.createUploadTask(uploadUrl, {
    headers: { "Content-Type": picked.contentType },
    httpMethod: "PUT",
    mimeType: picked.contentType,
    sessionType: "foreground",
    uploadType: UploadType.BINARY_CONTENT,
  })
  const timeout = setTimeout(() => task.cancel(), UPLOAD_TIMEOUT_MS)
  try {
    const result = await task.uploadAsync()
    if (!result || result.status < 200 || result.status >= 300) {
      throw new Error("The icon upload was rejected")
    }
  } finally {
    clearTimeout(timeout)
  }
  return fileUrl
}

export default function WorkspaceSettingsScreen() {
  const { workspace, reloadWorkspaces } = useWorkspace()

  if (!workspace) {
    return (
      <Screen className="bg-background" edges={["top", "bottom"]}>
        <StatePanel
          action={{ label: "Go back", onPress: () => router.back() }}
          className="flex-1"
          detail="Open a workspace and try again."
          status="danger"
          title="No workspace selected"
        />
      </Screen>
    )
  }

  return (
    <WorkspaceSettingsForm
      key={workspace.id}
      reloadWorkspaces={reloadWorkspaces}
      workspace={workspace}
    />
  )
}

function WorkspaceSettingsForm({
  reloadWorkspaces,
  workspace,
}: {
  reloadWorkspaces: (activateWorkspaceId?: string) => Promise<void>
  workspace: Workspace
}) {
  const { data: beta } = useBetaEntitlements(workspace.slug)
  const foreground = useThemeColor("foreground")
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [name, setName] = useState(workspace.name)
  const [pickedIcon, setPickedIcon] = useState<PickedIcon | null>(null)
  const [iconError, setIconError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const nameValid = name.trim().length > 0
  const dirty = pickedIcon !== null || name.trim() !== workspace.name
  const canSave =
    dirty &&
    nameValid &&
    !isSaving &&
    (!beta?.enabled || beta.state === "active")

  const goBack = () => {
    if (isSaving) return
    if (dirty) confirmDiscard(() => router.back())
    else router.back()
  }

  const pickIcon = async () => {
    if (isSaving) return
    setIconError(null)
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

      const contentType = asset.mimeType ?? "image/jpeg"
      const extension = ICON_EXTENSION_BY_MIME[contentType]
      if (!extension) {
        setIconError("Use a JPEG, PNG, WebP, or SVG image.")
        return
      }
      const filename = asset.fileName ?? `icon.${extension}`
      const size = asset.fileSize ?? new File(asset.uri).size ?? 0
      if (size <= 0) {
        setIconError("Could not read that image. Try a different one.")
        return
      }
      if (size > MAX_ICON_BYTES) {
        setIconError("Icons can be up to 2 MB.")
        return
      }
      setPickedIcon({ uri: asset.uri, filename, contentType, size })
    } catch {
      setIconError("Could not open the photo library.")
    }
  }

  const save = async () => {
    if (!canSave) return
    setIsSaving(true)
    try {
      const logoUrl = pickedIcon
        ? await uploadIcon(workspace.id, pickedIcon)
        : null
      const response = await api.v1.workspaces[":workspaceSlug"].$patch({
        param: { workspaceSlug: workspace.slug },
        json: {
          ...(name.trim() !== workspace.name ? { name: name.trim() } : {}),
          ...(logoUrl ? { logo: logoUrl } : {}),
        },
      })
      if (!response.ok) throw new Error("Could not update the workspace")

      setPickedIcon(null)
      await reloadWorkspaces(workspace.id)
      await queryClient.invalidateQueries({
        queryKey: ["workspace-members", workspace.slug],
      })
      toast.show({ variant: "success", label: "Workspace updated" })
      router.back()
    } catch (cause) {
      toast.show({
        variant: "danger",
        label: "Workspace not saved",
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
          isDisabled={isSaving}
          onPress={goBack}
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
          Workspace Settings
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
            accessibilityLabel="Change workspace icon"
            accessibilityRole="button"
            className="active:opacity-70"
            disabled={isSaving}
            onPress={() => void pickIcon()}
          >
            <Avatar
              image={pickedIcon?.uri ?? workspace.logo}
              name={workspace.name}
              shape="square"
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
            JPEG, PNG, WebP, or SVG · up to 2 MB
          </Text>
          {iconError ? (
            <Text
              accessibilityLiveRegion="polite"
              accessibilityRole="alert"
              className="text-xs font-medium text-danger"
            >
              {iconError}
            </Text>
          ) : null}
        </View>

        <TextField isInvalid={!nameValid} isRequired>
          <Label>Workspace Name</Label>
          <Input
            isDisabled={isSaving}
            maxLength={MAX_NAME_LENGTH}
            onChangeText={setName}
            placeholder="My workspace"
            value={name}
          />
          {nameValid ? null : (
            <FieldError>Workspace name can’t be empty.</FieldError>
          )}
        </TextField>
        {beta?.enabled && (
          <View className="gap-two px-five py-four">
            <Text className="font-semibold text-foreground">Private beta</Text>
            <Text className="text-muted-foreground">
              {beta.state !== "active"
                ? "Your beta has ended. Saved work remains readable; subscribe to keep working."
                : `Free until ${new Date(beta.expiresAt ?? "").toLocaleDateString()}. ${((beta.compute?.sandboxRemainingSeconds ?? 0) / 3600).toFixed(1)} sandbox hours remaining for your team.`}
            </Text>
            <Text className="text-muted-foreground">
              Your workspace admin subscribes and manages AI credits and
              provider API keys in workspace billing on the web.
            </Text>
          </View>
        )}
      </KeyboardAwareScrollView>
    </Screen>
  )
}
