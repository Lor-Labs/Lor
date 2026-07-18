import {
  getAvatarColorStyle,
  getAvatarInitials,
} from "@repo/utils/avatar-colors"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { type ImageSourcePropType, View } from "react-native"
import Svg, {
  Circle,
  ClipPath,
  Defs,
  Mask,
  Rect,
  Image as SvgImage,
  Text as SvgText,
} from "react-native-svg"
import { useSocketConnected } from "@/context/socket-context"
import { useWorkspace } from "@/context/workspace-context"
import { useTheme } from "@/hooks/use-theme"
import { authClient } from "@/lib/auth-client"

const ICON_PT = 26
const ICON_SCALE = 3
const ICON_PX = ICON_PT * ICON_SCALE
const CENTER = ICON_PT / 2
const DOT_CENTER = ICON_PT - 5
const DOT_RADIUS = 3.2
const DOT_CUTOUT_RADIUS = 5

/**
 * Rasterizes the signed-in user's avatar (photo, or initials on their seed
 * color) into a native tab-bar icon, Discord-style: circle crop plus a green
 * presence dot punched out of the avatar edge while the socket is connected.
 * Native tab icons must be bitmaps, so an offscreen SVG is captured with
 * toDataURL whenever the inputs change.
 */
export function useTabAvatarIcon(): {
  source: ImageSourcePropType | null
  canvas: ReactNode
} {
  const { data: session } = authClient.useSession()
  const { avatarColor } = useWorkspace()
  const isConnected = useSocketConnected()
  const theme = useTheme()
  const [source, setSource] = useState<ImageSourcePropType | null>(null)
  const [failedImage, setFailedImage] = useState<string | null>(null)
  const svgRef = useRef<Svg>(null)
  const capturedRef = useRef(false)

  const user = session?.user
  const image = user?.image && user.image !== failedImage ? user.image : null
  const name = user?.name ?? ""
  const renderKey = `${image ?? "initials"}|${name}|${avatarColor ?? "seed"}|${isConnected}|${theme.success}`

  const capture = () => {
    capturedRef.current = true
    svgRef.current?.toDataURL(
      (base64) => {
        setSource({
          uri: `data:image/png;base64,${base64}`,
          width: ICON_PT,
          height: ICON_PT,
          scale: ICON_SCALE,
        })
      },
      { width: ICON_PX, height: ICON_PX }
    )
  }

  // The initials variant has no load event, so capture one frame after mount.
  // The photo variant captures from onLoad; SvgImage has no onError, so a
  // photo that never loads falls back to initials after a timeout.
  useEffect(() => {
    if (!user) return
    capturedRef.current = false
    const frame = requestAnimationFrame(() => {
      if (!image) capture()
    })
    const fallback = image
      ? setTimeout(() => {
          if (!capturedRef.current) setFailedImage(image)
        }, 5000)
      : null
    return () => {
      cancelAnimationFrame(frame)
      if (fallback) clearTimeout(fallback)
    }
  }, [renderKey, user])

  if (!user) return { source: null, canvas: null }

  const fallbackColors = getAvatarColorStyle(avatarColor, name)

  const canvas = (
    <View
      aria-hidden
      key={renderKey}
      pointerEvents="none"
      style={{ position: "absolute", left: -1000, top: 0, opacity: 0 }}
    >
      {/* The native rasterizer draws at the view's layout size without
          scaling to the requested bounds, so the view itself must be
          ICON_PX with the viewBox mapping the 26pt coordinate space up. */}
      <Svg
        height={ICON_PX}
        ref={svgRef}
        viewBox={`0 0 ${ICON_PT} ${ICON_PT}`}
        width={ICON_PX}
      >
        <Defs>
          <ClipPath id="avatarClip">
            <Circle cx={CENTER} cy={CENTER} r={CENTER} />
          </ClipPath>
          <Mask id="dotCutout">
            <Rect fill="white" height={ICON_PT} width={ICON_PT} x={0} y={0} />
            {isConnected ? (
              <Circle
                cx={DOT_CENTER}
                cy={DOT_CENTER}
                fill="black"
                r={DOT_CUTOUT_RADIUS}
              />
            ) : null}
          </Mask>
        </Defs>

        {image ? (
          <SvgImage
            clipPath="url(#avatarClip)"
            height={ICON_PT}
            href={{ uri: image }}
            mask="url(#dotCutout)"
            onLoad={capture}
            preserveAspectRatio="xMidYMid slice"
            width={ICON_PT}
            x={0}
            y={0}
          />
        ) : (
          <>
            <Circle
              cx={CENTER}
              cy={CENTER}
              fill={fallbackColors.backgroundColor}
              mask="url(#dotCutout)"
              r={CENTER}
            />
            <SvgText
              alignmentBaseline="central"
              fill={fallbackColors.foregroundColor}
              fontSize={10.5}
              fontWeight="700"
              textAnchor="middle"
              x={CENTER}
              y={CENTER}
            >
              {getAvatarInitials(name)}
            </SvgText>
          </>
        )}

        {isConnected ? (
          <Circle
            cx={DOT_CENTER}
            cy={DOT_CENTER}
            fill={theme.success}
            r={DOT_RADIUS}
          />
        ) : null}
      </Svg>
    </View>
  )

  return { source, canvas }
}
