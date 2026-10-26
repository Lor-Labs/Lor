"use client"

import {
  ArrowDown01Icon,
  BubbleChatIcon,
  Cancel01Icon,
  File01Icon,
  GitBranchIcon,
  GitForkIcon,
  RefreshIcon,
  Search01Icon,
  SourceCodeIcon,
  SparklesIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import { Checkbox } from "@repo/ui/components/checkbox"
import { SidebarToggleIcon } from "@repo/ui/components/unlumen-ui/sidebar-toggle-icon"
import dynamic from "next/dynamic"
import { type ReactNode, useEffect, useId, useRef, useState } from "react"
import {
  PreviewPlan,
  usePreviewPlayback,
} from "@/app/components/preview-playback"
import { PREVIEW_REPO as FILES } from "@/app/components/preview-repo"
import { PreviewRepoTree } from "@/app/components/preview-repo-tree"
import {
  PreviewDocument,
  PreviewSessionStrip,
} from "@/app/components/workspace-preview"

const PreviewCodeView = dynamic(() => import("./preview-code-view"), {
  ssr: false,
  loading: () => (
    <p role="status" className="px-3 py-6 text-xs text-lor-text-tertiary-dark">
      Loading code…
    </p>
  ),
})

type View = "chat" | "diff" | "file" | "all"
type Panel = "Details" | "Changes" | "Files"

function counts(index: number) {
  return {
    added: FILES[index]?.added ?? 0,
    removed: FILES[index]?.removed ?? 0,
  }
}

export function CodeReviewPreview({
  children,
  initialView = "chat",
}: {
  children: ReactNode | ((reviewChanges: () => void) => ReactNode)
  initialView?: "chat" | "all"
}) {
  const { guided, beat, scene } = usePreviewPlayback()
  const [view, setView] = useState<View>(initialView)
  const [panel, setPanel] = useState<Panel>("Changes")
  const [panelOpen, setPanelOpen] = useState(false)
  const panelToggle = useRef<HTMLButtonElement>(null)
  const panelTab = useRef<HTMLButtonElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState(0)
  const [staged, setStaged] = useState<number[]>([])
  const [message, setMessage] = useState("")
  const [committedFiles, setCommittedFiles] = useState<number[]>([])
  const [unpushed, setUnpushed] = useState(0)
  const [filter, setFilter] = useState("")
  const [expandedFolders, setExpandedFolders] = useState(
    () => new Set(["src", "src/components"])
  )
  useEffect(() => {
    if (!guided) return
    if (beat === 0) {
      setView(initialView)
      setPanel("Changes")
      setPanelOpen(false)
      setSelected(0)
      setStaged([])
      setMessage("")
      setCommittedFiles([])
      setUnpushed(0)
      setFilter("")
      setExpandedFolders(new Set(["src"]))
    }
    if (scene !== 4) return
    if (beat === 1) {
      setPanel("Files")
      setPanelOpen(true)
    }
    if (beat === 2) setExpandedFolders(new Set(["src", "src/components"]))
    if (beat === 3) {
      setView("file")
      setPanelOpen(false)
    }
    if (beat === 4) {
      setPanel("Changes")
      setPanelOpen(true)
      setView("all")
    }
    if (beat === 5) setStaged([0, 1])
    if (beat === 6)
      setMessage("Show export progress and prevent repeat downloads")
    if (beat === 7) {
      setCommittedFiles([0, 1])
      setStaged([])
      setMessage("")
      setUnpushed(1)
      setView("file")
    }
    if (beat === 8) setUnpushed(0)
  }, [guided, beat, scene, initialView])
  const id = useId()
  const pending = FILES.flatMap((file, index) =>
    file.previousContents !== undefined && !committedFiles.includes(index)
      ? [index]
      : []
  )
  const committed = pending.length === 0
  const file = FILES[selected] ?? FILES[0]
  const showContent = (next: View) => {
    setView(next)
    setPanelOpen(false)
    requestAnimationFrame(() => content.current?.focus({ preventScroll: true }))
  }
  const openFile = (index: number, kind: "diff" | "file") => {
    setSelected(index)
    showContent(kind)
  }
  const closePanel = () => {
    setPanelOpen(false)
    requestAnimationFrame(() =>
      panelToggle.current?.focus({ preventScroll: true })
    )
  }
  const toggleStage = (index: number) =>
    setStaged((current) =>
      current.includes(index)
        ? current.filter((item) => item !== index)
        : [...current, index]
    )
  const total = pending.reduce(
    (sum, index) => {
      const lines = counts(index)
      return {
        added: sum.added + lines.added,
        removed: sum.removed + lines.removed,
      }
    },
    { added: 0, removed: 0 }
  )
  const tabClass =
    "flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[13px] focus-visible:outline-2 focus-visible:outline-agent"

  return (
    <div className="@container/code-preview flex min-h-0 min-w-0 flex-1">
      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 @min-[680px]/code-preview:grid-cols-[minmax(0,1fr)_300px]">
        <div
          ref={content}
          tabIndex={-1}
          className={`m-2 min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-lor-border-dark/60 bg-lor-bg-dark outline-none md:ml-0 @min-[680px]/code-preview:flex ${panelOpen ? "hidden" : "flex"}`}
        >
          <PreviewSessionStrip
            panelControl={
              <>
                <button
                  ref={panelToggle}
                  type="button"
                  aria-label="Open session panel"
                  aria-expanded={panelOpen}
                  aria-controls={`${id}-panel`}
                  onClick={() => {
                    setPanelOpen(true)
                    requestAnimationFrame(() =>
                      panelTab.current?.focus({ preventScroll: true })
                    )
                  }}
                  className="flex size-9 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-md hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-agent @min-[680px]/code-preview:hidden"
                >
                  <SidebarToggleIcon
                    isOpen={false}
                    className="size-4 -scale-x-100"
                    strokeWidth={1.5}
                  />
                </button>
                <span
                  aria-hidden="true"
                  className="hidden size-7 items-center justify-center @min-[680px]/code-preview:flex"
                >
                  <SidebarToggleIcon
                    isOpen
                    className="size-4 -scale-x-100"
                    strokeWidth={1.5}
                  />
                </span>
              </>
            }
          >
            {view !== "chat" ? (
              <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
                <button
                  type="button"
                  onClick={() => setView("chat")}
                  className={`${tabClass} text-lor-text-tertiary-dark`}
                >
                  <HugeiconsIcon icon={BubbleChatIcon} size={14} />
                  Chat
                </button>
                <div className="flex h-7 shrink-0 items-center rounded-md bg-foreground/[0.06] text-lor-text-dark">
                  <span className="flex max-w-48 items-center gap-1.5 px-2 text-[13px]">
                    <HugeiconsIcon
                      icon={view === "file" ? File01Icon : SourceCodeIcon}
                      size={14}
                    />
                    <span className="truncate">
                      {view === "all" ? "All changes" : file.name}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label="Close file tab"
                    onClick={() => setView("chat")}
                    className="mr-1 flex size-5 cursor-pointer items-center justify-center rounded hover:bg-foreground/10 focus-visible:outline-2 focus-visible:outline-agent"
                  >
                    <HugeiconsIcon icon={Cancel01Icon} size={12} />
                  </button>
                </div>
              </div>
            ) : null}
          </PreviewSessionStrip>
          {view === "chat" ? (
            <PreviewDocument
              title="Fix export feedback"
              channel="product"
              starter="Theo"
              headingLevel={2}
              hideStrip
              repo={{ name: "kestrel/app", branch: "fix/exports" }}
              source={{ title: "Export fix (fork)", kind: "continue" }}
            >
              {typeof children === "function"
                ? children(() => {
                    setPanel("Changes")
                    showContent("all")
                  })
                : children}
            </PreviewDocument>
          ) : (
            <div
              data-preview-scroll
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3"
            >
              {(view === "all" ? pending : [selected]).map((index) => {
                const current = FILES[index] ?? FILES[0]
                const diff = view !== "file"
                const lines = counts(index)
                return (
                  <div
                    key={current.name}
                    className="mb-4 overflow-hidden rounded-lg border border-lor-border-dark/70"
                  >
                    <div className="flex min-h-10 flex-wrap items-center gap-2 border-b border-lor-border-dark/60 bg-lor-sidebar-dark/40 px-3 py-2 text-xs text-lor-text-secondary-dark">
                      <HugeiconsIcon icon={File01Icon} size={14} />
                      <span className="min-w-0 flex-1 truncate">
                        {current.path}
                      </span>
                      {diff ? (
                        <>
                          <span className="font-mono text-lor-success-dark">
                            +{lines.added}
                          </span>
                          {lines.removed > 0 ? (
                            <span className="font-mono text-lor-danger-dark">
                              −{lines.removed}
                            </span>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                    <PreviewCodeView file={current} diff={diff} />
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <aside
          id={`${id}-panel`}
          aria-label="Code session panel"
          onKeyDown={(event) => {
            if (
              event.key === "Escape" &&
              panelToggle.current?.getClientRects().length
            ) {
              event.preventDefault()
              closePanel()
            }
          }}
          className={`min-h-0 min-w-0 flex-col overflow-hidden text-lor-text-secondary-dark @min-[680px]/code-preview:flex ${panelOpen ? "flex" : "hidden"}`}
        >
          <div className="flex h-16 shrink-0 items-center gap-0.5 border-b border-lor-border-dark/70 px-2 @min-[680px]/code-preview:gap-1 @min-[680px]/code-preview:px-3">
            {(["Details", "Changes", "Files"] as const).map((tab) => (
              <button
                key={tab}
                ref={panel === tab ? panelTab : undefined}
                type="button"
                aria-pressed={panel === tab}
                data-preview-target={tab}
                onClick={() => setPanel(tab)}
                className={`flex min-h-9 cursor-pointer touch-manipulation items-center gap-1 rounded-md px-1.5 py-1 text-[13px] @min-[680px]/code-preview:min-h-0 @min-[680px]/code-preview:gap-1.5 @min-[680px]/code-preview:px-2 @min-[680px]/code-preview:text-sm focus-visible:outline-2 focus-visible:outline-agent ${panel === tab ? "bg-foreground/[0.06] font-medium text-lor-text-dark" : "text-lor-text-tertiary-dark hover:text-lor-text-dark"}`}
              >
                {tab}
                {tab === "Changes" && !committed ? (
                  <span className="text-xs text-lor-text-tertiary-dark">
                    {pending.length}
                  </span>
                ) : null}
              </button>
            ))}
            <span
              aria-hidden="true"
              className="ml-auto hidden items-center gap-2 text-lor-text-tertiary-dark @min-[680px]/code-preview:flex"
            >
              {panel === "Changes" ? (
                <HugeiconsIcon icon={RefreshIcon} size={14} />
              ) : null}
              <SidebarToggleIcon
                isOpen
                className="size-4 -scale-x-100"
                strokeWidth={1.5}
              />
            </span>
            <button
              type="button"
              aria-label="Back to session"
              onClick={closePanel}
              className="ml-auto flex size-9 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-md text-lor-text-tertiary-dark hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-agent @min-[680px]/code-preview:hidden"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={16} />
            </button>
          </div>
          {panel === "Changes" ? (
            <>
              <div className="flex h-10 shrink-0 items-center gap-2 border-b border-lor-border-dark/70 px-3 text-[11px]">
                <span className="text-lor-text-tertiary-dark">
                  {pending.length} {pending.length === 1 ? "file" : "files"}
                </span>
                {!committed ? (
                  <>
                    <span className="font-mono text-lor-success-dark">
                      +{total.added}
                    </span>
                    <span className="font-mono text-lor-danger-dark">
                      −{total.removed}
                    </span>
                    <button
                      type="button"
                      onClick={() => showContent("all")}
                      className="ml-auto cursor-pointer rounded px-1.5 py-1 hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-agent"
                    >
                      View all
                    </button>
                    <button
                      type="button"
                      data-preview-target="stage"
                      onClick={() =>
                        setStaged(
                          staged.length === pending.length ? [] : pending
                        )
                      }
                      className="cursor-pointer rounded border border-lor-border-dark px-1.5 py-1 hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-agent"
                    >
                      {staged.length === pending.length
                        ? "Unstage all"
                        : "Stage all"}
                    </button>
                  </>
                ) : null}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
                {committed ? (
                  <p
                    role="status"
                    className="px-3 py-8 text-center text-xs text-lor-text-tertiary-dark"
                  >
                    {committedFiles.length
                      ? unpushed
                        ? "Changes committed."
                        : "Up to date with fix/exports."
                      : "No changes yet."}
                  </p>
                ) : (
                  <>
                    <div className="flex h-8 items-center gap-1.5 pr-3 pl-2 text-xs text-lor-text-tertiary-dark">
                      <HugeiconsIcon icon={ArrowDown01Icon} size={14} />
                      <span className="font-medium">Tracked</span>
                      <span className="rounded bg-foreground/[0.06] px-1.5">
                        {pending.length}
                      </span>
                    </div>
                    {pending.map((index) => {
                      const item = FILES[index] ?? FILES[0]
                      return (
                        <div
                          key={item.name}
                          className={`flex h-8 items-center gap-2 pr-3 ${view === "diff" && selected === index ? "bg-foreground/[0.06]" : "hover:bg-foreground/[0.04]"}`}
                        >
                          <button
                            type="button"
                            onClick={() => openFile(index, "diff")}
                            className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 pl-3 text-left text-[12px] focus-visible:outline-2 focus-visible:outline-agent"
                          >
                            <span className="flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border-[1.5px] border-warning text-warning">
                              <span className="size-1 rounded-full bg-current" />
                            </span>
                            <span className="truncate">{item.name}</span>
                          </button>
                          <span className="font-mono text-[10px] text-lor-success-dark">
                            +{counts(index).added}
                          </span>
                          {counts(index).removed > 0 ? (
                            <span className="font-mono text-[10px] text-lor-danger-dark">
                              −{counts(index).removed}
                            </span>
                          ) : null}
                          <Checkbox
                            checked={staged.includes(index)}
                            onCheckedChange={() => toggleStage(index)}
                            aria-label={`${staged.includes(index) ? "Unstage" : "Stage"} ${item.name}`}
                            className="size-3.5"
                          />
                        </div>
                      )
                    })}
                  </>
                )}
              </div>
              <div className="shrink-0 border-t border-lor-border-dark/70">
                <textarea
                  aria-label="Commit message"
                  placeholder="Enter commit message"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  className="block min-h-20 w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-[13px] [@media(pointer:coarse)]:text-base leading-5 outline-none placeholder:text-lor-text-tertiary-dark"
                />
                <div className="flex min-h-10 flex-wrap items-center gap-1.5 pr-2 pl-3 text-[11px] text-lor-text-tertiary-dark">
                  <HugeiconsIcon icon={GitBranchIcon} size={14} />
                  <span className="min-w-0 truncate">fix/exports</span>
                  {unpushed > 0 ? (
                    <span className="shrink-0">· {unpushed} unpushed</span>
                  ) : null}
                  <button
                    type="button"
                    aria-label="Write a commit message"
                    disabled={staged.length === 0 || committed}
                    onClick={() =>
                      setMessage(
                        "Show export progress and prevent repeat downloads"
                      )
                    }
                    className="ml-auto flex size-7 shrink-0 cursor-pointer items-center justify-center rounded hover:text-agent focus-visible:outline-2 focus-visible:outline-agent disabled:opacity-40"
                  >
                    <HugeiconsIcon icon={SparklesIcon} size={16} />
                  </button>
                  <Button
                    size="xs"
                    variant="outline"
                    data-preview-target="commit"
                    disabled={staged.length === 0 || !message.trim()}
                    onClick={() => {
                      setCommittedFiles((current) => [...current, ...staged])
                      setUnpushed((current) => current + 1)
                      setStaged([])
                      setMessage("")
                      setView("chat")
                    }}
                  >
                    {staged.length > 0
                      ? `Commit ${staged.length} ${staged.length === 1 ? "file" : "files"}`
                      : "Commit"}
                  </Button>
                  {unpushed > 0 ? (
                    <Button
                      size="xs"
                      variant="outline"
                      data-preview-target="push"
                      onClick={() => setUnpushed(0)}
                    >
                      Push
                    </Button>
                  ) : null}
                </div>
              </div>
            </>
          ) : panel === "Files" ? (
            <>
              <label
                htmlFor={`${id}-filter`}
                className="flex h-10 shrink-0 items-center gap-2 border-b border-lor-border-dark/70 px-3"
              >
                <HugeiconsIcon icon={Search01Icon} size={14} />
                <input
                  id={`${id}-filter`}
                  aria-label="Filter files"
                  placeholder="Filter files"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none [@media(pointer:coarse)]:text-base"
                />
              </label>
              <PreviewRepoTree
                filter={filter}
                expanded={expandedFolders}
                changedPaths={pending.flatMap(
                  (index) => FILES[index]?.path ?? []
                )}
                selectedPath={view === "file" ? file.path : undefined}
                onToggle={(path) =>
                  setExpandedFolders((current) => {
                    const next = new Set(current)
                    if (next.has(path)) next.delete(path)
                    else next.add(path)
                    return next
                  })
                }
                onOpen={(index) => openFile(index, "file")}
              />
            </>
          ) : (
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-4 text-xs">
              <div>
                <p className="mb-2 font-medium text-lor-text-tertiary-dark">
                  Context
                </p>
                <p className="flex items-center gap-1.5">
                  <HugeiconsIcon icon={BubbleChatIcon} size={14} />
                  Export fix (fork)
                </p>
                <p className="mt-2 flex items-center gap-1.5 text-lor-text-tertiary-dark">
                  <HugeiconsIcon icon={GitForkIcon} size={14} />
                  Investigate exports
                </p>
              </div>
              <div>
                <p className="mb-3 text-xs font-medium text-lor-text-tertiary-dark">
                  Plan
                </p>
                <PreviewPlan
                  plan={[
                    "Read the investigation",
                    "Add the export state",
                    "Handle a failed download",
                  ]}
                />
              </div>
              <div>
                <p className="mb-2 font-medium text-lor-text-tertiary-dark">
                  Files
                </p>
                <p className="flex items-center gap-1.5">
                  <HugeiconsIcon icon={File01Icon} size={14} />
                  export-findings.md
                </p>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
