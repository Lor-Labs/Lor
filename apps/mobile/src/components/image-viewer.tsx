import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon"
import Download01Icon from "@hugeicons/core-free-icons/Download01Icon"
import Share08Icon from "@hugeicons/core-free-icons/Share08Icon"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native"
import type { File } from "expo-file-system"
import { Asset, requestPermissionsAsync } from "expo-media-library"
import { StatusBar } from "expo-status-bar"
import { Spinner } from "heroui-native/spinner"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  FlatList,
  Image,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from "react-native"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import Animated, {
  Extrapolation,
  FadeInDown,
  FadeOutDown,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { scheduleOnRN } from "react-native-worklets"
import { triggerHaptic } from "@/components/ui/haptics"
import type { Message } from "@/lib/api-types"
import {
  deleteCachedFile,
  downloadToCache,
  shareRemoteFile,
} from "@/lib/remote-file"

type ImageAttachment = NonNullable<Message["attachments"]>[number]
type ViewerAction = "saving" | "sharing" | null
type ViewerStatus = { tone: "danger" | "success"; text: string } | null

export const viewerForeground = "#F5F5F4"
const viewerMuted = "#A8A29E"
const springConfig = { damping: 22, stiffness: 220 }

export function ImageViewer({
  images,
  initialIndex,
  onClose,
}: {
  images: ImageAttachment[]
  initialIndex: number
  onClose: () => void
}) {
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const [isZoomed, setIsZoomed] = useState(false)
  const [action, setAction] = useState<ViewerAction>(null)
  const [status, setStatus] = useState<ViewerStatus>(null)
  const currentImage = images[currentIndex] ?? images[0]

  useEffect(() => {
    if (!status) return
    const timeout = setTimeout(() => setStatus(null), 2200)
    return () => clearTimeout(timeout)
  }, [status])

  const shareImage = useCallback(async () => {
    if (!currentImage || action) return
    setAction("sharing")
    setStatus(null)

    try {
      await shareRemoteFile(currentImage)
    } catch {
      setStatus({
        tone: "danger",
        text: "This image could not be shared. Please try again.",
      })
    } finally {
      setAction(null)
    }
  }, [action, currentImage])

  const saveImage = useCallback(async () => {
    if (!currentImage || action) return
    setAction("saving")
    setStatus(null)
    let downloadedFile: File | null = null

    try {
      const permission = await requestPermissionsAsync(true, ["photo"])
      if (permission.status !== "granted") {
        setStatus({
          tone: "danger",
          text: "Photo access is required to save this image.",
        })
        return
      }

      downloadedFile = await downloadToCache(currentImage)
      await Asset.create(downloadedFile.uri)
      triggerHaptic("soft")
      setStatus({ tone: "success", text: "Saved to Photos" })
    } catch {
      setStatus({
        tone: "danger",
        text: "This image could not be saved. Please try again.",
      })
    } finally {
      deleteCachedFile(downloadedFile)
      setAction(null)
    }
  }, [action, currentImage])

  const handleMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const nextIndex = Math.round(event.nativeEvent.contentOffset.x / width)
      setCurrentIndex(Math.min(Math.max(nextIndex, 0), images.length - 1))
      setIsZoomed(false)
    },
    [images.length, width]
  )

  if (!currentImage) return null

  return (
    <Modal
      accessibilityViewIsModal
      animationType="fade"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      supportedOrientations={["portrait"]}
      transparent
      visible
    >
      <StatusBar animated style="light" />
      <View className="flex-1 bg-neutral-950">
        <FlatList
          data={images}
          decelerationRate="fast"
          getItemLayout={(_, index) => ({
            index,
            length: width,
            offset: width * index,
          })}
          horizontal
          initialScrollIndex={initialIndex}
          keyExtractor={(image, index) => `${image.url}-${index}`}
          onMomentumScrollEnd={handleMomentumEnd}
          pagingEnabled
          renderItem={({ item }) => (
            <ZoomableImage
              height={height}
              image={item}
              onClose={onClose}
              onZoomChange={setIsZoomed}
              width={width}
            />
          )}
          scrollEnabled={!isZoomed}
          showsHorizontalScrollIndicator={false}
          windowSize={3}
        />

        <View
          className="absolute inset-x-0 top-0 flex-row items-center gap-three px-three pb-three"
          pointerEvents="box-none"
          style={{ paddingTop: insets.top + 8 }}
        >
          <ViewerIconButton
            accessibilityLabel="Close image viewer"
            icon={Cancel01Icon}
            onPress={onClose}
          />
          <View className="min-w-0 flex-1">
            <Text
              className="text-sm font-semibold text-stone-100"
              numberOfLines={1}
            >
              {currentImage.filename}
            </Text>
            {images.length > 1 ? (
              <Text className="text-xs text-stone-400">
                {currentIndex + 1} of {images.length}
              </Text>
            ) : null}
          </View>
        </View>

        <View
          className="absolute inset-x-0 bottom-0 gap-three px-four pt-three"
          pointerEvents="box-none"
          style={{ paddingBottom: Math.max(insets.bottom, 12) }}
        >
          {status ? (
            <Animated.View
              accessibilityLiveRegion="polite"
              className={`self-center rounded-lor-lg border px-four py-three ${
                status.tone === "success"
                  ? "border-success/30 bg-success-soft"
                  : "border-danger/30 bg-danger-soft"
              }`}
              entering={FadeInDown.duration(160)}
              exiting={FadeOutDown.duration(140)}
            >
              <Text
                className={`text-sm font-medium ${
                  status.tone === "success" ? "text-success" : "text-danger"
                }`}
              >
                {status.text}
              </Text>
            </Animated.View>
          ) : null}
          <View className="flex-row gap-three">
            <ViewerActionButton
              accessibilityLabel="Save image to Photos"
              icon={Download01Icon}
              isDisabled={action !== null}
              isLoading={action === "saving"}
              label="Save"
              onPress={() => void saveImage()}
            />
            <ViewerActionButton
              accessibilityLabel="Share image"
              icon={Share08Icon}
              isDisabled={action !== null}
              isLoading={action === "sharing"}
              label="Share"
              onPress={() => void shareImage()}
            />
          </View>
        </View>
      </View>
    </Modal>
  )
}

function ZoomableImage({
  height,
  image,
  onClose,
  onZoomChange,
  width,
}: {
  height: number
  image: ImageAttachment
  onClose: () => void
  onZoomChange: (isZoomed: boolean) => void
  width: number
}) {
  const [isLoading, setIsLoading] = useState(true)
  const [hasError, setHasError] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const scale = useSharedValue(1)
  const savedScale = useSharedValue(1)
  const translationX = useSharedValue(0)
  const translationY = useSharedValue(0)
  const savedTranslationX = useSharedValue(0)
  const savedTranslationY = useSharedValue(0)
  const dismissY = useSharedValue(0)
  const touchStartX = useSharedValue(0)
  const touchStartY = useSharedValue(0)

  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .onUpdate((event) => {
          scale.value = Math.min(Math.max(savedScale.value * event.scale, 1), 4)
        })
        .onEnd(() => {
          const nextScale = Math.min(Math.max(scale.value, 1), 4)
          if (nextScale <= 1.02) {
            scale.value = withSpring(1, springConfig)
            savedScale.value = 1
            translationX.value = withSpring(0, springConfig)
            translationY.value = withSpring(0, springConfig)
            savedTranslationX.value = 0
            savedTranslationY.value = 0
            scheduleOnRN(onZoomChange, false)
            return
          }

          scale.value = withSpring(nextScale, springConfig)
          savedScale.value = nextScale
          scheduleOnRN(onZoomChange, true)
        }),
    [
      onZoomChange,
      savedScale,
      savedTranslationX,
      savedTranslationY,
      scale,
      translationX,
      translationY,
    ]
  )

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .manualActivation(true)
        .onTouchesMove((event, manager) => {
          if (event.numberOfTouches === 1 && scale.value > 1.02) {
            manager.activate()
          } else {
            manager.fail()
          }
        })
        .onBegin(() => {
          savedTranslationX.value = translationX.value
          savedTranslationY.value = translationY.value
        })
        .onUpdate((event) => {
          const maxX = (width * (scale.value - 1)) / 2
          const maxY = (height * (scale.value - 1)) / 2
          translationX.value = Math.min(
            Math.max(savedTranslationX.value + event.translationX, -maxX),
            maxX
          )
          translationY.value = Math.min(
            Math.max(savedTranslationY.value + event.translationY, -maxY),
            maxY
          )
        })
        .onEnd(() => {
          savedTranslationX.value = translationX.value
          savedTranslationY.value = translationY.value
        }),
    [
      height,
      savedTranslationX,
      savedTranslationY,
      scale,
      translationX,
      translationY,
      width,
    ]
  )

  const dismissGesture = useMemo(
    () =>
      Gesture.Pan()
        .manualActivation(true)
        .onTouchesDown((event) => {
          const touch = event.allTouches[0]
          if (!touch) return
          touchStartX.value = touch.absoluteX
          touchStartY.value = touch.absoluteY
        })
        .onTouchesMove((event, manager) => {
          const touch = event.allTouches[0]
          if (!touch || event.numberOfTouches !== 1 || scale.value > 1.02) {
            manager.fail()
            return
          }

          const deltaX = touch.absoluteX - touchStartX.value
          const deltaY = touch.absoluteY - touchStartY.value
          if (deltaY > 10 && deltaY > Math.abs(deltaX) * 1.15) {
            manager.activate()
          } else if (Math.abs(deltaX) > 10 || deltaY < -8) {
            manager.fail()
          }
        })
        .onUpdate((event) => {
          dismissY.value = Math.max(0, event.translationY)
        })
        .onEnd((event) => {
          if (event.translationY > 120 || event.velocityY > 900) {
            scheduleOnRN(onClose)
            return
          }
          dismissY.value = withSpring(0, springConfig)
        }),
    [dismissY, onClose, scale, touchStartX, touchStartY]
  )

  const doubleTapGesture = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .maxDuration(260)
        .onEnd((_event, success) => {
          if (!success) return
          if (scale.value > 1.02) {
            scale.value = withSpring(1, springConfig)
            savedScale.value = 1
            translationX.value = withSpring(0, springConfig)
            translationY.value = withSpring(0, springConfig)
            savedTranslationX.value = 0
            savedTranslationY.value = 0
            scheduleOnRN(onZoomChange, false)
            return
          }

          scale.value = withSpring(2.5, springConfig)
          savedScale.value = 2.5
          scheduleOnRN(onZoomChange, true)
        }),
    [
      onZoomChange,
      savedScale,
      savedTranslationX,
      savedTranslationY,
      scale,
      translationX,
      translationY,
    ]
  )

  const gesture = useMemo(
    () =>
      Gesture.Simultaneous(
        pinchGesture,
        Gesture.Race(panGesture, dismissGesture, doubleTapGesture)
      ),
    [dismissGesture, doubleTapGesture, panGesture, pinchGesture]
  )

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      dismissY.value,
      [0, height * 0.35],
      [1, 0.35],
      Extrapolation.CLAMP
    ),
    transform: [
      { translateX: translationX.value },
      { translateY: translationY.value + dismissY.value },
      { scale: scale.value * (1 - Math.min(dismissY.value / 1800, 0.08)) },
    ],
  }))

  return (
    <View style={{ height, width }}>
      <GestureDetector gesture={gesture}>
        <Animated.View
          className="flex-1 items-center justify-center"
          style={animatedStyle}
        >
          <Image
            accessibilityLabel={image.filename}
            key={`${image.url}-${retryKey}`}
            onError={() => {
              setHasError(true)
              setIsLoading(false)
            }}
            onLoad={() => {
              setHasError(false)
              setIsLoading(false)
            }}
            onLoadStart={() => {
              setHasError(false)
              setIsLoading(true)
            }}
            resizeMode="contain"
            source={{ uri: image.url }}
            style={{ height: "100%", width: "100%" }}
          />
        </Animated.View>
      </GestureDetector>
      {isLoading && !hasError ? (
        <View
          className="absolute inset-0 items-center justify-center"
          pointerEvents="none"
        >
          <View className="rounded-lor-lg bg-neutral-900/80 px-four py-three">
            <Text className="text-sm font-medium text-stone-300">
              Loading image…
            </Text>
          </View>
        </View>
      ) : null}
      {hasError ? (
        <View className="absolute inset-0 items-center justify-center gap-three px-eight">
          <Text className="text-center text-base font-semibold text-stone-100">
            Image unavailable
          </Text>
          <Text className="text-center text-sm text-stone-400">
            The image could not be loaded. Check your connection and try again.
          </Text>
          <Pressable
            accessibilityLabel="Retry loading image"
            accessibilityRole="button"
            className="rounded-lor-sm bg-neutral-800 px-four py-three active:bg-neutral-700"
            onPress={() => {
              setHasError(false)
              setIsLoading(true)
              setRetryKey((current) => current + 1)
            }}
          >
            <Text className="text-sm font-semibold text-stone-100">
              Try again
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

function ViewerIconButton({
  accessibilityLabel,
  icon,
  onPress,
}: {
  accessibilityLabel: string
  icon: IconSvgElement
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      className="size-10 items-center justify-center rounded-lor-sm bg-neutral-900/80 active:bg-neutral-800"
      hitSlop={6}
      onPress={onPress}
    >
      <HugeiconsIcon
        color={viewerForeground}
        icon={icon}
        size={20}
        strokeWidth={1.8}
      />
    </Pressable>
  )
}

function ViewerActionButton({
  accessibilityLabel,
  icon,
  isDisabled,
  isLoading,
  label,
  onPress,
}: {
  accessibilityLabel: string
  icon: IconSvgElement
  isDisabled: boolean
  isLoading: boolean
  label: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      className="min-h-12 flex-1 flex-row items-center justify-center gap-two rounded-lor-sm bg-neutral-900/90 px-four active:bg-neutral-800"
      disabled={isDisabled}
      onPress={onPress}
    >
      {isLoading ? (
        <Spinner color={viewerMuted} size="sm" />
      ) : (
        <HugeiconsIcon
          color={viewerForeground}
          icon={icon}
          size={19}
          strokeWidth={1.8}
        />
      )}
      <Text className="text-sm font-semibold text-stone-100">{label}</Text>
    </Pressable>
  )
}
