import { cn } from "@repo/ui/lib/utils"

// A page glyph carrying the file's extension, in the color people already
// read that type as: a spreadsheet is green, a PDF red. Drawn rather than
// imported because the recognizable versions are Microsoft's and Adobe's
// product marks. Saturated because they are solid fills under a white label,
// one step brighter in dark mode so they don't sink into the surface.
const TONES = {
  spreadsheet: "text-green-600 dark:text-green-500",
  pdf: "text-red-600 dark:text-red-500",
  document: "text-blue-600 dark:text-blue-500",
  presentation: "text-orange-600 dark:text-orange-500",
  code: "text-violet-600 dark:text-violet-500",
  image: "text-sky-600 dark:text-sky-500",
  media: "text-pink-600 dark:text-pink-500",
  archive: "text-amber-600 dark:text-amber-500",
  generic: "text-muted-foreground",
} as const

const TONE_BY_EXTENSION: Record<string, keyof typeof TONES> = {
  csv: "spreadsheet",
  numbers: "spreadsheet",
  tsv: "spreadsheet",
  xls: "spreadsheet",
  xlsx: "spreadsheet",
  pdf: "pdf",
  doc: "document",
  docx: "document",
  md: "document",
  pages: "document",
  rtf: "document",
  txt: "document",
  key: "presentation",
  ppt: "presentation",
  pptx: "presentation",
  css: "code",
  html: "code",
  js: "code",
  json: "code",
  jsx: "code",
  log: "code",
  py: "code",
  sh: "code",
  sql: "code",
  toml: "code",
  ts: "code",
  tsx: "code",
  xml: "code",
  yaml: "code",
  yml: "code",
  gif: "image",
  heic: "image",
  jpeg: "image",
  jpg: "image",
  png: "image",
  svg: "image",
  webp: "image",
  m4a: "media",
  mov: "media",
  mp3: "media",
  mp4: "media",
  wav: "media",
  webm: "media",
  gz: "archive",
  tar: "archive",
  tgz: "archive",
  zip: "archive",
}

// The label fits 17 units of page width, so long extensions step down.
const LABEL_FONT_SIZE: Record<number, number> = { 1: 8, 2: 8, 3: 7, 4: 5.5 }

export function FileTypeIcon({
  filename,
  className,
}: {
  filename: string
  className?: string
}) {
  const extension = filename.split(".").pop()?.toLowerCase() ?? ""
  const tone = TONE_BY_EXTENSION[extension]
  const label = tone ? extension.slice(0, 4).toUpperCase() : ""

  return (
    <svg
      aria-hidden="true"
      className={cn("size-6 shrink-0", TONES[tone ?? "generic"], className)}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M5.5 1.5H13.7L20.5 8.3V20.5A2 2 0 0 1 18.5 22.5H5.5A2 2 0 0 1 3.5 20.5V3.5A2 2 0 0 1 5.5 1.5Z"
        fill="currentColor"
      />
      <path
        d="M13.7 1.5L20.5 8.3H15.7A2 2 0 0 1 13.7 6.3Z"
        fill="white"
        fillOpacity={0.35}
      />
      {label ? (
        <text
          fill="white"
          fontSize={LABEL_FONT_SIZE[label.length] ?? 5.5}
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
