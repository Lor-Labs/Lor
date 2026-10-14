import {
  FILE_CORNER_PATH,
  FILE_PAGE_PATH,
  type FileTypeTone,
  fileLabelFontSize,
  fileType,
} from "@repo/ui/lib/file-types"
import { useThemeColor } from "heroui-native/hooks"
import { useColorScheme } from "react-native"
import Svg, { Path, Text as SvgText } from "react-native-svg"

// Web's FileTypeIcon tones (Tailwind 600 in light, 500 in dark) as fills.
const TONES: Record<Exclude<FileTypeTone, "generic">, [string, string]> = {
  spreadsheet: ["#00a63e", "#00c950"],
  pdf: ["#e7000b", "#fb2c36"],
  document: ["#155dfc", "#2b7fff"],
  presentation: ["#f54900", "#ff6900"],
  code: ["#7f22fe", "#8e51ff"],
  image: ["#0084d1", "#00a6f4"],
  media: ["#e60076", "#f6339a"],
  archive: ["#e17100", "#fe9a00"],
}

export function FileTypeIcon({
  filename,
  size = 28,
}: {
  filename: string
  size?: number
}) {
  const scheme = useColorScheme()
  const muted = useThemeColor("muted")
  const { tone, label } = fileType(filename)
  const fill =
    tone === "generic" ? muted : TONES[tone][scheme === "dark" ? 1 : 0]

  return (
    <Svg accessible={false} height={size} viewBox="0 0 24 24" width={size}>
      <Path d={FILE_PAGE_PATH} fill={fill} />
      <Path d={FILE_CORNER_PATH} fill="white" fillOpacity={0.35} />
      {label ? (
        <SvgText
          fill="white"
          fontSize={fileLabelFontSize(label)}
          fontWeight="700"
          letterSpacing={-0.3}
          textAnchor="middle"
          x="12"
          y="16.5"
        >
          {label}
        </SvgText>
      ) : null}
    </Svg>
  )
}
