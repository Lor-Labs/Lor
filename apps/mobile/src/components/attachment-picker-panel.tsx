import Camera01Icon from "@hugeicons/core-free-icons/Camera01Icon"
import FileAttachmentIcon from "@hugeicons/core-free-icons/FileAttachmentIcon"
import Image01Icon from "@hugeicons/core-free-icons/Image01Icon"
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native"
import { Image } from "expo-image"
import { useThemeColor } from "heroui-native/hooks"
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native"
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller"
import Animated, { SlideInUp, useAnimatedStyle } from "react-native-reanimated"
import { type RecentPhoto, useRecentPhotos } from "@/hooks/use-recent-photos"

const gridGap = 3
const gridPadding = 12

export function AttachmentPickerPanel({
  height,
  onPickFiles,
  onPickPhotos,
  onSelectPhoto,
  onTakePhoto,
  selectedPhotoUris,
}: {
  height: number
  onPickFiles: () => Promise<void>
  onPickPhotos: () => Promise<void>
  onSelectPhoto: (photo: RecentPhoto) => void
  onTakePhoto: () => Promise<void>
  selectedPhotoUris: Set<string>
}) {
  const { width: windowWidth } = useWindowDimensions()
  const [foreground, muted, accent, accentForeground] = useThemeColor([
    "foreground",
    "muted",
    "accent",
    "accent-foreground",
  ])
  const {
    canAskAgain,
    error,
    isLoading,
    permission,
    photos,
    reload,
    requestPermission,
  } = useRecentPhotos()
  const { progress } = useReanimatedKeyboardAnimation()
  const tileSize = Math.floor((windowWidth - gridPadding * 2 - gridGap * 2) / 3)
  const containerStyle = useAnimatedStyle(
    () => ({ height: height * (1 - progress.value) }),
    [height]
  )

  return (
    <Animated.View
      className="-mx-three mt-two overflow-hidden bg-surface-secondary"
      style={containerStyle}
    >
      <Animated.View className="flex-1" entering={SlideInUp.duration(120)}>
        <View className="h-5 items-center justify-center">
          <View className="h-1 w-8 rounded-full bg-surface-tertiary" />
        </View>
        <View className="flex-row gap-two px-three pb-three">
          <AccessoryAction
            color={foreground}
            icon={Image01Icon}
            label="All photos"
            onPress={() => void onPickPhotos()}
          />
          <AccessoryAction
            color={foreground}
            icon={FileAttachmentIcon}
            label="Files"
            onPress={() => void onPickFiles()}
          />
        </View>

        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color={accent} />
          </View>
        ) : permission === "denied" ? (
          <View className="flex-1 items-center justify-center gap-three px-six">
            <View className="size-11 items-center justify-center rounded-lor-sm bg-default">
              <HugeiconsIcon color={muted} icon={Image01Icon} size={22} />
            </View>
            <View className="items-center gap-one">
              <Text className="text-center text-sm font-semibold text-foreground">
                Show recent photos
              </Text>
              <Text className="text-center text-xs text-muted">
                Allow photo access to choose images without leaving the
                composer.
              </Text>
            </View>
            <Pressable
              accessibilityLabel={
                canAskAgain ? "Allow photo access" : "Open photo settings"
              }
              accessibilityRole="button"
              className="rounded-lor-sm bg-accent px-four py-two active:opacity-80"
              onPress={() => {
                if (canAskAgain) void requestPermission()
                else void Linking.openSettings()
              }}
            >
              <Text className="text-sm font-semibold text-accent-foreground">
                {canAskAgain ? "Allow access" : "Open Settings"}
              </Text>
            </Pressable>
          </View>
        ) : error ? (
          <View className="flex-1 items-center justify-center gap-three px-six">
            <Text className="text-center text-sm text-muted">{error}</Text>
            <Pressable
              accessibilityLabel="Reload recent photos"
              accessibilityRole="button"
              className="rounded-lor-sm bg-default px-four py-two active:bg-surface-tertiary"
              onPress={() => void reload()}
            >
              <Text className="text-sm font-semibold text-foreground">
                Try again
              </Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView
            contentContainerClassName="flex-row flex-wrap"
            contentContainerStyle={{
              columnGap: gridGap,
              paddingHorizontal: gridPadding,
              rowGap: gridGap,
            }}
            showsVerticalScrollIndicator={false}
          >
            <PhotoTile
              accessibilityLabel="Take a photo"
              onPress={() => void onTakePhoto()}
              size={tileSize}
            >
              <HugeiconsIcon color={foreground} icon={Camera01Icon} size={28} />
              <Text className="text-xs font-medium text-foreground">
                Camera
              </Text>
            </PhotoTile>
            {photos.map((photo) => {
              const isSelected = selectedPhotoUris.has(photo.uri)
              return (
                <PhotoTile
                  accessibilityLabel={`Attach ${photo.filename}`}
                  isSelected={isSelected}
                  key={photo.id}
                  onPress={() => {
                    if (!isSelected) onSelectPhoto(photo)
                  }}
                  size={tileSize}
                >
                  <Image
                    accessibilityIgnoresInvertColors
                    contentFit="cover"
                    source={{ uri: photo.uri }}
                    style={{ height: "100%", width: "100%" }}
                    transition={80}
                  />
                  {isSelected ? (
                    <View
                      className="absolute right-two top-two size-6 items-center justify-center rounded-full"
                      style={{ backgroundColor: accent }}
                    >
                      <HugeiconsIcon
                        color={accentForeground}
                        icon={Tick02Icon}
                        size={14}
                        strokeWidth={2.5}
                      />
                    </View>
                  ) : null}
                </PhotoTile>
              )
            })}
          </ScrollView>
        )}

        {permission === "limited" ? (
          <Pressable
            accessibilityLabel="Choose more photos"
            accessibilityRole="button"
            className="absolute bottom-two right-three rounded-lor-sm bg-surface px-three py-two shadow-sm"
            onPress={() => void onPickPhotos()}
          >
            <Text className="text-xs font-semibold text-accent">
              Choose more
            </Text>
          </Pressable>
        ) : null}
      </Animated.View>
    </Animated.View>
  )
}

function AccessoryAction({
  color,
  icon,
  label,
  onPress,
}: {
  color: string
  icon: IconSvgElement
  label: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      className="min-h-11 flex-1 flex-row items-center justify-center gap-two rounded-lor-sm bg-default px-three active:bg-surface-tertiary"
      onPress={onPress}
    >
      <HugeiconsIcon color={color} icon={icon} size={18} />
      <Text className="text-sm font-semibold text-foreground">{label}</Text>
    </Pressable>
  )
}

function PhotoTile({
  accessibilityLabel,
  children,
  isSelected = false,
  onPress,
  size,
}: {
  accessibilityLabel: string
  children: React.ReactNode
  isSelected?: boolean
  onPress: () => void
  size: number
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      className={`items-center justify-center gap-two overflow-hidden bg-default active:opacity-80 ${
        isSelected ? "border-[3px] border-accent" : ""
      }`}
      onPress={onPress}
      style={{
        height: size,
        width: size,
      }}
    >
      {children}
    </Pressable>
  )
}
