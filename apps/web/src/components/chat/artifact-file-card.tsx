import {
  FileChip,
  FileChipContent,
  FileChipDescription,
  FileChipMedia,
  FileChipTitle,
  FileChipTrigger,
} from "@repo/ui/components/file-chip"
import { FileTypeIcon } from "@repo/ui/components/file-type-icon"
import { cn } from "@repo/ui/lib/utils"
import { useOpenFile, useOpenUpload } from "@/hooks/use-file-panel"
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

// A file someone shared. It opens in the right panel like Lor's files.
export function UploadFileCard({
  name,
  size,
  messageId,
  index,
  className,
}: {
  name: string
  size: number | null
  // The message that shared it and the file's position in its attachments.
  messageId: string
  index: number
  className?: string
}) {
  const openUpload = useOpenUpload()
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
        onClick={() => openUpload(messageId, index)}
      />
    </FileChip>
  )
}
