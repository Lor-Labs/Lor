import {
  ArrowDown01Icon,
  BubbleChatIcon,
  Cancel01Icon,
  File01Icon,
  FileDiffIcon,
  GitCompareIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuTrigger,
} from "@repo/ui/components/context-menu"
import { Spinner } from "@repo/ui/components/spinner"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { useDesktopChrome } from "@/components/desktop-window-frame"
import { RepoFileView } from "@/components/session/repo-file-view"
import {
  ChangeDiff,
  changeTotals,
  FolderGapNote,
  LineCounts,
  PanelNote,
  StageCheckbox,
  StatusMark,
  splitPath,
} from "@/components/sidebar/right-panel/session-changes-panel"
import {
  type ChangedFile,
  useSessionChanges,
  useStageChanges,
} from "@/hooks/use-session-changes"
import {
  diffTabId,
  fileTabId,
  parseTabId,
  type SessionTab,
  type SessionTabs,
  sessionTabLink,
} from "@/hooks/use-session-tabs"

// A code session's tabs in its header strip, in the title's place while any
// are open: Chat first, then the files and diffs opened from the panel's
// Files and Changes lists. Read-only.

const TAB_ICONS: Record<SessionTab["kind"], IconSvgElement> = {
  file: File01Icon,
  diff: FileDiffIcon,
  changes: GitCompareIcon,
}

function tabLabel(tab: SessionTab): string {
  return "path" in tab ? splitPath(tab.path).name : "All changes"
}

const TYPING_TARGET =
  "input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu']"

export function SessionTabBar({
  workspaceSlug,
  sessionId,
  tabs,
}: {
  workspaceSlug: string
  sessionId: string
  tabs: SessionTabs
}) {
  const { ids, preview, active, select, adopt, keep, close } = tabs
  const { closeOthers, cycle } = tabs
  const { isMacDesktop } = useDesktopChrome()
  // Only when the URL changes: a tab just closed stays closed while the URL
  // catches up.
  useEffect(() => {
    if (active && parseTabId(active)) adopt(active)
  }, [active, adopt])

  // Escape goes back to Chat. Ctrl+Tab, Ctrl+Shift+Tab and Cmd+W only in the
  // Mac app: browsers keep those keys for their own tabs.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return
      if (event.key === "Escape") {
        const target = event.target instanceof Element ? event.target : null
        if (
          active === null ||
          target?.closest(TYPING_TARGET) ||
          document.querySelector("[role='dialog'], [role='menu']")
        ) {
          return
        }
        select(null)
      } else if (isMacDesktop && event.ctrlKey && event.key === "Tab") {
        event.preventDefault()
        cycle(event.shiftKey ? -1 : 1)
      } else if (
        isMacDesktop &&
        event.metaKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "w" &&
        active
      ) {
        // On the Chat tab Cmd+W still closes the window.
        event.preventDefault()
        close(active)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [active, isMacDesktop, select, cycle, close])

  const copyLink = (id: string | null) =>
    void navigator.clipboard
      .writeText(sessionTabLink(workspaceSlug, sessionId, id))
      .then(() => toast.success("Link copied"))
  const menuFor = (id: string | null) => (
    <>
      <ContextMenuItem onClick={() => copyLink(id)}>Copy link</ContextMenuItem>
      {id && <ContextMenuItem onClick={() => close(id)}>Close</ContextMenuItem>}
      <ContextMenuItem onClick={() => closeOthers(id)}>
        {id ? "Close others" : "Close all tabs"}
      </ContextMenuItem>
    </>
  )

  return (
    <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
      <TabButton
        label="Chat"
        icon={BubbleChatIcon}
        selected={active === null}
        menu={menuFor(null)}
        onSelect={() => select(null)}
      />
      {ids.map((id) => {
        const tab = parseTabId(id)
        if (!tab) return null
        return (
          <TabButton
            key={id}
            label={tabLabel(tab)}
            title={"path" in tab ? tab.path : undefined}
            icon={TAB_ICONS[tab.kind]}
            preview={preview === id}
            selected={active === id}
            menu={menuFor(id)}
            onSelect={() => select(id)}
            onKeep={() => keep(id)}
            onClose={() => close(id)}
          />
        )
      })}
    </div>
  )
}

function TabButton({
  label,
  title,
  icon,
  preview,
  selected,
  menu,
  onSelect,
  onKeep,
  onClose,
}: {
  label: string
  title?: string
  icon: IconSvgElement
  // A preview tab's name is italic until it is kept.
  preview?: boolean
  selected: boolean
  // Right-click menu items.
  menu: ReactNode
  onSelect: () => void
  onKeep?: () => void
  onClose?: () => void
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger
        className={cn(
          "group flex h-7 shrink-0 items-center rounded-md text-[13px] transition-colors",
          selected
            ? "bg-foreground/[0.06] text-foreground"
            : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
        )}
      >
        <button
          type="button"
          aria-pressed={selected}
          title={title}
          onClick={onSelect}
          onDoubleClick={onKeep}
          onAuxClick={(event) => {
            if (event.button === 1) onClose?.()
          }}
          className={cn(
            "flex h-full max-w-48 cursor-pointer items-center gap-1.5 px-2",
            onClose && "pr-1"
          )}
        >
          <HugeiconsIcon
            icon={icon}
            className="size-3.5 shrink-0"
            strokeWidth={2}
          />
          <span
            className={cn(
              "truncate",
              selected && "font-medium",
              preview && "italic"
            )}
          >
            {label}
          </span>
        </button>
        {onClose && (
          <button
            type="button"
            aria-label={`Close ${label}`}
            onClick={onClose}
            className={cn(
              "mr-1 flex size-4 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
              !selected &&
                "opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
            )}
          >
            <HugeiconsIcon
              icon={Cancel01Icon}
              className="size-3"
              strokeWidth={2}
            />
          </button>
        )}
      </ContextMenuTrigger>
      <ContextMenuPopup align="start">{menu}</ContextMenuPopup>
    </ContextMenu>
  )
}

// The active tab's content, over the chat (SessionDocument's cover).
export function SessionTabView({
  sessionId,
  tab,
  onOpen,
}: {
  sessionId: string
  tab: SessionTab
  onOpen: SessionTabs["open"]
}) {
  const changes = useSessionChanges(sessionId)
  if (tab.kind === "changes") return <AllChangesTab sessionId={sessionId} />

  const ready = changes.data?.state === "ready" ? changes.data : null
  const file = ready?.files.find((changed) => changed.path === tab.path) ?? null
  const title = <PathTitle path={tab.path} file={file} />

  if (tab.kind === "file") {
    return (
      <TabPage
        title={title}
        actions={
          file && (
            <Button
              size="xs"
              variant="outline"
              onClick={() => onOpen(diffTabId(tab.path))}
            >
              View changes
            </Button>
          )
        }
      >
        <RepoFileView sessionId={sessionId} path={tab.path} />
      </TabPage>
    )
  }

  const openFile =
    file?.status === "deleted" ? null : (
      <Button
        size="xs"
        variant="outline"
        onClick={() => onOpen(fileTabId(tab.path))}
      >
        Open file
      </Button>
    )
  return (
    <TabPage
      title={title}
      actions={
        file &&
        ready && (
          <>
            <LineCounts additions={file.additions} deletions={file.deletions} />
            {openFile}
            <TabStageCheckbox
              sessionId={sessionId}
              file={file}
              locked={ready.lorWorking}
            />
          </>
        )
      }
    >
      {changesNote(changes) ??
        (file ? (
          <ChangeDiff
            sessionId={sessionId}
            file={file}
            version={changes.dataUpdatedAt}
          />
        ) : (
          <PanelNote>
            This file has no changes now.
            {openFile}
          </PanelNote>
        ))}
    </TabPage>
  )
}

// Loading, failed, or no work folder (gone, not set up yet, or restoring):
// the note shown instead.
function changesNote(changes: ReturnType<typeof useSessionChanges>) {
  if (changes.isPending) {
    return (
      <PanelNote>
        <Spinner className="size-4" />
      </PanelNote>
    )
  }
  if (changes.isError) return <PanelNote>Couldn't load the changes.</PanelNote>
  if (changes.data.state !== "ready") {
    return (
      <FolderGapNote
        gap={changes.data.state}
        onRetry={() => void changes.refetch()}
      />
    )
  }
  return null
}

// Every changed file's diff, one card each, like a pull request's files.
function AllChangesTab({ sessionId }: { sessionId: string }) {
  const changes = useSessionChanges(sessionId)
  const ready = changes.data?.state === "ready" ? changes.data : null
  const files = ready?.files ?? []
  const totals = changeTotals(files)

  const body =
    changesNote(changes) ??
    (ready && files.length > 0 ? (
      <div className="flex flex-col gap-3 p-4">
        {files.map((file) => (
          <ChangeSection
            key={file.path}
            sessionId={sessionId}
            file={file}
            version={changes.dataUpdatedAt}
            locked={ready.lorWorking}
          />
        ))}
        {ready.truncated && (
          <p className="text-muted-foreground text-xs">
            Showing the first 1,000 files.
          </p>
        )}
      </div>
    ) : (
      <PanelNote>
        No changes yet. Lor's edits show up here as it works.
      </PanelNote>
    ))

  return (
    <TabPage
      title={<span className="font-medium">All changes</span>}
      actions={
        files.length > 0 && (
          <>
            <span className="text-muted-foreground">
              {files.length} {files.length === 1 ? "file" : "files"}
            </span>
            <LineCounts {...totals} />
          </>
        )
      }
    >
      {body}
    </TabPage>
  )
}

function ChangeSection({
  sessionId,
  file,
  version,
  locked,
}: {
  sessionId: string
  file: ChangedFile
  version: number
  locked: boolean
}) {
  const [collapsed, setCollapsed] = useState(false)
  // overflow-clip, not hidden: the header stays sticky while scrolling.
  return (
    <section className="overflow-clip rounded-lg border border-border/70 bg-card">
      <div
        className={cn(
          "sticky top-0 z-10 flex h-9 items-center gap-2 bg-card pr-3 text-[13px]",
          !collapsed && "border-border/70 border-b"
        )}
      >
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 pl-2.5 text-left"
        >
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              collapsed && "-rotate-90"
            )}
            strokeWidth={2}
          />
          <PathTitle path={file.path} file={file} />
        </button>
        <LineCounts additions={file.additions} deletions={file.deletions} />
        <TabStageCheckbox sessionId={sessionId} file={file} locked={locked} />
      </div>
      {!collapsed && (
        <LazyDiff sessionId={sessionId} file={file} version={version} />
      )}
    </section>
  )
}

// A diff loads once it scrolls near the view, so a long list doesn't read
// every file from the sandbox at once.
function LazyDiff({
  sessionId,
  file,
  version,
}: {
  sessionId: string
  file: ChangedFile
  version: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (near || !element) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true)
      },
      { root: element.closest("[data-tab-scroll]"), rootMargin: "600px 0px" }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [near])

  return (
    <div ref={ref} className="flex min-h-12 flex-col">
      {near && (
        <ChangeDiff
          sessionId={sessionId}
          file={file}
          version={version}
          framed={false}
        />
      )}
    </div>
  )
}

function PathTitle({ path, file }: { path: string; file: ChangedFile | null }) {
  const { name, folder } = splitPath(path)
  return (
    <>
      {file && <StatusMark status={file.status} />}
      <span className="min-w-0 truncate">
        {folder && <span className="text-muted-foreground">{folder}/</span>}
        <span className="font-medium">{name}</span>
      </span>
    </>
  )
}

function TabPage({
  title,
  actions,
  children,
}: {
  title: ReactNode
  actions: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex h-10 shrink-0 items-center gap-2 border-border/70 border-b px-4 text-[13px]">
        {title}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {actions}
        </div>
      </div>
      {/* Not a flex column itself: the clipped code card would shrink to
          fit instead of scrolling. */}
      <div data-tab-scroll="" className="min-h-0 flex-1 overflow-auto">
        <div className="flex min-h-full flex-col">{children}</div>
      </div>
    </div>
  )
}

function TabStageCheckbox({
  sessionId,
  file,
  locked,
}: {
  sessionId: string
  file: ChangedFile
  locked: boolean
}) {
  const stage = useStageChanges(sessionId)
  return (
    <StageCheckbox
      file={file}
      locked={locked}
      onToggle={(staged) =>
        stage.mutate({
          paths: file.oldPath ? [file.oldPath, file.path] : [file.path],
          staged,
        })
      }
    />
  )
}
