import { cn } from "@repo/ui/lib/utils"
import { useNavigate } from "@tanstack/react-router"
import { formatFileSize, getFileKind } from "@/lib/attachments"

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
    return (
      <button
        type="button"
        onClick={open}
        className={cn(
          "flex cursor-pointer items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-sm transition-colors hover:bg-accent",
          className
        )}
      >
        <kind.Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="max-w-44 truncate">{name}</span>
        {size !== null && (
          <span className="shrink-0 text-muted-foreground text-xs">
            {formatFileSize(size)}
          </span>
        )}
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
