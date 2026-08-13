import { Attachment } from "@repo/ui/components/nexus-ui/attachments"
import { cn } from "@repo/ui/lib/utils"
import { useNavigate } from "@tanstack/react-router"
import {
  formatFileSize,
  getFileKind,
  toAttachmentMeta,
} from "@/lib/attachments"

// One file surface for artifacts everywhere: a `row` presents a deliverable
// (Merlin message endings, the task panel's Files list), a `chip` packs into
// tight spaces (task card footer). Both open the artifact takeover viewer —
// artifacts are the only files that do.
export function ArtifactFileCard({
  artifactId,
  name,
  contentType,
  size,
  variant = "row",
  className,
}: {
  artifactId: string
  name: string
  contentType: string
  size: number | null
  variant?: "row" | "chip"
  className?: string
}) {
  const navigate = useNavigate()
  const kind = getFileKind(contentType, name)

  const open = () => {
    void navigate({
      to: ".",
      search: (prev) => ({ ...prev, artifactId }),
    })
  }

  if (variant === "chip") {
    const attachment = toAttachmentMeta({
      filename: name,
      contentType,
      size: size ?? undefined,
    })

    return (
      <button
        type="button"
        onClick={open}
        className={cn(
          "group/file block min-w-0 cursor-pointer rounded-sm text-left outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ring/50 active:translate-y-px",
          className
        )}
      >
        <Attachment
          readOnly
          variant="detailed"
          attachment={attachment}
          className="w-full max-w-none cursor-pointer transition-colors group-hover/file:bg-secondary/70"
        />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={open}
      className={cn(
        "flex w-full max-w-md cursor-pointer items-center gap-3 rounded-lg border bg-card p-2.5 text-left transition-colors hover:bg-accent/50",
        className
      )}
    >
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-md",
          kind.tint
        )}
      >
        <kind.Icon className="size-4.5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-sm">{name}</p>
        <p className="text-muted-foreground text-xs">
          {kind.label}
          {size !== null && ` · ${formatFileSize(size)}`}
        </p>
      </div>
    </button>
  )
}
