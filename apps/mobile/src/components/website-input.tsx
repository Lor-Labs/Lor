import Globe02Icon from "@hugeicons/core-free-icons/Globe02Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { normalizeDomain } from "@repo/utils/domain"
import { Image } from "expo-image"
import { useEffect, useRef, useState } from "react"
import { Pressable, TextInput, type TextInputProps, View } from "react-native"
import Animated, { withSpring, withTiming } from "react-native-reanimated"
import { useTheme } from "@/hooks/use-theme"

const FAVICON_DEBOUNCE_MS = 300
const ICON_SIZE = 18

// Same snap as the call sheet: damping ratio ~0.8, clamped, so the icon pops
// from half size and stops dead at full size. Matches the web field.
const ICON_SPRING = {
  mass: 1,
  stiffness: 420,
  damping: 33,
  overshootClamping: true,
}

function iconEntering() {
  "worklet"
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.5 }] },
    animations: {
      opacity: withTiming(1, { duration: 150 }),
      transform: [{ scale: withSpring(1, ICON_SPRING) }],
    },
  }
}

function iconExiting() {
  "worklet"
  return {
    initialValues: { opacity: 1, transform: [{ scale: 1 }] },
    animations: {
      opacity: withTiming(0, { duration: 120 }),
      transform: [{ scale: withTiming(0.5, { duration: 120 }) }],
    },
  }
}

// Same source as web: Google's public favicon service, served as PNG.
function faviconUrl(domain: string) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`
}

// The field draws its own chrome, so callers can't restyle the inner input.
type WebsiteInputProps = Omit<
  TextInputProps,
  "value" | "onChangeText" | "className" | "style"
> & {
  value: string
  onChangeText: (value: string) => void
}

// Website field with the site's favicon at the start. The icon swaps in only
// after it has been fetched, so a missing favicon keeps the globe.
export function WebsiteInput({
  value,
  onChangeText,
  ...props
}: WebsiteInputProps) {
  const theme = useTheme()
  const inputRef = useRef<TextInput>(null)
  const [loadedDomain, setLoadedDomain] = useState<string | null>(null)
  const [domain, setDomain] = useState(() => normalizeDomain(value))

  useEffect(() => {
    const id = setTimeout(
      () => setDomain(normalizeDomain(value)),
      FAVICON_DEBOUNCE_MS
    )
    return () => clearTimeout(id)
  }, [value])

  useEffect(() => {
    if (!domain) return
    let cancelled = false
    void Image.prefetch(faviconUrl(domain)).then((ok) => {
      if (ok && !cancelled) setLoadedDomain(domain)
    })
    return () => {
      cancelled = true
    }
  }, [domain])

  const showFavicon = domain !== null && loadedDomain === domain

  // A row, not an overlay: the icon and the text are centered by the same
  // flex line, so they stay aligned however iOS places the text baseline.
  return (
    <Pressable
      accessible={false}
      className="min-h-[52px] flex-row items-center gap-[10px] rounded-lor-md border border-border bg-surface px-three"
      onPress={() => inputRef.current?.focus()}
    >
      <View
        className="items-center justify-center"
        pointerEvents="none"
        style={{ width: ICON_SIZE, height: ICON_SIZE }}
      >
        {showFavicon ? (
          <Animated.View
            key={domain}
            className="absolute"
            entering={iconEntering}
            exiting={iconExiting}
          >
            <Image
              source={{ uri: faviconUrl(domain) }}
              style={{ width: ICON_SIZE, height: ICON_SIZE, borderRadius: 3 }}
            />
          </Animated.View>
        ) : (
          <Animated.View
            key="globe"
            className="absolute"
            entering={iconEntering}
            exiting={iconExiting}
          >
            <HugeiconsIcon
              color={theme.textTertiary}
              icon={Globe02Icon}
              size={ICON_SIZE}
            />
          </Animated.View>
        )}
      </View>
      <TextInput
        ref={inputRef}
        className="flex-1 self-stretch text-[16px] text-foreground"
        value={value}
        onChangeText={onChangeText}
        {...props}
      />
    </Pressable>
  )
}
