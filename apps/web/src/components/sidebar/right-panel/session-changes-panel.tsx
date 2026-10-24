import {
  ArrowRight01Icon,
  GitBranchIcon,
  GitCommitIcon,
  RefreshIcon,
  SparklesIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { getSingularPatch } from "@pierre/diffs"
import { FileDiff } from "@pierre/diffs/react"
import { Button } from "@repo/ui/components/button"
import { Checkbox } from "@repo/ui/components/checkbox"
import { Spinner } from "@repo/ui/components/spinner"
import { Textarea } from "@repo/ui/components/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@repo/ui/components/tooltip"
import { cn } from "@repo/ui/lib/utils"
import { useTheme } from "next-themes"
import { type ReactNode, useMemo, useState } from "react"
import { RightPanelHeader } from "@/components/sidebar/right-panel/right-panel-header"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import type {
  SessionChangesSidebarView,
  SessionWorkSidebarView,
} from "@/components/sidebar/right-panel/right-sidebar-types"
import { useDiffHighlighterReady } from "@/hooks/use-diff-highlighter"
import {
  type ChangedFile,
  type ReadyChanges,
  useChangeDiff,
  useCommitMessage,
  useLiveSessionChanges,
  useSessionChanges,
  useStageChanges,
} from "@/hooks/use-session-changes"

// A code session's changes, IDE-style: what changed against the base branch,
// staged or not, with diffs and a commit box
// (reference/planned/code-sessions-runbook.md, chunk 3). Commit waits for
// GitHub sign-in (chunk 4).

const STATUS: Record<
  ChangedFile["status"],
  { letter: string; label: string; className: string }
> = {
  modified: { letter: "M", label: "Modified", className: "text-warning" },
  added: { letter: "A", label: "Added", className: "text-success" },
  untracked: {
    letter: "U",
    label: "New, untracked",
    className: "text-success",
  },
  deleted: { letter: "D", label: "Deleted", className: "text-destructive" },
  renamed: { letter: "R", label: "Renamed", className: "text-info" },
  typechange: { letter: "T", label: "Type changed", className: "text-info" },
  conflicted: { letter: "!", label: "Conflict", className: "text-destructive" },
}

type SessionPanelView = SessionWorkSidebarView | SessionChangesSidebarView

// Details | Changes, the title of a code session's panel.
export function SessionPanelTabs({ view }: { view: SessionPanelView }) {
  const { setView } = useRightSidebar()
  const tabs = [
    { type: "session-work", label: "Details" },
    { type: "session-changes", label: "Changes" },
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
            "cursor-pointer rounded-md px-2 py-1 text-sm transition-colors",
            view.type === tab.type
              ? "bg-foreground/[0.06] font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {tab.label}
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
  useLiveSessionChanges(view.sessionId, view.threadRootId)

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
    <ChangesList
      sessionId={view.sessionId}
      changes={changes.data}
      version={changes.dataUpdatedAt}
    />
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

function PanelNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

function ChangesList({
  sessionId,
  changes,
  version,
}: {
  sessionId: string
  changes: ReadyChanges
  version: number
}) {
  const stage = useStageChanges(sessionId)
  const staged = changes.files.filter((file) => file.staged)
  const unstaged = changes.files.filter((file) => file.unstaged)
  const locked = changes.lorWorking
  const toggle = (file: ChangedFile, toStaged: boolean) =>
    stage.mutate({
      paths: file.oldPath ? [file.oldPath, file.path] : [file.path],
      staged: toStaged,
    })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="mb-3 flex flex-wrap items-center gap-x-1.5 px-2 text-muted-foreground text-xs">
          <HugeiconsIcon
            icon={GitBranchIcon}
            className="size-3.5"
            strokeWidth={2}
          />
          <span className="font-medium text-foreground">
            {changes.branch ?? "detached HEAD"}
          </span>
          <span>from {changes.baseBranch}</span>
        </div>
        {locked && (
          <p className="mb-3 rounded-md bg-agent/10 px-3 py-2 text-agent text-xs">
            Lor is working. Staging waits until it finishes.
          </p>
        )}
        {changes.commits.length > 0 && (
          <Section title="Commits" count={changes.commits.length}>
            {changes.commits.map((commit) => (
              <div
                key={commit.sha}
                className="flex items-center gap-2 px-2 py-1 text-[13px]"
              >
                <HugeiconsIcon
                  icon={GitCommitIcon}
                  className="size-3.5 shrink-0 text-muted-foreground"
                  strokeWidth={2}
                />
                <span className="min-w-0 truncate">{commit.subject}</span>
                <span className="ml-auto shrink-0 font-mono text-muted-foreground text-xs">
                  {commit.sha.slice(0, 7)}
                </span>
              </div>
            ))}
          </Section>
        )}
        {changes.files.length === 0 ? (
          <p className="px-2 py-6 text-center text-muted-foreground text-sm">
            No changes yet. Lor's edits show up here as it works.
          </p>
        ) : (
          <>
            {staged.length > 0 && (
              <Section
                title="Staged"
                count={staged.length}
                action={
                  <SectionAction
                    disabled={locked}
                    onClick={() => stage.mutate({ all: true, staged: false })}
                  >
                    Unstage all
                  </SectionAction>
                }
              >
                {staged.map((file) => (
                  <FileRow
                    key={`staged:${file.path}`}
                    sessionId={sessionId}
                    file={file}
                    staged
                    version={version}
                    disabled={locked}
                    onToggle={toggle}
                  />
                ))}
              </Section>
            )}
            {unstaged.length > 0 && (
              <Section
                title="Changes"
                count={unstaged.length}
                action={
                  <SectionAction
                    disabled={locked}
                    onClick={() => stage.mutate({ all: true, staged: true })}
                  >
                    Stage all
                  </SectionAction>
                }
              >
                {unstaged.map((file) => (
                  <FileRow
                    key={`unstaged:${file.path}`}
                    sessionId={sessionId}
                    file={file}
                    staged={false}
                    version={version}
                    disabled={locked}
                    onToggle={toggle}
                  />
                ))}
              </Section>
            )}
            {changes.truncated && (
              <p className="px-2 py-2 text-muted-foreground text-xs">
                Showing the first 1,000 files.
              </p>
            )}
          </>
        )}
      </div>
      <CommitBox sessionId={sessionId} stagedCount={staged.length} />
    </div>
  )
}

function Section({
  title,
  count,
  action,
  children,
}: {
  title: string
  count: number
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="mb-3">
      <div className="flex h-7 items-center gap-1.5 px-2 font-medium text-muted-foreground text-xs">
        {title}
        <span className="tabular-nums">{count}</span>
        <span className="ml-auto">{action}</span>
      </div>
      {children}
    </section>
  )
}

function SectionAction({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="cursor-pointer rounded px-1.5 py-0.5 transition-colors hover:bg-foreground/5 hover:text-foreground disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  )
}

function FileRow({
  sessionId,
  file,
  staged,
  version,
  disabled,
  onToggle,
}: {
  sessionId: string
  file: ChangedFile
  staged: boolean
  version: number
  disabled: boolean
  onToggle: (file: ChangedFile, toStaged: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const slash = file.path.lastIndexOf("/")
  const name = file.path.slice(slash + 1)
  const folder = slash > 0 ? file.path.slice(0, slash) : ""
  const status = STATUS[file.status]
  return (
    <div>
      <div className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-foreground/[0.04]">
        <Checkbox
          checked={staged}
          disabled={disabled || file.status === "conflicted"}
          onCheckedChange={() => onToggle(file, !staged)}
          aria-label={`${staged ? "Unstage" : "Stage"} ${file.path}`}
        />
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left text-[13px]"
        >
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            className={cn(
              "size-3 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90"
            )}
            strokeWidth={2}
          />
          <span className="shrink-0">{name}</span>
          {folder && (
            <span className="min-w-0 truncate text-muted-foreground text-xs">
              {folder}
            </span>
          )}
        </button>
        <span
          title={status.label}
          className={cn(
            "w-3 shrink-0 text-center font-mono font-semibold text-xs",
            status.className
          )}
        >
          {status.letter}
        </span>
      </div>
      {open && (
        <ChangeDiff
          sessionId={sessionId}
          file={file}
          staged={staged}
          version={version}
        />
      )}
    </div>
  )
}

function ChangeDiff({
  sessionId,
  file,
  staged,
  version,
}: {
  sessionId: string
  file: ChangedFile
  staged: boolean
  version: number
}) {
  const { resolvedTheme } = useTheme()
  const diff = useChangeDiff(sessionId, file, staged, version)
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

  const note = (text: string) => (
    <p className="px-9 pb-2 text-muted-foreground text-xs">{text}</p>
  )
  if (diff.isPending || !highlighterReady) {
    return (
      <div className="flex h-12 items-center justify-center">
        <Spinner className="size-4 text-muted-foreground" />
      </div>
    )
  }
  if (diff.isError) return note("Couldn't load the diff.")
  if (diff.data.kind === "binary") return note("Binary file: no text diff.")
  if (diff.data.kind === "too_large")
    return note("This diff is too large to show.")
  if (diff.data.kind === "gone") return note("The sandbox no longer exists.")
  if (!patch?.trim()) return note("No changes to the file's text.")
  return (
    <div className="mx-2 mb-2 overflow-auto rounded-lg border border-border text-xs">
      {fileDiff ? (
        <FileDiff
          fileDiff={fileDiff}
          options={{
            themeType: resolvedTheme === "dark" ? "dark" : "light",
            diffStyle: "unified",
            overflow: "scroll",
            disableFileHeader: true,
          }}
        />
      ) : (
        <pre className="p-3 font-mono">{patch}</pre>
      )}
    </div>
  )
}

function CommitBox({
  sessionId,
  stagedCount,
}: {
  sessionId: string
  stagedCount: number
}) {
  const [message, setMessage] = useState("")
  const generate = useCommitMessage(sessionId)
  return (
    <div className="shrink-0 border-border/70 border-t p-3">
      <div className="relative">
        <Textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Commit message"
          rows={3}
          className="pr-9 text-[13px]"
        />
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="Write a commit message"
                disabled={stagedCount === 0 || generate.isPending}
                onClick={() =>
                  generate.mutate(undefined, { onSuccess: setMessage })
                }
                className="absolute top-2 right-2 flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-agent disabled:cursor-default disabled:opacity-50"
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
            Write a message from the staged changes
          </TooltipContent>
        </Tooltip>
      </div>
      {/* Stub until chunk 4: commits are made under the person's GitHub
          account, so they wait for GitHub sign-in. */}
      <Tooltip>
        <TooltipTrigger render={<span className="mt-2 block" />}>
          <Button size="sm" className="w-full" disabled>
            {stagedCount > 0
              ? `Commit ${stagedCount} ${stagedCount === 1 ? "file" : "files"}`
              : "Commit"}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Committing comes with GitHub sign-in</TooltipContent>
      </Tooltip>
    </div>
  )
}
