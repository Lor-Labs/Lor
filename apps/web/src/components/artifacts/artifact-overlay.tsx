import { Cancel01Icon, Download01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import { ArtifactBody } from "@/components/artifacts/artifact-body"
import { useArtifact } from "@/hooks/use-artifact"
import { formatFileSize } from "@/lib/attachments"

// Center-stage artifact viewer, addressed by ?artifactId= — the URL is the
// share link today and the multiplayer room key when live editing lands.
// Read-only in v1; the shell stays when the body becomes an editor.
export function ArtifactOverlay({
  artifactId,
  onClose,
}: {
  artifactId: string
  onClose: () => void
}) {
  const { data, isPending, isError } = useArtifact(artifactId)
  const artifact = data?.artifact ?? null

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <span className="min-w-0 truncate font-medium text-sm">
          {artifact ? artifact.path : "Artifact"}
        </span>
        {artifact && (
          <span className="shrink-0 text-muted-foreground text-xs">
            v{artifact.currentVersion}
            {artifact.size !== null
              ? ` · ${formatFileSize(artifact.size)}`
              : ""}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {artifact?.url && (
            <a
              href={artifact.url}
              download={artifact.path}
              className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-muted-foreground text-sm transition-colors hover:bg-accent hover:text-foreground"
            >
              <HugeiconsIcon icon={Download01Icon} size={16} />
              Download
            </a>
          )}
          <Button size="sm" variant="ghost" onClick={onClose}>
            <HugeiconsIcon icon={Cancel01Icon} size={16} />
          </Button>
        </div>
      </div>
      <div className="flex flex-1 flex-col overflow-auto p-6">
        {isPending && <p className="text-muted-foreground text-sm">Loading…</p>}
        {isError && (
          <p className="text-muted-foreground text-sm">
            Couldn't load this artifact.
          </p>
        )}
        {artifact && (
          <div className="mx-auto w-full max-w-3xl">
            <ArtifactBody
              path={artifact.path}
              mime={artifact.mime}
              url={artifact.url}
              size={artifact.size}
            />
          </div>
        )}
      </div>
    </div>
  )
}
