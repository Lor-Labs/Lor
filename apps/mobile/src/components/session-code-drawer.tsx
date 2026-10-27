import {
  BottomSheetFlatList,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet"
import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { BottomSheet } from "heroui-native/bottom-sheet"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import { type ReactNode, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { KeyboardController } from "react-native-keyboard-controller"
import { diffLineClass } from "@/components/lor-tool-trail"
import { Button } from "@/components/ui/button"
import {
  type ChangedFile,
  type ReadyChanges,
  useChangeDiff,
  useSessionChanges,
} from "@/hooks/use-session-changes"

// A code session's drawer: the files Lor and people changed in the session's
// sandbox and their diffs. Mirrors web's Changes panel
// (session-changes-panel.tsx).

const STATUS: Record<
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

export function SessionCodeDrawer({
  sessionId,
  isOpen,
  onOpenChange,
}: {
  sessionId: string
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
}) {
  const changes = useSessionChanges(sessionId)
  // The file whose diff is open; null shows the list.
  const [openPath, setOpenPath] = useState<string | null>(null)
  const ready = changes.data?.state === "ready" ? changes.data : null
  const openFile = ready?.files.find((file) => file.path === openPath) ?? null

  const body = changes.isPending ? (
    <Note>
      <Spinner />
    </Note>
  ) : changes.isError ? (
    <Note>
      <Text className="text-center text-sm text-muted">
        Couldn't load the changes.
      </Text>
      <Button
        onPress={() => void changes.refetch()}
        size="sm"
        variant="outline"
      >
        Try again
      </Button>
    </Note>
  ) : changes.data.state === "restoring" ? (
    <Note>
      <Spinner />
      <Text className="text-center text-sm text-muted">
        Restoring the session's files…
      </Text>
    </Note>
  ) : changes.data.state === "restore_failed" ? (
    <Note>
      <Text className="text-center text-sm text-muted">
        Couldn't restore the session's files.
      </Text>
      <Button
        onPress={() => void changes.refetch()}
        size="sm"
        variant="outline"
      >
        Try again
      </Button>
    </Note>
  ) : changes.data.state === "gone" ? (
    <Note>
      <Text className="text-center text-sm text-muted">
        This session's sandbox no longer exists, and it has no checkpoint to
        restore its files from.
      </Text>
    </Note>
  ) : openFile ? (
    <DiffView
      file={openFile}
      onBack={() => setOpenPath(null)}
      sessionId={sessionId}
      version={changes.dataUpdatedAt}
    />
  ) : (
    <ChangesList changes={changes.data} onOpen={setOpenPath} />
  )

  return (
    <BottomSheet
      isOpen={isOpen}
      onOpenChange={(next) => {
        if (!next) setOpenPath(null)
        onOpenChange(next)
      }}
    >
      <BottomSheet.Portal unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay className="bg-neutral-950/50" />
        <BottomSheet.Content
          enableDynamicSizing={false}
          // The composer's keyboard would cover the sheet.
          onAnimate={(fromIndex, toIndex) => {
            if (fromIndex !== -1 || toIndex < 0) return
            requestAnimationFrame(() => {
              void KeyboardController.dismiss().catch(() => undefined)
            })
          }}
          snapPoints={["92%"]}
        >
          <View className="flex-row items-center px-one pb-three">
            <BottomSheet.Title className="flex-1">Changes</BottomSheet.Title>
            <BottomSheet.Close />
          </View>
          {body}
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  )
}

function Note({ children }: { children: ReactNode }) {
  return (
    <View className="flex-1 items-center justify-center gap-three px-six pb-eight">
      {children}
    </View>
  )
}

function LineCounts({
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

function splitPath(path: string) {
  const slash = path.lastIndexOf("/")
  return {
    name: path.slice(slash + 1),
    folder: slash > 0 ? path.slice(0, slash) : "",
  }
}

function ChangesList({
  changes,
  onOpen,
}: {
  changes: ReadyChanges
  onOpen: (path: string) => void
}) {
  const totals = changes.files.reduce(
    (sum, file) => ({
      additions: sum.additions + (file.additions ?? 0),
      deletions: sum.deletions + (file.deletions ?? 0),
    }),
    { additions: 0, deletions: 0 }
  )
  const tracked = changes.files.filter((file) => file.status !== "untracked")
  const untracked = changes.files.filter((file) => file.status === "untracked")
  return (
    <BottomSheetScrollView
      contentContainerStyle={{ paddingBottom: 40 }}
      showsVerticalScrollIndicator={false}
    >
      <View className="flex-row items-center gap-two px-one pb-two">
        <Text className="text-[13px] text-muted">
          {changes.files.length} {changes.files.length === 1 ? "file" : "files"}
          {changes.branch ? ` on ${changes.branch}` : ""}
        </Text>
        <LineCounts additions={totals.additions} deletions={totals.deletions} />
      </View>
      {changes.lorWorking ? (
        <Text className="mx-one mb-two rounded-lor-sm bg-accent-soft px-three py-two text-xs text-accent">
          Lor is working. Staging waits until it finishes.
        </Text>
      ) : null}
      {changes.merging ? (
        <Text className="mx-one mb-two rounded-lor-sm bg-warning-soft px-three py-two text-xs text-warning">
          The pulled commits conflict with this session's. Fix the conflicted
          files (Lor can), stage them, then commit to finish the merge.
        </Text>
      ) : null}
      {changes.files.length === 0 ? (
        <Text className="px-three py-eight text-center text-sm text-muted">
          No changes yet. Lor's edits show up here as it works.
        </Text>
      ) : (
        <>
          <FileGroup files={tracked} onOpen={onOpen} title="Tracked" />
          <FileGroup files={untracked} onOpen={onOpen} title="Untracked" />
          {changes.truncated ? (
            <Text className="px-three py-two text-xs text-muted">
              Showing the first 1,000 files.
            </Text>
          ) : null}
        </>
      )}
    </BottomSheetScrollView>
  )
}

function FileGroup({
  title,
  files,
  onOpen,
}: {
  title: string
  files: ChangedFile[]
  onOpen: (path: string) => void
}) {
  if (files.length === 0) return null
  return (
    <View className="pb-two">
      <Text className="px-one pb-one pt-two text-xs font-medium text-muted">
        {title} · {files.length}
      </Text>
      {files.map((file) => {
        const { name, folder } = splitPath(file.path)
        const status = STATUS[file.status]
        return (
          <Pressable
            accessibilityHint="Shows its changes"
            accessibilityLabel={`${file.path}, ${status.label}`}
            accessibilityRole="button"
            className="min-h-11 flex-row items-center gap-two rounded-lor-sm px-one active:bg-surface-secondary"
            key={file.path}
            onPress={() => onOpen(file.path)}
          >
            <View className={`size-2 rounded-full ${status.className}`} />
            <Text
              className={`shrink-0 text-[15px] ${
                file.status === "deleted"
                  ? "text-muted line-through"
                  : "text-foreground"
              }`}
              numberOfLines={1}
            >
              {name}
            </Text>
            <Text
              className="min-w-0 flex-1 text-xs text-muted"
              ellipsizeMode="head"
              numberOfLines={1}
            >
              {folder}
            </Text>
            <LineCounts additions={file.additions} deletions={file.deletions} />
          </Pressable>
        )
      })}
    </View>
  )
}

function DiffView({
  sessionId,
  file,
  version,
  onBack,
}: {
  sessionId: string
  file: ChangedFile
  version: number
  onBack: () => void
}) {
  const muted = useThemeColor("muted")
  const diff = useChangeDiff(sessionId, file, version)
  const lines = diff.data?.kind === "patch" ? diff.data.patch.split("\n") : null
  const note =
    diff.data?.kind === "binary"
      ? "This is a binary file."
      : diff.data?.kind === "too_large"
        ? "This diff is too large to show here."
        : diff.data?.kind === "restoring"
          ? "Restoring the session's files…"
          : diff.data && diff.data.kind !== "patch"
            ? "Couldn't read this file's changes."
            : diff.isError
              ? "Couldn't load the diff."
              : null

  return (
    <View className="flex-1">
      <Pressable
        accessibilityLabel="Back to all changes"
        accessibilityRole="button"
        className="min-h-11 flex-row items-center gap-two px-one active:opacity-60"
        onPress={onBack}
      >
        <HugeiconsIcon color={muted} icon={ArrowLeft01Icon} size={16} />
        <Text
          className="min-w-0 flex-1 text-[13px] text-foreground"
          numberOfLines={1}
        >
          {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        </Text>
        <LineCounts additions={file.additions} deletions={file.deletions} />
      </Pressable>
      {lines ? (
        <View className="mb-six flex-1 overflow-hidden rounded-lor-sm border border-border bg-surface-secondary">
          <BottomSheetFlatList
            contentContainerStyle={{ paddingVertical: 4 }}
            data={lines}
            keyExtractor={(_line: string, index: number) => String(index)}
            renderItem={({ item }: { item: string }) => (
              <Text
                className={`px-two font-mono text-[11px] leading-4 ${diffLineClass(item)}`}
              >
                {item || " "}
              </Text>
            )}
          />
        </View>
      ) : note ? (
        <Note>
          <Text className="text-center text-sm text-muted">{note}</Text>
        </Note>
      ) : (
        <Note>
          <Spinner />
        </Note>
      )}
    </View>
  )
}
