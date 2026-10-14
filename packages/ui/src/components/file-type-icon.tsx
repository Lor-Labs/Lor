import {
  FILE_CORNER_PATH,
  FILE_PAGE_PATH,
  type FileTypeTone,
  fileLabelFontSize,
  fileType,
} from "@repo/ui/lib/file-types"
import { cn } from "@repo/ui/lib/utils"

// Drawn rather than imported because the recognizable versions are
// Microsoft's and Adobe's product marks. Saturated because they are solid
// fills under a white label, one step brighter in dark mode so they don't
// sink into the surface.
const TONES: Record<FileTypeTone, string> = {
  spreadsheet: "text-green-600 dark:text-green-500",
  pdf: "text-red-600 dark:text-red-500",
  document: "text-blue-600 dark:text-blue-500",
  presentation: "text-orange-600 dark:text-orange-500",
  code: "text-violet-600 dark:text-violet-500",
  image: "text-sky-600 dark:text-sky-500",
  media: "text-pink-600 dark:text-pink-500",
  archive: "text-amber-600 dark:text-amber-500",
  generic: "text-muted-foreground",
}

export function FileTypeIcon({
  filename,
  className,
}: {
  filename: string
  className?: string
}) {
  const { tone, label } = fileType(filename)

  return (
    <svg
      aria-hidden="true"
      className={cn("size-6 shrink-0", TONES[tone], className)}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d={FILE_PAGE_PATH} fill="currentColor" />
      <path d={FILE_CORNER_PATH} fill="white" fillOpacity={0.35} />
      {label ? (
        <text
          fill="white"
          fontSize={fileLabelFontSize(label)}
          fontWeight={700}
          letterSpacing={-0.3}
          textAnchor="middle"
          x="12"
          y="16.5"
        >
          {label}
        </text>
      ) : null}
    </svg>
  )
}
