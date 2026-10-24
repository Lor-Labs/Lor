import {
  BubbleChatIcon,
  Cancel01Icon,
  File01Icon,
  GitCompareIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { File as CodeFile } from "@pierre/diffs/react"
import { Button } from "@repo/ui/components/button"
import { useSidebar } from "@repo/ui/components/sidebar"
import { Spinner } from "@repo/ui/components/spinner"
import { cn } from "@repo/ui/lib/utils"
import { useTheme } from "next-themes"
import { type ReactNode, useEffect } from "react"
import { useDesktopChrome } from "@/components/desktop-window-frame"
import { MainAreaTabs } from "@/components/main-area-tabs"
import {
  ChangeDiff,
  DIFF_CSS,
  LineCounts,
  PanelNote,
  StageCheckbox,
  StatusMark,
  splitPath,
} from "@/components/sidebar/right-panel/session-changes-panel"
import { useDesktopZoom } from "@/context/desktop-zoom-context"
import { useDiffHighlighterReady } from "@/hooks/use-diff-highlighter"
import {
  type ChangedFile,
  useRepoFile,
  useSessionChanges,
  useStageChanges,
} from "@/hooks/use-session-changes"
import {
  diffTabId,
  fileTabId,
  parseTabId,
  type SessionTab,
  type SessionTabs,
} from "@/hooks/use-session-tabs"

// A code session's tabs above the main area, Linear-style: Chat first, then
// the files and diffs opened from the panel's Files and Changes lists.
// Read-only.

export function SessionTabBar({ tabs }: { tabs: SessionTabs }) {
  const { ids, preview, active, select, adopt, keep, close } = tabs
  const { isMacDesktop, isFullscreen } = useDesktopChrome()
  const { open: sidebarOpen, isMobile } = useSidebar()
  const appScale = (useDesktopZoom()?.levels.app ?? 100) / 100
  // With the sidebar collapsed, macOS's window buttons sit over this row.
  const clearWindowButtons =
    isMacDesktop && !isMobile && !sidebarOpen && !isFullscreen
  // Only when the URL changes: a tab just closed stays closed while the URL
  // catches up.
  useEffect(() => {
    if (active && parseTabId(active)) adopt(active)
  }, [active, adopt])

  return (
    <MainAreaTabs>
      <div
        className="flex shrink-0 items-center gap-1.5 overflow-x-auto pb-2 [scrollbar-width:none] max-md:p-2"
        style={clearWindowButtons ? { paddingLeft: 72 / appScale } : undefined}
      >
        <TabButton
          label="Chat"
          icon={BubbleChatIcon}
          selected={active === null}
          onSelect={() => select(null)}
        />
        {ids.map((id) => {
          const tab = parseTabId(id)
          if (!tab) return null
          return (
            <TabButton
              key={id}
              label={splitPath(tab.path).name}
              title={tab.path}
              icon={tab.kind === "diff" ? GitCompareIcon : File01Icon}
              preview={preview === id}
              selected={active === id}
              onSelect={() => select(id)}
              onKeep={() => keep(id)}
              onClose={() => close(id)}
            />
          )
        })}
      </div>
    </MainAreaTabs>
  )
}

function TabButton({
  label,
  title,
  icon,
  preview,
  selected,
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
  onSelect: () => void
  onKeep?: () => void
  onClose?: () => void
}) {
  // The selected tab matches the card below it.
  return (
    <div
      className={cn(
        "group flex h-8 shrink-0 items-center rounded-lg border text-[13px] transition-colors",
        selected
          ? "border-border/60 bg-background text-foreground"
          : "border-transparent bg-foreground/[0.03] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
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
          "flex h-full max-w-56 cursor-pointer items-center gap-2 px-2.5",
          onClose && "pr-1.5"
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
            "mr-1.5 flex size-4 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
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
    </div>
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
  const ready = changes.data?.state === "ready" ? changes.data : null
  const file = ready?.files.find((changed) => changed.path === tab.path) ?? null

  if (tab.kind === "file") {
    return (
      <TabPage
        path={tab.path}
        file={file}
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
      path={tab.path}
      file={file}
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
      {changes.isPending ? (
        <PanelNote>
          <Spinner className="size-4" />
        </PanelNote>
      ) : changes.isError ? (
        <PanelNote>Couldn't load the changes.</PanelNote>
      ) : changes.data.state === "gone" ? (
        <PanelNote>The sandbox no longer exists.</PanelNote>
      ) : file ? (
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
      )}
    </TabPage>
  )
}

function TabPage({
  path,
  file,
  actions,
  children,
}: {
  path: string
  file: ChangedFile | null
  actions: ReactNode
  children: ReactNode
}) {
  const { name, folder } = splitPath(path)
  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex h-10 shrink-0 items-center gap-2 border-border/70 border-b px-4 text-[13px]">
        {file && <StatusMark status={file.status} />}
        <span className="min-w-0 truncate">
          {folder && <span className="text-muted-foreground">{folder}/</span>}
          <span className="font-medium">{name}</span>
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {actions}
        </div>
      </div>
      {/* Not a flex column itself: the clipped code card would shrink to
          fit instead of scrolling. */}
      <div className="min-h-0 flex-1 overflow-auto">
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

function RepoFileView({
  sessionId,
  path,
}: {
  sessionId: string
  path: string
}) {
  const { resolvedTheme } = useTheme()
  const file = useRepoFile(sessionId, path)
  const highlighterReady = useDiffHighlighterReady(path)

  if (file.isPending || !highlighterReady) {
    return (
      <PanelNote>
        <Spinner className="size-4" />
      </PanelNote>
    )
  }
  if (file.isError) return <PanelNote>Couldn't load the file.</PanelNote>
  if (file.data.kind === "binary") {
    return <PanelNote>Binary file: no text to show.</PanelNote>
  }
  if (file.data.kind === "too_large") {
    return <PanelNote>This file is too large to show.</PanelNote>
  }
  if (file.data.kind === "missing") {
    return <PanelNote>This file no longer exists.</PanelNote>
  }
  if (file.data.kind === "gone") {
    return <PanelNote>The sandbox no longer exists.</PanelNote>
  }
  return (
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
}
