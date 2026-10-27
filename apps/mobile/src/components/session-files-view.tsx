import { BottomSheetFlatList, BottomSheetTextInput } from "@gorhom/bottom-sheet"
import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon"
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon"
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { Image } from "expo-image"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import { useMemo, useState } from "react"
import { Pressable, Text, View } from "react-native"
import {
  FolderNote,
  Note,
  STATUS,
  splitPath,
} from "@/components/code-drawer-parts"
import {
  type ChangedFile,
  repoImageSource,
  useRepoFile,
  useRepoTree,
} from "@/hooks/use-session-changes"

// The code drawer's Files tab: the repo's files read from the session's
// sandbox, changed files marked, and a file opening read-only. Mirrors web's
// session-files-panel.tsx.

type Status = ChangedFile["status"]

type TreeNode = {
  name: string
  path: string
  // Null for a file.
  children: Map<string, TreeNode> | null
}

type Row =
  | { kind: "node"; node: TreeNode; depth: number }
  | { kind: "match"; path: string }

const MAX_FILTER_RESULTS = 200
const INDENT = 14

function buildTree(paths: string[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: new Map() }
  for (const path of paths) {
    let node = root
    const parts = path.split("/")
    parts.forEach((name, index) => {
      const isFile = index === parts.length - 1
      let child = node.children?.get(name)
      if (!child) {
        child = {
          name,
          path: parts.slice(0, index + 1).join("/"),
          children: isFile ? null : new Map(),
        }
        node.children?.set(name, child)
      }
      node = child
    })
  }
  return root
}

const byName = new Intl.Collator(undefined, { numeric: true })

// Folders first, then files, by name.
function sortedChildren(node: TreeNode): TreeNode[] {
  return [...(node.children?.values() ?? [])].sort((a, b) =>
    a.children === null && b.children !== null
      ? 1
      : a.children !== null && b.children === null
        ? -1
        : byName.compare(a.name, b.name)
  )
}

// The rows on screen: each folder's children while it is open.
function visibleRows(node: TreeNode, expanded: Set<string>, depth = 0): Row[] {
  return sortedChildren(node).flatMap((child) => [
    { kind: "node" as const, node: child, depth },
    ...(child.children && expanded.has(child.path)
      ? visibleRows(child, expanded, depth + 1)
      : []),
  ])
}

export function SessionFilesView({
  sessionId,
  statusByPath,
}: {
  sessionId: string
  statusByPath: Map<string, Status>
}) {
  const tree = useRepoTree(sessionId, true)
  const [openPath, setOpenPath] = useState<string | null>(null)

  if (openPath) {
    return (
      <FileView
        onBack={() => setOpenPath(null)}
        path={openPath}
        sessionId={sessionId}
        status={statusByPath.get(openPath) ?? null}
      />
    )
  }
  const ready = tree.data?.state === "ready" ? tree.data : null
  const gap = tree.isPending
    ? "loading"
    : tree.isError
      ? "error"
      : tree.data.state === "ready"
        ? null
        : tree.data.state
  if (gap || !ready) {
    return (
      <FolderNote
        onRetry={() => void tree.refetch()}
        state={gap ?? "loading"}
        what="the files"
      />
    )
  }
  return (
    <FileTree
      onOpen={setOpenPath}
      paths={ready.paths}
      statusByPath={statusByPath}
      truncated={ready.truncated}
    />
  )
}

function FileTree({
  paths,
  truncated,
  statusByPath,
  onOpen,
}: {
  paths: string[]
  truncated: boolean
  statusByPath: Map<string, Status>
  onOpen: (path: string) => void
}) {
  const [accent, muted] = useThemeColor(["accent", "muted"])
  const [filter, setFilter] = useState("")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const root = useMemo(() => buildTree(paths), [paths])
  // A folder holding a changed file is marked too, so changes are findable
  // with the tree folded.
  const changedFolders = useMemo(() => {
    const folders = new Set<string>()
    for (const path of statusByPath.keys()) {
      const parts = path.split("/")
      for (let i = 1; i < parts.length; i++) {
        folders.add(parts.slice(0, i).join("/"))
      }
    }
    return folders
  }, [statusByPath])
  const query = filter.trim().toLowerCase()
  const rows = useMemo<Row[]>(
    () =>
      query
        ? paths
            .filter((path) => path.toLowerCase().includes(query))
            .slice(0, MAX_FILTER_RESULTS)
            .map((path) => ({ kind: "match", path }))
        : visibleRows(root, expanded),
    [query, paths, root, expanded]
  )
  const toggle = (path: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(path)) next.add(path)
      return next
    })

  const statusDot = (path: string, folder: boolean) => {
    const status = statusByPath.get(path)
    if (status) {
      return (
        <View className={`size-2 rounded-full ${STATUS[status].className}`} />
      )
    }
    return folder && changedFolders.has(path) ? (
      <View className="size-1.5 rounded-full bg-muted" />
    ) : null
  }

  const renderRow = ({ item }: { item: Row }) => {
    if (item.kind === "match") {
      const { name, folder } = splitPath(item.path)
      return (
        <Pressable
          accessibilityRole="button"
          className="min-h-11 flex-row items-center gap-two rounded-lor-sm px-one active:bg-surface-secondary"
          onPress={() => onOpen(item.path)}
        >
          <Text
            className="shrink-0 text-[15px] text-foreground"
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
          {statusDot(item.path, false)}
        </Pressable>
      )
    }
    const { node, depth } = item
    const folder = node.children !== null
    const open = folder && expanded.has(node.path)
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={folder ? { expanded: open } : undefined}
        className="min-h-10 flex-row items-center gap-two rounded-lor-sm pr-one active:bg-surface-secondary"
        onPress={() => (folder ? toggle(node.path) : onOpen(node.path))}
        style={{ paddingLeft: 4 + depth * INDENT }}
      >
        <View
          className="w-4 items-center"
          style={open ? { transform: [{ rotate: "90deg" }] } : undefined}
        >
          {folder ? (
            <HugeiconsIcon
              color={muted}
              icon={ArrowRight01Icon}
              size={14}
              strokeWidth={2}
            />
          ) : null}
        </View>
        <Text
          className={`min-w-0 flex-1 text-[15px] ${
            folder ? "font-medium text-foreground" : "text-foreground"
          }`}
          numberOfLines={1}
        >
          {node.name}
        </Text>
        {statusDot(node.path, folder)}
      </Pressable>
    )
  }

  return (
    <View className="flex-1">
      <View className="mx-one mb-two h-11 flex-row items-center gap-two rounded-lor-sm border border-border bg-surface-secondary px-three">
        <HugeiconsIcon color={muted} icon={Search01Icon} size={16} />
        <BottomSheetTextInput
          accessibilityLabel="Find a file"
          autoCapitalize="none"
          autoCorrect={false}
          className="h-full min-w-0 flex-1 p-0 text-[16px] text-foreground"
          onChangeText={setFilter}
          placeholder="Find a file"
          placeholderTextColor={muted}
          selectionColor={accent}
          value={filter}
        />
      </View>
      <BottomSheetFlatList
        contentContainerStyle={{ paddingBottom: 40 }}
        data={rows}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(row: Row) =>
          row.kind === "match" ? `match:${row.path}` : row.node.path
        }
        ListEmptyComponent={
          <Text className="px-three py-eight text-center text-sm text-muted">
            {query ? "No files match." : "This repository has no files yet."}
          </Text>
        }
        ListFooterComponent={
          truncated ? (
            <Text className="px-three py-two text-xs text-muted">
              Showing the first files only.
            </Text>
          ) : null
        }
        renderItem={renderRow}
      />
    </View>
  )
}

function FileView({
  sessionId,
  path,
  status,
  onBack,
}: {
  sessionId: string
  path: string
  status: Status | null
  onBack: () => void
}) {
  const muted = useThemeColor("muted")
  const file = useRepoFile(sessionId, path)
  const [imageFailed, setImageFailed] = useState(false)
  const lines =
    file.data?.kind === "text" ? file.data.content.split("\n") : null
  const note =
    file.data?.kind === "binary"
      ? "This is a binary file."
      : file.data?.kind === "too_large"
        ? "This file is too large to show here."
        : file.data?.kind === "missing"
          ? "This file isn't in the repository anymore."
          : file.data?.kind === "preparing"
            ? "Setting up the session's files…"
            : file.data?.kind === "restoring"
              ? "Restoring the session's files…"
              : file.data?.kind === "gone" ||
                  file.data?.kind === "restore_failed"
                ? "Couldn't read this file."
                : file.isError
                  ? "Couldn't load the file."
                  : null
  const digits = String(lines?.length ?? 0).length

  return (
    <View className="flex-1">
      <Pressable
        accessibilityLabel="Back to the files"
        accessibilityRole="button"
        className="min-h-11 flex-row items-center gap-two px-one active:opacity-60"
        onPress={onBack}
      >
        <HugeiconsIcon color={muted} icon={ArrowLeft01Icon} size={16} />
        <Text
          className="min-w-0 flex-1 text-[13px] text-foreground"
          ellipsizeMode="head"
          numberOfLines={1}
        >
          {path}
        </Text>
        {status ? (
          <Text className="text-xs text-muted">{STATUS[status].label}</Text>
        ) : null}
      </Pressable>
      {lines ? (
        <View className="mb-six flex-1 overflow-hidden rounded-lor-sm border border-border bg-surface-secondary">
          <BottomSheetFlatList
            contentContainerStyle={{ paddingVertical: 4 }}
            data={lines}
            keyExtractor={(_line: string, index: number) => String(index)}
            renderItem={({ item, index }: { item: string; index: number }) => (
              <View className="flex-row">
                <Text
                  className="pl-two pr-two text-right font-mono text-[11px] leading-4 text-muted opacity-60"
                  style={{ minWidth: 16 + digits * 7 }}
                >
                  {index + 1}
                </Text>
                <Text className="min-w-0 flex-1 pr-two font-mono text-[11px] leading-4 text-foreground">
                  {item || " "}
                </Text>
              </View>
            )}
          />
        </View>
      ) : file.data?.kind === "image" && imageFailed ? (
        <Note>
          <Text className="text-center text-sm text-muted">
            Couldn't load the image.
          </Text>
        </Note>
      ) : file.data?.kind === "image" ? (
        <View className="mb-six flex-1 overflow-hidden rounded-lor-sm border border-border bg-surface-secondary p-four">
          <Image
            accessibilityLabel={path}
            contentFit="contain"
            onError={() => setImageFailed(true)}
            source={repoImageSource(sessionId, path)}
            style={{ flex: 1 }}
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
