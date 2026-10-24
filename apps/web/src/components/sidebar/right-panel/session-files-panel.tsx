import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  File01Icon,
  Folder01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { File as CodeFile } from "@pierre/diffs/react"
import { Button } from "@repo/ui/components/button"
import { Spinner } from "@repo/ui/components/spinner"
import { cn } from "@repo/ui/lib/utils"
import { useTheme } from "next-themes"
import { useEffect, useMemo, useState } from "react"
import { RightPanelHeader } from "@/components/sidebar/right-panel/right-panel-header"
import type { SessionFilesSidebarView } from "@/components/sidebar/right-panel/right-sidebar-types"
import {
  DIFF_CSS,
  PanelNote,
  SessionPanelTabs,
  StatusMark,
  splitPath,
} from "@/components/sidebar/right-panel/session-changes-panel"
import { useDiffHighlighterReady } from "@/hooks/use-diff-highlighter"
import {
  type ChangedFile,
  useLiveSessionChanges,
  useRepoFile,
  useRepoTree,
  useSessionChanges,
} from "@/hooks/use-session-changes"

// A code session's repository files: the tree read from the sandbox, changed
// files marked, and a file opening read-only over the list
// (reference/planned/code-sessions-runbook.md, Files tab).

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
  useLiveSessionChanges(view.sessionId, view.threadRootId)
  const [openPath, setOpenPath] = useState<string | null>(null)

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
  ) : tree.data.state === "gone" ? (
    <PanelNote>
      This session's sandbox no longer exists, so its files are gone.
    </PanelNote>
  ) : openPath ? (
    <FileView
      sessionId={view.sessionId}
      path={openPath}
      status={statusByPath.get(openPath) ?? null}
      onBack={() => setOpenPath(null)}
    />
  ) : (
    <FileTree
      paths={tree.data.paths}
      truncated={tree.data.truncated}
      statusByPath={statusByPath}
      onOpen={setOpenPath}
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
  const [filter, setFilter] = useState("")
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
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

  const renderLevel = (node: TreeNode, depth: number) =>
    sortedChildren(node).map((child) => {
      const isFolder = child.children !== null
      const open = isFolder && expanded.has(child.path)
      const status = statusByPath.get(child.path)
      return (
        <div key={child.path}>
          <button
            type="button"
            onClick={() => (isFolder ? toggle(child.path) : onOpen(child.path))}
            aria-expanded={isFolder ? open : undefined}
            style={{ paddingLeft: 12 + depth * INDENT_PX }}
            className="flex h-7 w-full cursor-pointer items-center gap-1.5 pr-3 text-left text-[13px] hover:bg-foreground/[0.04]"
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
              icon={isFolder ? Folder01Icon : File01Icon}
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
          {open && renderLevel(child, depth + 1)}
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
                  onClick={() => onOpen(path)}
                  className="flex h-7 w-full cursor-pointer items-center gap-2 px-3 text-left text-[13px] hover:bg-foreground/[0.04]"
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

// One file, read-only, over the tree; Escape or the arrow goes back.
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
  const { resolvedTheme } = useTheme()
  const file = useRepoFile(sessionId, path)
  const highlighterReady = useDiffHighlighterReady(path)
  const { name, folder } = splitPath(path)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onBack()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onBack])

  const body =
    file.isPending || !highlighterReady ? (
      <PanelNote>
        <Spinner className="size-4" />
      </PanelNote>
    ) : file.isError ? (
      <PanelNote>Couldn't load the file.</PanelNote>
    ) : file.data.kind === "binary" ? (
      <PanelNote>Binary file: no text to show.</PanelNote>
    ) : file.data.kind === "too_large" ? (
      <PanelNote>This file is too large to show.</PanelNote>
    ) : file.data.kind === "missing" ? (
      <PanelNote>This file no longer exists.</PanelNote>
    ) : file.data.kind === "gone" ? (
      <PanelNote>The sandbox no longer exists.</PanelNote>
    ) : (
      <div className="m-3 overflow-hidden rounded-lg border border-border/70 bg-card py-1.5">
        <CodeFile
          file={{ name: path, contents: file.data.content }}
          options={{
            themeType: resolvedTheme === "dark" ? "dark" : "light",
            overflow: "scroll",
            disableFileHeader: true,
            unsafeCSS: DIFF_CSS,
          }}
        />
      </div>
    )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-border/70 border-b pr-3 pl-1.5 text-[13px]">
        <button
          type="button"
          aria-label="Back to files"
          onClick={onBack}
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
        >
          <HugeiconsIcon
            icon={ArrowLeft01Icon}
            className="size-4"
            strokeWidth={2}
          />
        </button>
        {status && <StatusMark status={status} />}
        <span className="shrink-0 font-medium">{name}</span>
        {folder && (
          <span className="min-w-0 truncate text-muted-foreground text-xs [direction:rtl]">
            <bdi>{folder}</bdi>
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{body}</div>
    </div>
  )
}
