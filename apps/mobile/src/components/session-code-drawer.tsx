import {
  BottomSheetFlatList,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet"
import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { BottomSheet } from "heroui-native/bottom-sheet"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import { useMemo, useState } from "react"
import { Pressable, Text, View } from "react-native"
import {
  KeyboardController,
  useKeyboardState,
} from "react-native-keyboard-controller"
import {
  FolderNote,
  LineCounts,
  Note,
  STATUS,
  splitPath,
} from "@/components/code-drawer-parts"
import { diffLineClass } from "@/components/lor-tool-trail"
import { SessionCommitBox } from "@/components/session-commit-box"
import { SessionFilesView } from "@/components/session-files-view"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs } from "@/components/ui/tabs"
import {
  type ChangedFile,
  changeTotals,
  type ReadyChanges,
  useChangeDiff,
  useSessionChanges,
  useStageChanges,
} from "@/hooks/use-session-changes"

// A code session's drawer: the files Lor and people changed in the session's
// sandbox with their diffs, and the repo's files. Mirrors web's Changes and
// Files panels (session-changes-panel.tsx, session-files-panel.tsx).

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
  const keyboardVisible = useKeyboardState((state) => state.isVisible)
  const [tab, setTab] = useState<"changes" | "files">("changes")
  // The file whose diff is open; null shows the list.
  const [openPath, setOpenPath] = useState<string | null>(null)
  const ready = changes.data?.state === "ready" ? changes.data : null
  const openFile = ready?.files.find((file) => file.path === openPath) ?? null
  // Changed files are marked in the Files tab.
  const statusByPath = useMemo(
    () =>
      new Map<string, ChangedFile["status"]>(
        ready?.files.map((file) => [file.path, file.status])
      ),
    [ready]
  )

  const changesGap = changes.isPending
    ? "loading"
    : changes.isError
      ? "error"
      : changes.data.state === "ready"
        ? null
        : changes.data.state
  const changesBody = changesGap ? (
    <FolderNote
      onRetry={() => void changes.refetch()}
      state={changesGap}
      what="the changes"
    />
  ) : !ready ? null : openFile ? (
    <DiffView
      file={openFile}
      onBack={() => setOpenPath(null)}
      sessionId={sessionId}
      version={changes.dataUpdatedAt}
    />
  ) : (
    <ChangesList changes={ready} onOpen={setOpenPath} sessionId={sessionId} />
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
          // Its lists scroll only inside a bounded content container
          // (HeroUI's bottom-sheet docs, "Scrollable with Snap Points").
          contentContainerClassName="h-full"
          enableDynamicSizing={false}
          enableOverDrag={false}
          // The commit message's keyboard lifts the sheet's foot; the home
          // indicator's padding goes while the keyboard covers it.
          contentContainerProps={
            keyboardVisible ? { style: { paddingBottom: 0 } } : undefined
          }
          keyboardBehavior="interactive"
          keyboardBlurBehavior="restore"
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
            <Tabs
              className="flex-1"
              onValueChange={(value) =>
                setTab(value === "files" ? "files" : "changes")
              }
              value={tab}
            >
              <Tabs.List className="self-start">
                <Tabs.Indicator />
                <Tabs.Trigger value="changes">
                  <Tabs.Label>Changes</Tabs.Label>
                </Tabs.Trigger>
                <Tabs.Trigger value="files">
                  <Tabs.Label>Files</Tabs.Label>
                </Tabs.Trigger>
              </Tabs.List>
            </Tabs>
            <BottomSheet.Close />
          </View>
          {tab === "changes" ? (
            changesBody
          ) : (
            <SessionFilesView
              sessionId={sessionId}
              statusByPath={statusByPath}
            />
          )}
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  )
}

// Fully staged; a partly staged file (some hunks) reads as not staged, and
// a tap stages all of it.
function isStaged(file: ChangedFile) {
  return file.staged && !file.unstaged
}

function ChangesList({
  sessionId,
  changes,
  onOpen,
}: {
  sessionId: string
  changes: ReadyChanges
  onOpen: (path: string) => void
}) {
  const stage = useStageChanges(sessionId)
  const totals = changeTotals(changes.files)
  const tracked = changes.files.filter((file) => file.status !== "untracked")
  const untracked = changes.files.filter((file) => file.status === "untracked")
  const allStaged =
    changes.files.length > 0 && changes.files.every((file) => isStaged(file))
  const stagedCount = changes.files.filter((file) => file.staged).length
  const groupProps = {
    locked: changes.lorWorking,
    onOpen,
    // A rename stages both its old and new path.
    onToggle: (file: ChangedFile, staged: boolean) =>
      stage.mutate({
        paths: file.oldPath ? [file.oldPath, file.path] : [file.path],
        staged,
      }),
  }
  return (
    <View className="flex-1">
      <BottomSheetScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 16 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="min-h-9 flex-row items-center gap-two px-one pb-two">
          <Text className="text-[13px] text-muted">
            {changes.files.length}{" "}
            {changes.files.length === 1 ? "file" : "files"}
          </Text>
          <LineCounts
            additions={totals.additions}
            deletions={totals.deletions}
          />
          {changes.files.length > 0 ? (
            <Button
              className="ml-auto"
              isDisabled={changes.lorWorking}
              onPress={() => stage.mutate({ all: true, staged: !allStaged })}
              size="sm"
              variant="ghost"
            >
              {allStaged ? "Unstage all" : "Stage all"}
            </Button>
          ) : null}
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
            <FileGroup files={tracked} title="Tracked" {...groupProps} />
            <FileGroup files={untracked} title="Untracked" {...groupProps} />
            {changes.truncated ? (
              <Text className="px-three py-two text-xs text-muted">
                Showing the first 1,000 files.
              </Text>
            ) : null}
          </>
        )}
      </BottomSheetScrollView>
      <SessionCommitBox
        changes={changes}
        sessionId={sessionId}
        stagedCount={stagedCount}
      />
    </View>
  )
}

function FileGroup({
  title,
  files,
  locked,
  onOpen,
  onToggle,
}: {
  title: string
  files: ChangedFile[]
  locked: boolean
  onOpen: (path: string) => void
  onToggle: (file: ChangedFile, staged: boolean) => void
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
        const staged = isStaged(file)
        return (
          <View className="flex-row items-center" key={file.path}>
            <Pressable
              accessibilityHint="Shows its changes"
              accessibilityLabel={`${file.path}, ${status.label}`}
              accessibilityRole="button"
              className="min-h-11 min-w-0 flex-1 flex-row items-center gap-two rounded-lor-sm px-one active:bg-surface-secondary"
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
              <LineCounts
                additions={file.additions}
                deletions={file.deletions}
              />
            </Pressable>
            {/* Staging a conflicted file marks it fixed (git add), which a
                pull's merge needs before Commit. */}
            <Pressable
              accessibilityLabel={`${staged ? "Unstage" : "Stage"} ${file.path}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: staged, disabled: locked }}
              className="min-h-11 items-center justify-center pl-two pr-one"
              disabled={locked}
              hitSlop={6}
              onPress={() => onToggle(file, !staged)}
            >
              <View pointerEvents="none">
                <Checkbox
                  // className="border border-border"
                  isDisabled={locked}
                  isSelected={staged}
                  variant="secondary"
                />
              </View>
            </Pressable>
          </View>
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
