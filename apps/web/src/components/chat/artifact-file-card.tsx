import {
  FileChip,
  FileChipContent,
  FileChipDescription,
  FileChipLink,
  FileChipMedia,
  FileChipTitle,
  FileChipTrigger,
} from "@repo/ui/components/file-chip"
import { FileTypeIcon } from "@repo/ui/components/file-type-icon"
import { cn } from "@repo/ui/lib/utils"
import { useOpenFile } from "@/hooks/use-file-panel"
import { describeFile } from "@/lib/attachments"

// One card for Lor's files everywhere (replies, the session rail, plan cards,
// loop runs). It opens the file in the right panel.
export function ArtifactFileCard({
  artifactId,
  name,
  size,
  className,
}: {
  artifactId: string
  name: string
  size: number | null
  className?: string
}) {
  const openFile = useOpenFile()
  return (
    <FileChip className={cn("w-72", className)}>
      <FileChipMedia>
        <FileTypeIcon filename={name} />
      </FileChipMedia>
      <FileChipContent>
        <FileChipTitle>{name}</FileChipTitle>
        <FileChipDescription>{describeFile(name, size)}</FileChipDescription>
      </FileChipContent>
      <FileChipTrigger
        aria-label={`Open ${name}`}
        title={name}
        onClick={() => openFile(artifactId)}
      />
    </FileChip>
  )
}

// A file someone shared. It opens in a new tab; uploads have no versions or
// panel view yet.
export function UploadFileCard({
  name,
  size,
  url,
  className,
}: {
  name: string
  size: number | null
  url: string
  className?: string
}) {
  return (
    <FileChip className={cn("w-72", className)}>
      <FileChipMedia>
        <FileTypeIcon filename={name} />
      </FileChipMedia>
      <FileChipContent>
        <FileChipTitle>{name}</FileChipTitle>
        <FileChipDescription>{describeFile(name, size)}</FileChipDescription>
      </FileChipContent>
      <FileChipLink
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        label={`Open ${name}`}
        title={name}
      />
    </FileChip>
  )
}
