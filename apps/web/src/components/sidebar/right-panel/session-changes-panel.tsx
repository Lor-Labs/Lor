import {
  ArrowDown01Icon,
  GitBranchIcon,
  RefreshIcon,
  SparklesIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { getSingularPatch } from "@pierre/diffs"
import { FileDiff } from "@pierre/diffs/react"
import { Button } from "@repo/ui/components/button"
import { Checkbox } from "@repo/ui/components/checkbox"
import { Spinner } from "@repo/ui/components/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@repo/ui/components/tooltip"
import { cn } from "@repo/ui/lib/utils"
import { useQuery } from "@tanstack/react-query"
import { useTheme } from "next-themes"
import { type ReactNode, useMemo, useState } from "react"
import { RightPanelHeader } from "@/components/sidebar/right-panel/right-panel-header"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import type {
  SessionChangesSidebarView,
  SessionFilesSidebarView,
  SessionWorkSidebarView,
} from "@/components/sidebar/right-panel/right-sidebar-types"
import { useDiffHighlighterReady } from "@/hooks/use-diff-highlighter"
import {
  type ChangedFile,
  type ReadyChanges,
  sessionChangesQueryOptions,
  useChangeDiff,
  useCommitMessage,
  useSessionChanges,
  useStageChanges,
} from "@/hooks/use-session-changes"
import {
  CHANGES_TAB_ID,
  diffTabId,
  useSessionTabs,
} from "@/hooks/use-session-tabs"

// A code session's changes, laid out like Zed's git panel: one row per file
// with its line counts and a staging checkbox, a click opening its diff in a
// tab beside the chat, and the commit box at the bottom
// (reference/planned/code-sessions-runbook.md, chunk 3). Commit waits for
// GitHub sign-in (chunk 4).

const STATUS: Record<
  ChangedFile["status"],
  { label: string; className: string }
> = {
  modified: { label: "Modified", className: "text-warning" },
  added: { label: "Added", className: "text-success" },
  untracked: { label: "New, untracked", className: "text-success" },
  deleted: { label: "Deleted", className: "text-destructive" },
  renamed: { label: "Renamed", className: "text-info" },
  typechange: { label: "Type changed", className: "text-info" },
  conflicted: { label: "Conflict", className: "text-destructive" },
}

// Claude Code's look: tinted rows on the card color, no line numbers or
// +/- markers. Set inside the diff's shadow root, where the theme's own
// values would win over inherited ones.
export const DIFF_CSS = `:host {
  --diffs-light-bg: var(--card);
  --diffs-dark-bg: var(--card);
  --diffs-font-family: var(--font-mono);
  --diffs-font-size: 12.5px;
  --diffs-line-height: 20px;
}`

type SessionPanelView =
  | SessionWorkSidebarView
  | SessionChangesSidebarView
  | SessionFilesSidebarView

// Details | Changes, the title of a code session's panel. The count shows
// once the Changes view has read the sandbox.
export function SessionPanelTabs({ view }: { view: SessionPanelView }) {
  const { setView } = useRightSidebar()
  const { data } = useQuery({
    ...sessionChangesQueryOptions(view.sessionId),
    enabled: false,
  })
  const count = data?.state === "ready" ? data.files.length : 0
  const tabs = [
    { type: "session-work", label: "Details" },
    { type: "session-changes", label: "Changes" },
    { type: "session-files", label: "Files" },
  ] as const
  return (
    <div className="flex items-center gap-1">
      {tabs.map((tab) => (
        <button
          key={tab.type}
          type="button"
          aria-pressed={view.type === tab.type}
          onClick={() => setView({ ...view, type: tab.type })}
          className={cn(
            "flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors",
            view.type === tab.type
              ? "bg-foreground/[0.06] font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {tab.label}
          {tab.type === "session-changes" && count > 0 && (
            <span className="text-muted-foreground text-xs tabular-nums">
              {count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

export function SessionChangesPanel({
  view,
}: {
  view: SessionChangesSidebarView
}) {
  const changes = useSessionChanges(view.sessionId)

  const body = changes.isPending ? (
    <PanelNote>
      <Spinner className="size-4" />
    </PanelNote>
  ) : changes.isError ? (
    <PanelNote>
      Couldn't load the changes.
      <Button
        size="xs"
        variant="outline"
        onClick={() => void changes.refetch()}
      >
        Try again
      </Button>
    </PanelNote>
  ) : changes.data.state === "gone" ? (
    <PanelNote>
      This session's sandbox no longer exists, so its changes are gone.
    </PanelNote>
  ) : (
    <ChangesView sessionId={view.sessionId} changes={changes.data} />
  )

  return (
    <div className="flex h-full w-full flex-col">
      <RightPanelHeader
        title={<SessionPanelTabs view={view} />}
        workspaceSlug={view.workspaceSlug}
        channelId={view.channelId}
        hideBack
        actions={
          <button
            type="button"
            aria-label="Refresh changes"
            onClick={() => void changes.refetch()}
            className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <HugeiconsIcon
              icon={RefreshIcon}
              className={cn("size-4", changes.isFetching && "animate-spin")}
              strokeWidth={2}
            />
          </button>
        }
      />
      {body}
    </div>
  )
}

export function PanelNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

export function changeTotals(files: ChangedFile[]) {
  return files.reduce(
    (sum, file) => ({
      additions: sum.additions + (file.additions ?? 0),
      deletions: sum.deletions + (file.deletions ?? 0),
    }),
    { additions: 0, deletions: 0 }
  )
}

// Fully staged, partly staged (some hunks), or not staged.
function stagedState(file: ChangedFile): "all" | "some" | "none" {
  if (!file.staged) return "none"
  return file.unstaged ? "some" : "all"
}

function ChangesView({
  sessionId,
  changes,
}: {
  sessionId: string
  changes: ReadyChanges
}) {
  const stage = useStageChanges(sessionId)
  const tabs = useSessionTabs(sessionId)
  const locked = changes.lorWorking
  const tracked = changes.files.filter((file) => file.status !== "untracked")
  const untracked = changes.files.filter((file) => file.status === "untracked")
  const allStaged =
    changes.files.length > 0 &&
    changes.files.every((file) => stagedState(file) === "all")
  const totals = changeTotals(changes.files)
  const stagedCount = changes.files.filter((file) => file.staged).length
  const setStaged = (files: ChangedFile[], staged: boolean) =>
    stage.mutate({
      paths: files.flatMap((file) =>
        file.oldPath ? [file.oldPath, file.path] : [file.path]
      ),
      staged,
    })
  const groupProps = {
    locked,
    activeTab: tabs.active,
    onToggleGroup: setStaged,
    onOpen: (path: string, preview: boolean) =>
      tabs.open(diffTabId(path), { preview }),
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-border/70 border-b px-3 text-[13px]">
        <span className="text-muted-foreground">
          {changes.files.length} {changes.files.length === 1 ? "file" : "files"}
        </span>
        <LineCounts additions={totals.additions} deletions={totals.deletions} />
        {changes.files.length > 0 && (
          <>
            <Button
              size="xs"
              variant="ghost"
              className="ml-auto"
              onClick={() => tabs.open(CHANGES_TAB_ID, { preview: false })}
            >
              View all
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={locked}
              onClick={() => stage.mutate({ all: true, staged: !allStaged })}
            >
              {allStaged ? "Unstage all" : "Stage all"}
            </Button>
          </>
        )}
      </div>
      {locked && (
        <p className="shrink-0 border-border/70 border-b bg-agent/5 px-3 py-2 text-agent text-xs">
          Lor is working. Staging waits until it finishes.
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {changes.files.length === 0 ? (
          <p className="px-3 py-8 text-center text-muted-foreground text-sm">
            No changes yet. Lor's edits show up here as it works.
          </p>
        ) : (
          <>
            <FileGroup title="Tracked" files={tracked} {...groupProps} />
            <FileGroup title="Untracked" files={untracked} {...groupProps} />
            {changes.truncated && (
              <p className="px-3 py-2 text-muted-foreground text-xs">
                Showing the first 1,000 files.
              </p>
            )}
          </>
        )}
      </div>
      <CommitBox
        sessionId={sessionId}
        stagedCount={stagedCount}
        changes={changes}
      />
    </div>
  )
}

function FileGroup({
  title,
  files,
  locked,
  activeTab,
  onToggleGroup,
  onOpen,
}: {
  title: string
  files: ChangedFile[]
  locked: boolean
  activeTab: string | null
  onToggleGroup: (files: ChangedFile[], staged: boolean) => void
  onOpen: (path: string, preview: boolean) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  if (files.length === 0) return null
  const states = new Set(files.map(stagedState))
  const groupState =
    states.size === 1 && states.has("all")
      ? "all"
      : states.size === 1 && states.has("none")
        ? "none"
        : "some"
  return (
    <section>
      <div className="flex h-8 items-center gap-1.5 pr-3 pl-2 text-muted-foreground text-xs">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left hover:text-foreground"
        >
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className={cn(
              "size-3.5 shrink-0 transition-transform",
              collapsed && "-rotate-90"
            )}
            strokeWidth={2}
          />
          <span className="font-medium">{title}</span>
          <span className="rounded bg-foreground/[0.06] px-1.5 tabular-nums">
            {files.length}
          </span>
        </button>
        <Checkbox
          checked={groupState === "all"}
          indeterminate={groupState === "some"}
          disabled={locked}
          onCheckedChange={() => onToggleGroup(files, groupState !== "all")}
          aria-label={`${groupState === "all" ? "Unstage" : "Stage"} all ${title.toLowerCase()} files`}
        />
      </div>
      {!collapsed &&
        files.map((file) => (
          <FileRow
            key={file.path}
            file={file}
            locked={locked}
            selected={activeTab === diffTabId(file.path)}
            onOpen={(preview) => onOpen(file.path, preview)}
            onToggle={(staged) => onToggleGroup([file], staged)}
          />
        ))}
    </section>
  )
}

export function splitPath(path: string) {
  const slash = path.lastIndexOf("/")
  return {
    name: path.slice(slash + 1),
    folder: slash > 0 ? path.slice(0, slash) : "",
  }
}

export function StatusMark({ status }: { status: ChangedFile["status"] }) {
  const { label, className } = STATUS[status]
  return (
    <span
      title={label}
      className={cn(
        "flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border-[1.5px] border-current",
        className
      )}
    >
      <span className="size-1 rounded-full bg-current" />
    </span>
  )
}

export function LineCounts({
  additions,
  deletions,
  className,
}: {
  additions: number | null
  deletions: number | null
  className?: string
}) {
  if (!(additions || deletions)) return null
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1.5 font-mono text-xs tabular-nums",
        className
      )}
    >
      {additions ? <span className="text-success">+{additions}</span> : null}
      {deletions ? (
        <span className="text-destructive">−{deletions}</span>
      ) : null}
    </span>
  )
}

export function StageCheckbox({
  file,
  locked,
  onToggle,
}: {
  file: ChangedFile
  locked: boolean
  onToggle: (staged: boolean) => void
}) {
  const state = stagedState(file)
  return (
    <Checkbox
      checked={state === "all"}
      indeterminate={state === "some"}
      disabled={locked || file.status === "conflicted"}
      onCheckedChange={() => onToggle(state !== "all")}
      aria-label={`${state === "all" ? "Unstage" : "Stage"} ${file.path}`}
    />
  )
}

function FileRow({
  file,
  locked,
  selected,
  onOpen,
  onToggle,
}: {
  file: ChangedFile
  locked: boolean
  // Its diff is the active tab.
  selected: boolean
  onOpen: (preview: boolean) => void
  onToggle: (staged: boolean) => void
}) {
  const { name, folder } = splitPath(file.path)
  return (
    <div
      className={cn(
        "flex h-7 items-center gap-2 pr-3",
        selected ? "bg-foreground/[0.06]" : "hover:bg-foreground/[0.04]"
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(true)}
        onDoubleClick={() => onOpen(false)}
        title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 pl-3 text-left text-[13px]"
      >
        <StatusMark status={file.status} />
        <span
          className={cn(
            "shrink-0",
            file.status === "deleted" && "text-muted-foreground line-through"
          )}
        >
          {name}
        </span>
        {folder && (
          // Truncates from the start, so the nearest folders stay visible.
          <span className="min-w-0 truncate text-muted-foreground text-xs [direction:rtl]">
            <bdi>{folder}</bdi>
          </span>
        )}
        <LineCounts
          additions={file.additions}
          deletions={file.deletions}
          className="ml-auto pl-2"
        />
      </button>
      <StageCheckbox file={file} locked={locked} onToggle={onToggle} />
    </div>
  )
}

export function ChangeDiff({
  sessionId,
  file,
  version,
  framed = true,
}: {
  sessionId: string
  file: ChangedFile
  version: number
  // False when the caller draws the card (the All changes tab).
  framed?: boolean
}) {
  const { resolvedTheme } = useTheme()
  const diff = useChangeDiff(sessionId, file, version)
  const highlighterReady = useDiffHighlighterReady(file.path)
  const patch = diff.data?.kind === "patch" ? diff.data.patch : null
  // A patch with no hunks (a mode change) or one the parser rejects shows
  // as text instead.
  const fileDiff = useMemo(() => {
    if (!patch?.trim()) return null
    try {
      return getSingularPatch(patch)
    } catch {
      return null
    }
  }, [patch])

  if (diff.isPending || !highlighterReady) {
    return (
      <PanelNote>
        <Spinner className="size-4" />
      </PanelNote>
    )
  }
  if (diff.isError) return <PanelNote>Couldn't load the diff.</PanelNote>
  if (diff.data.kind === "binary") {
    return <PanelNote>Binary file: no text diff.</PanelNote>
  }
  if (diff.data.kind === "too_large") {
    return <PanelNote>This diff is too large to show.</PanelNote>
  }
  if (diff.data.kind === "gone") {
    return <PanelNote>The sandbox no longer exists.</PanelNote>
  }
  if (!patch?.trim()) {
    return <PanelNote>No changes to the file's text.</PanelNote>
  }
  return (
    <div
      className={
        framed
          ? "m-3 overflow-hidden rounded-lg border border-border/70 bg-card py-1.5"
          : "py-1.5"
      }
    >
      {fileDiff ? (
        <FileDiff
          fileDiff={fileDiff}
          options={{
            themeType: resolvedTheme === "dark" ? "dark" : "light",
            diffStyle: "unified",
            diffIndicators: "none",
            disableLineNumbers: true,
            hunkSeparators: "simple",
            lineDiffType: "none",
            overflow: "scroll",
            disableFileHeader: true,
            unsafeCSS: DIFF_CSS,
          }}
        />
      ) : (
        <pre className="px-3 py-1.5 font-mono text-xs">{patch}</pre>
      )}
    </div>
  )
}

// Flat, like Zed's git panel: the message flush under a hairline, then one
// quiet row with the branch, ✨ and Commit.
function CommitBox({
  sessionId,
  stagedCount,
  changes,
}: {
  sessionId: string
  stagedCount: number
  changes: ReadyChanges
}) {
  const [message, setMessage] = useState("")
  const generate = useCommitMessage(sessionId)
  const unpushed = changes.commits.length
  return (
    <div className="shrink-0 border-border/70 border-t">
      <textarea
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder="Enter commit message"
        aria-label="Commit message"
        className="field-sizing-content block max-h-48 min-h-20 w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-[13px] leading-5 outline-none placeholder:text-muted-foreground"
      />
      <div className="flex h-10 items-center gap-1.5 pr-2 pl-3 text-muted-foreground text-xs">
        <HugeiconsIcon
          icon={GitBranchIcon}
          className="size-3.5 shrink-0"
          strokeWidth={2}
        />
        <span className="min-w-0 truncate">
          {changes.branch ?? "detached HEAD"}
        </span>
        {changes.branch !== changes.baseBranch && (
          <span className="shrink-0">from {changes.baseBranch}</span>
        )}
        {unpushed > 0 && (
          <span className="shrink-0">· {unpushed} unpushed</span>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="Write a commit message"
                // aria-disabled, not disabled: the tooltip still explains why.
                aria-disabled={stagedCount === 0}
                disabled={generate.isPending}
                onClick={() =>
                  stagedCount > 0 &&
                  generate.mutate(undefined, { onSuccess: setMessage })
                }
                className="ml-auto flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-foreground/5 hover:text-agent aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted-foreground"
              />
            }
          >
            {generate.isPending ? (
              <Spinner className="size-3.5" />
            ) : (
              <HugeiconsIcon
                icon={SparklesIcon}
                className="size-4"
                strokeWidth={2}
              />
            )}
          </TooltipTrigger>
          <TooltipContent>
            {stagedCount === 0
              ? "Stage changes to write a message"
              : "Write a message from the staged changes"}
          </TooltipContent>
        </Tooltip>
        {/* Stub until chunk 4: commits are made under the person's GitHub
            account, so they wait for GitHub sign-in. */}
        <Tooltip>
          <TooltipTrigger render={<span className="shrink-0" />}>
            <Button size="xs" variant="outline" disabled>
              {stagedCount > 0
                ? `Commit ${stagedCount} ${stagedCount === 1 ? "file" : "files"}`
                : "Commit"}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Committing comes with GitHub sign-in</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
