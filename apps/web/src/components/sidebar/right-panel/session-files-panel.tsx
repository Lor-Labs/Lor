import {
  ArrowRight01Icon,
  File01Icon,
  Folder01Icon,
  Folder02Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import { Reveal } from "@repo/ui/components/collapsible"
import { Spinner } from "@repo/ui/components/spinner"
import { cn } from "@repo/ui/lib/utils"
import { useEffect, useMemo, useRef, useState } from "react"
import { RightPanelHeader } from "@/components/sidebar/right-panel/right-panel-header"
import type { SessionFilesSidebarView } from "@/components/sidebar/right-panel/right-sidebar-types"
import {
  FolderGapNote,
  PanelNote,
  SessionPanelTabs,
  StatusMark,
  splitPath,
} from "@/components/sidebar/right-panel/session-changes-panel"
import {
  type ChangedFile,
  useRepoTree,
  useSessionChanges,
} from "@/hooks/use-session-changes"
import { fileTabId, useSessionTabs } from "@/hooks/use-session-tabs"
import { writeRepoFileDrag } from "@/lib/repo-file-reference"

// A code session's repository files: the tree read from the sandbox, changed
// files marked, and a click opening the file read-only in a tab beside the
// chat (reference/planned/code-sessions-runbook.md, Files tab).

type Status = ChangedFile["status"]

type TreeNode = {
  name: string
  path: string
  // Null for a file.
  children: Map<string, TreeNode> | null
}

const MAX_FILTER_RESULTS = 200
const INDENT_PX = 12

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

export function SessionFilesPanel({ view }: { view: SessionFilesSidebarView }) {
  const tree = useRepoTree(view.sessionId)
  const changes = useSessionChanges(view.sessionId)
  const tabs = useSessionTabs(view.sessionId)

  const statusByPath = useMemo(
    () =>
      new Map<string, Status>(
        changes.data?.state === "ready"
          ? changes.data.files.map((file) => [file.path, file.status])
          : []
      ),
    [changes.data]
  )

  const body = tree.isPending ? (
    <PanelNote>
      <Spinner className="size-4" />
    </PanelNote>
  ) : tree.isError ? (
    <PanelNote>
      Couldn't load the files.
      <Button size="xs" variant="outline" onClick={() => void tree.refetch()}>
        Try again
      </Button>
    </PanelNote>
  ) : tree.data.state !== "ready" ? (
    <FolderGapNote gap={tree.data.state} onRetry={() => void tree.refetch()} />
  ) : (
    <FileTree
      key={view.revealFolder?.id ?? view.sessionId}
      workspaceSlug={view.workspaceSlug}
      sessionId={view.sessionId}
      paths={tree.data.paths}
      truncated={tree.data.truncated}
      statusByPath={statusByPath}
      activeTab={tabs.active}
      folderPath={view.revealFolder?.path}
      onOpen={(path, preview) => tabs.open(fileTabId(path), { preview })}
    />
  )

  return (
    <div className="flex h-full w-full flex-col">
      <RightPanelHeader
        title={<SessionPanelTabs view={view} />}
        workspaceSlug={view.workspaceSlug}
        channelId={view.channelId}
        hideBack
      />
      {body}
    </div>
  )
}

function FileTree({
  workspaceSlug,
  sessionId,
  paths,
  truncated,
  statusByPath,
  activeTab,
  folderPath,
  onOpen,
}: {
  workspaceSlug: string
  sessionId: string
  paths: string[]
  truncated: boolean
  statusByPath: Map<string, Status>
  activeTab: string | null
  folderPath?: string
  onOpen: (path: string, preview: boolean) => void
}) {
  const [filter, setFilter] = useState("")
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const parts = folderPath?.split("/") ?? []
    return new Set(parts.map((_, index) => parts.slice(0, index + 1).join("/")))
  })
  const folderRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (folderPath) {
      folderRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" })
    }
  }, [folderPath])
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
  const matches = query
    ? paths
        .filter((path) => path.toLowerCase().includes(query))
        .slice(0, MAX_FILTER_RESULTS)
    : []

  const toggle = (path: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  const rowHighlight = (path: string) =>
    activeTab === fileTabId(path) || (!activeTab && path === folderPath)
      ? "bg-foreground/[0.06]"
      : "hover:bg-foreground/[0.04]"

  const renderLevel = (node: TreeNode, depth: number) =>
    sortedChildren(node).map((child) => {
      const isFolder = child.children !== null
      const open = isFolder && expanded.has(child.path)
      const status = statusByPath.get(child.path)
      return (
        <div key={child.path}>
          <button
            type="button"
            ref={isFolder && child.path === folderPath ? folderRef : undefined}
            draggable
            onDragStart={(event) =>
              writeRepoFileDrag(event.dataTransfer, {
                workspaceSlug,
                sessionId,
                path: child.path,
                kind: isFolder ? "folder" : "file",
              })
            }
            // A click opens a preview tab, a double click keeps it.
            onClick={() =>
              isFolder ? toggle(child.path) : onOpen(child.path, true)
            }
            onDoubleClick={
              isFolder ? undefined : () => onOpen(child.path, false)
            }
            aria-expanded={isFolder ? open : undefined}
            style={{ paddingLeft: 12 + depth * INDENT_PX }}
            className={cn(
              "flex h-7 w-full cursor-pointer items-center gap-1.5 pr-3 text-left text-[13px]",
              rowHighlight(child.path)
            )}
          >
            {isFolder ? (
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                className={cn(
                  "size-3 shrink-0 text-muted-foreground transition-transform",
                  open && "rotate-90"
                )}
                strokeWidth={2}
              />
            ) : (
              <span className="size-3 shrink-0" />
            )}
            <HugeiconsIcon
              icon={open ? Folder02Icon : isFolder ? Folder01Icon : File01Icon}
              className="size-3.5 shrink-0 text-muted-foreground"
              strokeWidth={2}
            />
            <span className="min-w-0 truncate">{child.name}</span>
            {status ? (
              <span className="ml-auto pl-2">
                <StatusMark status={status} />
              </span>
            ) : isFolder && changedFolders.has(child.path) ? (
              <span className="mr-1 ml-auto size-1.5 shrink-0 rounded-full bg-warning" />
            ) : null}
          </button>
          {isFolder && (
            <Reveal open={open}>{open && renderLevel(child, depth + 1)}</Reveal>
          )}
        </div>
      )
    })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <label className="flex h-10 shrink-0 items-center gap-2 border-border/70 border-b px-3">
        <HugeiconsIcon
          icon={Search01Icon}
          className="size-3.5 shrink-0 text-muted-foreground"
          strokeWidth={2}
        />
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter files"
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
        />
      </label>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {query ? (
          matches.length === 0 ? (
            <p className="px-3 py-6 text-center text-muted-foreground text-sm">
              No files match.
            </p>
          ) : (
            matches.map((path) => {
              const { name, folder } = splitPath(path)
              const status = statusByPath.get(path)
              return (
                <button
                  key={path}
                  type="button"
                  draggable
                  onDragStart={(event) =>
                    writeRepoFileDrag(event.dataTransfer, {
                      workspaceSlug,
                      sessionId,
                      path,
                    })
                  }
                  onClick={() => onOpen(path, true)}
                  onDoubleClick={() => onOpen(path, false)}
                  className={cn(
                    "flex h-7 w-full cursor-pointer items-center gap-2 px-3 text-left text-[13px]",
                    rowHighlight(path)
                  )}
                >
                  <span className="shrink-0">{name}</span>
                  {folder && (
                    <span className="min-w-0 truncate text-muted-foreground text-xs [direction:rtl]">
                      <bdi>{folder}</bdi>
                    </span>
                  )}
                  {status && (
                    <span className="ml-auto pl-2">
                      <StatusMark status={status} />
                    </span>
                  )}
                </button>
              )
            })
          )
        ) : (
          renderLevel(root, 0)
        )}
        {truncated && (
          <p className="px-3 py-2 text-muted-foreground text-xs">
            Showing the first 20,000 files.
          </p>
        )}
      </div>
    </div>
  )
}
