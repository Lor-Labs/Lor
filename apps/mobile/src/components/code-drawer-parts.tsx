import { Spinner } from "heroui-native/spinner"
import type { ReactNode } from "react"
import { Text, View } from "react-native"
import { Button } from "@/components/ui/button"
import type { ChangedFile } from "@/hooks/use-session-changes"

// Pieces shared by the code drawer's Changes and Files tabs.

export const STATUS: Record<
  ChangedFile["status"],
  { label: string; className: string }
> = {
  modified: { label: "Modified", className: "bg-warning" },
  added: { label: "Added", className: "bg-success" },
  untracked: { label: "New, untracked", className: "bg-success" },
  deleted: { label: "Deleted", className: "bg-danger" },
  renamed: { label: "Renamed", className: "bg-accent" },
  typechange: { label: "Type changed", className: "bg-accent" },
  conflicted: { label: "Conflict", className: "bg-danger" },
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <View className="flex-1 items-center justify-center gap-three px-six pb-eight">
      {children}
    </View>
  )
}

// Loading, a failed read, or no work folder to read: gone for good (no
// checkpoint), being rebuilt from the last checkpoint, or that failed.
export function FolderNote({
  state,
  what,
  onRetry,
}: {
  state: "loading" | "error" | "gone" | "restoring" | "restore_failed"
  // "the changes", "the files".
  what: string
  onRetry: () => void
}) {
  const retry = (
    <Button onPress={onRetry} size="sm" variant="outline">
      Try again
    </Button>
  )
  return (
    <Note>
      {state === "loading" || state === "restoring" ? <Spinner /> : null}
      {state === "loading" ? null : (
        <Text className="text-center text-sm text-muted">
          {state === "error"
            ? `Couldn't load ${what}.`
            : state === "restoring"
              ? "Restoring the session's files…"
              : state === "restore_failed"
                ? "Couldn't restore the session's files."
                : "This session's sandbox no longer exists, and it has no checkpoint to restore its files from."}
        </Text>
      )}
      {state === "error" || state === "restore_failed" ? retry : null}
    </Note>
  )
}

export function LineCounts({
  additions,
  deletions,
}: {
  additions: number | null
  deletions: number | null
}) {
  if (!(additions || deletions)) return null
  return (
    <Text className="font-mono text-xs">
      {additions ? <Text className="text-success">+{additions}</Text> : null}
      {additions && deletions ? " " : null}
      {deletions ? <Text className="text-danger">−{deletions}</Text> : null}
    </Text>
  )
}

export function splitPath(path: string) {
  const slash = path.lastIndexOf("/")
  return {
    name: path.slice(slash + 1),
    folder: slash > 0 ? path.slice(0, slash) : "",
  }
}
