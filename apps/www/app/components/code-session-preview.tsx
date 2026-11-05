"use client"

import {
  ArrowDown01Icon,
  BrowserIcon,
  ComputerTerminal01Icon,
  GitBranchIcon,
  GlobeIcon,
  LinkSquare02Icon,
  Loading03Icon,
  RefreshIcon,
  Search01Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import { Checkbox } from "@repo/ui/components/checkbox"
import { SidebarToggleIcon } from "@repo/ui/components/unlumen-ui/sidebar-toggle-icon"
import { useState } from "react"
import { ReviewChangesCard, WorkLog } from "@/app/components/mock-parts"
import { MockShell } from "@/app/components/mock-shell"
import {
  PREVIEW_CHANGE_TOTALS,
  PREVIEW_CHANGED_FILES,
  PREVIEW_REPO,
} from "@/app/components/preview-repo"
import { PreviewRepoTree } from "@/app/components/preview-repo-tree"
import {
  PreviewDocument,
  PreviewTurn,
} from "@/app/components/workspace-preview"

// Static code session for the homepage: the chat beside the app's
// Changes | Files | Terminal | Browser panel (session-changes-panel.tsx).
// Tabs, staging and commit work on local state only.
const TABS: { label: Tab; icon?: IconSvgElement }[] = [
  { label: "Changes" },
  { label: "Files" },
  { label: "Terminal", icon: ComputerTerminal01Icon },
  { label: "Browser", icon: BrowserIcon },
]
type Tab = "Changes" | "Files" | "Terminal" | "Browser"

const BRANCH = "fix/exports"
const COMMIT_MESSAGE = "Show export progress and ignore repeat clicks"

export function CodeSessionPreview() {
  const [tab, setTab] = useState<Tab>("Browser")
  const changes = useChangesState()

  return (
    <MockShell>
      <div className="grid bg-lor-sidebar-dark lg:h-[660px] lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
        <div className="m-1.5 flex h-[600px] min-w-0 overflow-hidden rounded-xl border border-lor-border-dark/60 lg:mr-0 lg:h-auto">
          <PreviewDocument
            title="Fix export feedback"
            channel="product"
            starter="Theo"
            repo={{ name: "kestrel/app", branch: BRANCH }}
            source={{ title: "Investigate exports", kind: "continue" }}
          >
            <PreviewTurn person="Theo">
              Paygrove keeps clicking Export because nothing happens while the
              file builds. Can we show that it&rsquo;s working and ignore repeat
              clicks?
            </PreviewTurn>
            <PreviewTurn person="Lor">
              <WorkLog label="Worked" detail="14 tool calls" />
              <p className="mt-3">
                Done. The button now says &ldquo;Preparing&hellip;&rdquo; and
                stays disabled until the download starts. I ran the app in my
                sandbox and tried an export. It&rsquo;s open in the Browser tab.
              </p>
              <ReviewChangesCard
                added={PREVIEW_CHANGE_TOTALS.added}
                removed={PREVIEW_CHANGE_TOTALS.removed}
                files={PREVIEW_CHANGED_FILES.length}
                onClick={() => setTab("Changes")}
              />
            </PreviewTurn>
            <PreviewTurn person="Zoe" aside>
              Tried it in the browser. Much clearer. Theo, can you commit it?
            </PreviewTurn>
          </PreviewDocument>
        </div>
        <section
          aria-label="Code session panel"
          className="flex h-[540px] min-w-0 flex-col text-lor-text-secondary-dark lg:h-auto"
        >
          <div className="flex h-12 shrink-0 items-center gap-1 px-2.5">
            <div className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
              {TABS.map(({ label, icon }) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={tab === label}
                  onClick={() => setTab(label)}
                  className={`flex min-h-8 shrink-0 cursor-pointer touch-manipulation items-center gap-1.5 rounded-md px-2 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-agent ${tab === label ? "bg-foreground/[0.06] font-medium text-lor-text-dark" : "text-lor-text-tertiary-dark hover:text-lor-text-dark"}`}
                >
                  {icon ? (
                    <HugeiconsIcon
                      icon={icon}
                      size={14}
                      strokeWidth={2}
                      className="hidden sm:block"
                    />
                  ) : null}
                  {label}
                  {label === "Changes" && changes.commit === "none" ? (
                    <span className="text-xs tabular-nums text-lor-text-tertiary-dark">
                      {PREVIEW_CHANGED_FILES.length}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            <span
              aria-hidden="true"
              className="ml-auto hidden shrink-0 items-center gap-2.5 pr-1 text-lor-text-tertiary-dark sm:flex"
            >
              {tab === "Changes" ? (
                <HugeiconsIcon icon={RefreshIcon} size={14} />
              ) : null}
              <SidebarToggleIcon
                isOpen
                className="size-4 -scale-x-100"
                strokeWidth={1.5}
              />
            </span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col border-t border-lor-border-dark/70">
            {tab === "Changes" ? (
              <ChangesView {...changes} />
            ) : tab === "Files" ? (
              <FilesView />
            ) : tab === "Terminal" ? (
              <TerminalView />
            ) : (
              <BrowserView />
            )}
          </div>
        </section>
      </div>
    </MockShell>
  )
}

// Kept above the tabs so staging and the commit survive a tab switch.
function useChangesState() {
  const [staged, setStaged] = useState<string[]>([])
  const [message, setMessage] = useState("")
  const [commit, setCommit] = useState<"none" | "local" | "pushed">("none")
  return { staged, setStaged, message, setMessage, commit, setCommit }
}

function ChangesView({
  staged,
  setStaged,
  message,
  setMessage,
  commit,
  setCommit,
}: ReturnType<typeof useChangesState>) {
  const allStaged = staged.length === PREVIEW_CHANGED_FILES.length

  if (commit !== "none") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <p role="status" className="text-[13px] text-lor-text-secondary-dark">
          {commit === "local"
            ? "1 commit ready to push."
            : `Pushed to ${BRANCH} as Theo.`}
        </p>
        {commit === "local" ? (
          <Button
            size="xs"
            variant="outline"
            onClick={() => setCommit("pushed")}
          >
            Push
          </Button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setCommit("none")
              setStaged([])
              setMessage("")
            }}
            className="cursor-pointer rounded px-1.5 py-1 text-[11px] text-lor-text-tertiary-dark hover:text-lor-text-dark focus-visible:outline-2 focus-visible:outline-agent"
          >
            Reset preview
          </button>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-lor-border-dark/70 px-3 text-[11px]">
        <span className="text-lor-text-tertiary-dark">
          {PREVIEW_CHANGED_FILES.length} files
        </span>
        <span className="font-mono text-lor-success-dark">
          +{PREVIEW_CHANGE_TOTALS.added}
        </span>
        <span className="font-mono text-lor-danger-dark">
          −{PREVIEW_CHANGE_TOTALS.removed}
        </span>
        <button
          type="button"
          onClick={() =>
            setStaged(
              allStaged ? [] : PREVIEW_CHANGED_FILES.map((file) => file.path)
            )
          }
          className="ml-auto cursor-pointer rounded border border-lor-border-dark px-1.5 py-1 hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-agent"
        >
          {allStaged ? "Unstage all" : "Stage all"}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
        <div className="flex h-8 items-center gap-1.5 pr-3 pl-2 text-xs text-lor-text-tertiary-dark">
          <HugeiconsIcon icon={ArrowDown01Icon} size={14} />
          <span className="font-medium">Tracked</span>
          <span className="rounded bg-foreground/[0.06] px-1.5">
            {PREVIEW_CHANGED_FILES.length}
          </span>
        </div>
        {PREVIEW_CHANGED_FILES.map((file) => {
          const isStaged = staged.includes(file.path)
          return (
            <div
              key={file.path}
              className="flex h-9 items-center gap-2 pr-3 pl-3 text-[12px] hover:bg-foreground/[0.04]"
            >
              <span className="flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border-[1.5px] border-warning text-warning">
                <span className="size-1 rounded-full bg-current" />
              </span>
              <span className="min-w-0 flex-1 truncate">
                {file.name}
                <span className="ml-2 text-[11px] text-lor-text-tertiary-dark">
                  {file.path.slice(0, -file.name.length - 1)}
                </span>
              </span>
              <span className="font-mono text-[10px] text-lor-success-dark">
                +{file.added}
              </span>
              <span className="font-mono text-[10px] text-lor-danger-dark">
                −{file.removed}
              </span>
              <Checkbox
                checked={isStaged}
                onCheckedChange={() =>
                  setStaged((current) =>
                    isStaged
                      ? current.filter((path) => path !== file.path)
                      : [...current, file.path]
                  )
                }
                aria-label={`${isStaged ? "Unstage" : "Stage"} ${file.name}`}
                className="size-3.5"
              />
            </div>
          )
        })}
      </div>
      <div className="shrink-0 border-t border-lor-border-dark/70">
        <textarea
          aria-label="Commit message"
          placeholder="Enter commit message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          className="block min-h-20 w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-[13px] leading-5 outline-none placeholder:text-lor-text-tertiary-dark [@media(pointer:coarse)]:text-base"
        />
        <div className="flex min-h-10 items-center gap-1.5 pr-2 pl-3 text-[11px] text-lor-text-tertiary-dark">
          <HugeiconsIcon icon={GitBranchIcon} size={14} />
          <span className="min-w-0 truncate">{BRANCH}</span>
          <button
            type="button"
            aria-label="Write a commit message"
            onClick={() => setMessage(COMMIT_MESSAGE)}
            className="ml-auto flex size-7 shrink-0 cursor-pointer items-center justify-center rounded hover:text-agent focus-visible:outline-2 focus-visible:outline-agent"
          >
            <HugeiconsIcon icon={SparklesIcon} size={16} />
          </button>
          <Button
            size="xs"
            variant="outline"
            disabled={staged.length === 0 || !message.trim()}
            onClick={() => setCommit("local")}
          >
            {staged.length > 0
              ? `Commit ${staged.length} ${staged.length === 1 ? "file" : "files"}`
              : "Commit"}
          </Button>
        </div>
      </div>
    </>
  )
}

function FilesView() {
  const [filter, setFilter] = useState("")
  const [selected, setSelected] = useState<string>()
  const [expanded, setExpanded] = useState(
    () => new Set(["src", "src/components"])
  )

  return (
    <>
      <label className="flex h-10 shrink-0 items-center gap-2 border-b border-lor-border-dark/70 px-3">
        <HugeiconsIcon icon={Search01Icon} size={14} />
        <input
          aria-label="Filter files"
          placeholder="Filter files"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none [@media(pointer:coarse)]:text-base"
        />
      </label>
      <PreviewRepoTree
        filter={filter}
        expanded={expanded}
        changedPaths={PREVIEW_CHANGED_FILES.map((file) => file.path)}
        selectedPath={selected}
        onToggle={(path) =>
          setExpanded((current) => {
            const next = new Set(current)
            if (next.has(path)) next.delete(path)
            else next.add(path)
            return next
          })
        }
        onOpen={(index) => setSelected(PREVIEW_REPO[index]?.path)}
      />
    </>
  )
}

function TerminalView() {
  const prompt = (
    <>
      <span className="text-lor-success-dark">~/kestrel-app</span>{" "}
      <span className="text-agent">({BRANCH})</span>{" "}
      <span className="text-lor-text-tertiary-dark">$</span>
    </>
  )
  return (
    <pre className="min-h-0 flex-1 overflow-auto bg-lor-bg-dark/60 p-4 font-mono text-[11.5px] leading-[1.75] text-lor-text-secondary-dark">
      {prompt} <span className="text-lor-text-dark">pnpm dev</span>
      {"\n\n"}
      {"  "}
      <span className="font-semibold text-lor-success-dark">VITE v6.2.0</span>
      {"  ready in 384 ms\n\n"}
      {"  →  Local:   "}
      <span className="text-info">http://localhost:5173/</span>
      {"\n  →  Network: use --host to expose\n\n"}
      {prompt}{" "}
      <span className="text-lor-text-dark">pnpm exec tsc --noEmit</span>
      {"\n"}
      {prompt}{" "}
      <span className="inline-block h-3.5 w-1.5 translate-y-0.5 bg-lor-text-secondary-dark" />
    </pre>
  )
}

// The running app as the Browser tab shows it: a light, fictional Kestrel
// settings page mid-export, with Lor's cursor on the button it just pressed.
function BrowserView() {
  return (
    <>
      <div className="flex shrink-0 items-center gap-1.5 border-b border-lor-border-dark/70 px-2 py-2">
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center text-lor-text-tertiary-dark"
        >
          <HugeiconsIcon icon={RefreshIcon} size={14} />
        </span>
        <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-full border border-lor-border-dark/70 bg-foreground/[0.03] ps-3 pe-1 text-[12.5px]">
          <HugeiconsIcon
            icon={GlobeIcon}
            size={14}
            className="shrink-0 text-lor-text-tertiary-dark"
          />
          <span className="min-w-0 flex-1 truncate text-lor-text-dark">
            localhost:5173
            <span className="text-lor-text-tertiary-dark">/settings/data</span>
          </span>
          <span className="flex h-6 shrink-0 items-center gap-1 rounded-full px-2 font-mono text-[11px] text-lor-text-tertiary-dark">
            5173
            <HugeiconsIcon icon={ArrowDown01Icon} size={12} />
          </span>
        </div>
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center text-lor-text-tertiary-dark"
        >
          <HugeiconsIcon icon={LinkSquare02Icon} size={14} />
        </span>
      </div>
      <div
        role="img"
        aria-label="The Kestrel app running in Lor's sandbox. The Export CSV button reads Preparing and is disabled while the file builds."
        className="relative flex min-h-0 flex-1 overflow-hidden bg-[#faf9f7] text-stone-900 scheme-light"
      >
        <div
          aria-hidden="true"
          className="hidden w-36 shrink-0 flex-col gap-0.5 border-r border-stone-900/[0.06] bg-[#f3f1ed] p-3 text-[12px] text-stone-500 sm:flex"
        >
          <p className="mb-3 flex items-center gap-2 px-1.5 pt-1 font-semibold text-stone-900">
            <span className="size-4 rounded-[5px] bg-linear-to-br from-amber-500 to-orange-600" />
            Kestrel
          </p>
          {["Overview", "Projects", "Reports", "Settings"].map((item) => (
            <p
              key={item}
              className={`rounded-md px-2 py-1.5 ${item === "Settings" ? "bg-stone-900/[0.06] font-medium text-stone-900" : ""}`}
            >
              {item}
            </p>
          ))}
        </div>
        <div aria-hidden="true" className="min-w-0 flex-1 px-6 py-6">
          <p className="text-[11px] text-stone-500">Settings</p>
          <p className="mt-1 text-[17px] font-semibold tracking-tight">
            Workspace data
          </p>
          <div className="mt-3 flex gap-4 border-b border-stone-900/[0.08] text-[11.5px] text-stone-500">
            <span className="pb-2">General</span>
            <span className="pb-2">Members</span>
            <span className="border-b-2 border-stone-900 pb-2 font-medium text-stone-900">
              Data
            </span>
          </div>
          <div className="relative mt-5 max-w-sm rounded-xl border border-stone-900/[0.08] bg-white p-5 shadow-[0_1px_2px_rgba(28,25,23,0.06),0_8px_24px_-12px_rgba(28,25,23,0.12)]">
            <p className="text-[13.5px] font-semibold">Export your data</p>
            <p className="mt-1 text-[12px] text-stone-500">
              Download your workspace activity as a CSV.
            </p>
            <span className="relative mt-4 inline-flex">
              <span className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-3.5 py-2 text-[12px] font-medium text-white opacity-60">
                <HugeiconsIcon icon={Loading03Icon} size={13} />
                Preparing…
              </span>
              <span className="absolute top-[70%] left-[calc(100%-10px)] flex items-start">
                <svg
                  viewBox="0 0 16 16"
                  className="size-4 text-agent drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)]"
                >
                  <path
                    d="M2 1.5 13.5 7 8.2 8.4 6 13.8Z"
                    fill="currentColor"
                    stroke="white"
                    strokeWidth="1.2"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="mt-3.5 -ml-0.5 rounded-full bg-agent px-1.5 py-0.5 text-[10px] font-medium text-white">
                  Lor
                </span>
              </span>
            </span>
          </div>
          <p className="mt-8 text-[11px] font-medium text-stone-500">
            Recent exports
          </p>
          <div className="mt-2 max-w-sm divide-y divide-stone-900/[0.06] text-[11.5px]">
            {[
              ["workspace-activity.csv", "Oct 28", "1.2 MB"],
              ["workspace-activity.csv", "Sep 30", "1.1 MB"],
              ["workspace-activity.csv", "Aug 29", "940 KB"],
            ].map(([name, date, size]) => (
              <p
                key={date}
                className="flex items-center gap-3 py-2 text-stone-600"
              >
                <span className="min-w-0 flex-1 truncate">{name}</span>
                <span className="text-stone-400">{date}</span>
                <span className="w-12 text-right text-stone-400 tabular-nums">
                  {size}
                </span>
              </p>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
