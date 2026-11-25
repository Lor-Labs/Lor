import { useNavigation } from "expo-router"
import { SymbolView } from "expo-symbols"
import { useThemeColor } from "heroui-native/hooks"
import { useEffect, useRef, useState } from "react"
import { FlatList, Text, View } from "react-native"
import { IconButton } from "@/components/ui/icon-button"
import { ZoomableImage } from "@/components/zoomable-image"

export type FileImage = { name: string; url: string }

export function FileImageGallery({
  images,
  index,
  onIndexChange,
}: {
  images: FileImage[]
  index: number
  onIndexChange: (index: number) => void
}) {
  const navigation = useNavigation()
  const foreground = useThemeColor("foreground")
  const list = useRef<FlatList<FileImage>>(null)
  const [width, setWidth] = useState(0)
  const [zoomed, setZoomed] = useState(false)
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !zoomed })
    return () => navigation.setOptions({ gestureEnabled: true })
  }, [navigation, zoomed])

  // The page the list shows. When the selection moves without a swipe (a
  // refresh reordered the images), jump the list to it.
  const page = useRef(index)
  useEffect(() => {
    if (page.current === index) return
    page.current = index
    list.current?.scrollToIndex({ index, animated: false })
  }, [index])

  const select = (next: number) => {
    page.current = next
    list.current?.scrollToIndex({ index: next, animated: true })
    onIndexChange(next)
  }

  return (
    <View className="flex-1">
      <View
        className="flex-1"
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      >
        {width > 0 && (
          <FlatList
            key={width}
            ref={list}
            data={images}
            horizontal
            pagingEnabled
            initialScrollIndex={index}
            getItemLayout={(_, index) => ({
              index,
              length: width,
              offset: width * index,
            })}
            keyExtractor={(image) => image.url}
            scrollEnabled={!zoomed}
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(event) => {
              const next = Math.max(
                0,
                Math.min(
                  images.length - 1,
                  Math.round(event.nativeEvent.contentOffset.x / width)
                )
              )
              page.current = next
              onIndexChange(next)
              setZoomed(false)
            }}
            renderItem={({ item, index: itemIndex }) => (
              <View style={{ width }}>
                <ZoomableImage
                  accessibilityLabel={item.name}
                  uri={item.url}
                  onZoomChange={(value) => {
                    if (itemIndex === index) setZoomed(value)
                  }}
                />
              </View>
            )}
            windowSize={3}
          />
        )}
      </View>
      {images.length > 1 && (
        <View className="flex-row items-center justify-center gap-four border-t border-separator px-four py-two">
          <IconButton
            accessibilityLabel="Previous image"
            isDisabled={index === 0 || zoomed}
            onPress={() => select(index - 1)}
            variant="ghost"
          >
            <SymbolView
              name={{
                ios: "chevron.left",
                android: "chevron_left",
                web: "chevron_left",
              }}
              size={20}
              tintColor={foreground}
            />
          </IconButton>
          <Text
            accessibilityLiveRegion="polite"
            className="text-sm tabular-nums text-muted"
          >
            {index + 1} of {images.length}
          </Text>
          <IconButton
            accessibilityLabel="Next image"
            isDisabled={index === images.length - 1 || zoomed}
            onPress={() => select(index + 1)}
            variant="ghost"
          >
            <SymbolView
              name={{
                ios: "chevron.right",
                android: "chevron_right",
                web: "chevron_right",
              }}
              size={20}
              tintColor={foreground}
            />
          </IconButton>
        </View>
      )}
    </View>
  )
}
