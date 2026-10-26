import {
  ArrowRight01Icon,
  BookOpen01Icon,
  ComputerTerminal01Icon,
  Download01Icon,
  LinkSquare02Icon,
  PencilEdit02Icon,
  Search01Icon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { env } from "@repo/env/client"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@repo/ui/components/collapsible"
import { FileTypeIcon } from "@repo/ui/components/file-type-icon"
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtStep,
  ChainOfThoughtStepContent,
  type ChainOfThoughtStepStatus,
  ChainOfThoughtStepTitle,
  ChainOfThoughtTrigger,
} from "@repo/ui/components/nexus-ui/chain-of-thought"
import { cn } from "@repo/ui/lib/utils"
import { type ComponentType, useState } from "react"
import { MessageMarkdown } from "@/components/chat/message-markdown"
import { useOpenFile } from "@/hooks/use-file-panel"
import type { LorToolCallView } from "@/lib/api-types"
import {
  connectorForTool,
  connectorForUrl,
  connectorLogo,
  GlobeMark,
} from "@/lib/connector-ui"

// Codex/Cursor-style tool trail: a collapsible summary of the tools Lor used
// to answer, each row drillable into its result. Built on Nexus's Chain of
// Thought, which supplies the timeline rail, per-step status, shimmer while a
// step runs, and auto-open/close as steps change state. Expanded live while
// streaming (so progress shows), collapsed once settled; the root stays
// controlled so history doesn't flash open before auto-closing.

// Brand marks and hugeicons glyphs share one shape here.
type TrailIcon = ComponentType<{ className?: string }>

function glyph(icon: IconSvgElement): TrailIcon {
  return (props: { className?: string }) => (
    <HugeiconsIcon icon={icon} strokeWidth={2} {...props} />
  )
}

const SearchGlyph = glyph(Search01Icon)
const DownloadGlyph = glyph(Download01Icon)
const ReadGlyph = glyph(BookOpen01Icon)
const TerminalGlyph = glyph(ComputerTerminal01Icon)
const WriteGlyph = glyph(PencilEdit02Icon)
const WrenchGlyph = glyph(Wrench01Icon)
const ExternalLinkGlyph = glyph(LinkSquare02Icon)

export function toolIcon(toolName: string): TrailIcon {
  // Connector tools wear their brand mark; built-in tools get an action glyph.
  const connector = connectorForTool(toolName)
  if (connector) return connectorLogo(connector)
  switch (toolName) {
    case "search_sources":
    case "search_messages":
    case "grep":
    case "find":
    case "glob":
      return SearchGlyph
    case "search_web":
    case "fetch_web":
    // Claude Code's own web tools.
    case "webSearch":
    case "WebFetch":
      return GlobeMark
    case "fetch_source":
    case "export_tool_result":
      return DownloadGlyph
    case "ls":
    case "read":
    case "memory_ls":
    case "memory_read":
      return ReadGlyph
    case "bash":
      return TerminalGlyph
    case "write":
    case "edit":
    case "NotebookEdit":
    case "share_file":
    case "memory_write":
    case "memory_edit":
    case "memory_link":
      return WriteGlyph
    default:
      return WrenchGlyph
  }
}

// Provider logo for a result item, inferred from its url; falls back to a
// generic external-link glyph.
function itemIcon(url?: string): TrailIcon {
  const connector = connectorForUrl(url)
  return connector ? connectorLogo(connector) : ExternalLinkGlyph
}

// Web results carry a favicon marker — badge them Codex-style, loading the
// icon through our /v1/favicon proxy by the result url's hostname (never the
// third-party favicon url directly). Everything else, and any result whose
// url is missing/unparseable or whose favicon fails to load, keeps the
// connector/external-link glyph.
function ItemGlyph({ item }: { item: { url?: string; favicon?: string } }) {
  const [failed, setFailed] = useState(false)
  const Icon = itemIcon(item.url)
  let host: string | null = null
  if (item.favicon && item.url && !failed) {
    try {
      host = new URL(item.url).hostname
    } catch {
      host = null
    }
  }
  if (!host) return <Icon className="size-3 shrink-0" />
  return (
    <img
      src={`${env.NEXT_PUBLIC_API_URL}/v1/favicon/${encodeURIComponent(host)}`}
      alt=""
      loading="lazy"
      className="size-3 shrink-0 rounded-[3px] object-contain"
      onError={() => setFailed(true)}
    />
  )
}

function hasDetail(t: LorToolCallView): boolean {
  return Boolean(t.detail?.summary || (t.detail?.items?.length ?? 0) > 0)
}

function diffLineClass(line: string): string {
  if (
    line.startsWith("+++") ||
    line.startsWith("---") ||
    line.startsWith("@@")
  ) {
    return "text-muted-foreground/60"
  }
  if (line.startsWith("+")) return "bg-success/10 text-success"
  if (line.startsWith("-")) return "bg-destructive/10 text-destructive"
  return "text-muted-foreground/80"
}

function DiffCounts({ diff }: { diff: NonNullable<LorToolCallView["diff"]> }) {
  return (
    <span className="shrink-0 tabular-nums">
      <span className="text-success">+{diff.additions}</span>
      {diff.deletions > 0 && (
        <span className="ml-1 text-destructive">−{diff.deletions}</span>
      )}
    </span>
  )
}

type DeliveredFile = NonNullable<LorToolCallView["files"]>[number]

// Pi labels read "<Verb> <target>" (piToolLabel); the target shows in mono
// so the verb scans.
const TARGET_TOOLS = new Set(["read", "write", "edit", "ls", "bash"])
// Pi's sandbox tools as Lor calls them directly (find is exposed as glob).
const SANDBOX_TOOLS = new Set([
  "bash",
  "read",
  "write",
  "edit",
  "grep",
  "glob",
  "ls",
])
function splitLabel(toolCall: LorToolCallView) {
  const space = toolCall.label.indexOf(" ")
  if (!TARGET_TOOLS.has(toolCall.toolName) || space < 0) {
    return { verb: toolCall.label, target: null }
  }
  return {
    verb: toolCall.label.slice(0, space),
    target: toolCall.label.slice(space + 1),
  }
}

// A sandbox call that wrote one of the files the turn shared (shared paths
// are relative to the work folder).
function deliveredFile(path: string | null, delivered: DeliveredFile[]) {
  if (!path) return undefined
  return delivered.find(
    (file) => path === file.path || path.endsWith(`/${file.path}`)
  )
}

// One sandbox call, flat: verb, target (or a chip for a file the turn
// shared, which opens it), diff counts. The whole row opens its diff or
// output once.
function SandboxRow({
  toolCall,
  delivered,
}: {
  toolCall: LorToolCallView
  delivered: DeliveredFile[]
}) {
  const openFile = useOpenFile()
  const [open, setOpen] = useState(false)
  const Icon = toolIcon(toolCall.toolName)
  const { verb, target } = splitLabel(toolCall)
  const diff = toolCall.diff
  const file = deliveredFile(diff?.path ?? target, delivered)
  const summary = toolCall.detail?.summary
  const expandable = Boolean(diff?.patch || summary)

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="min-w-0 w-full">
      <div className="relative flex min-w-0 items-center gap-1.5 rounded-sm text-muted-foreground text-xs hover:text-foreground">
        {expandable && (
          <CollapsibleTrigger
            aria-label={toolCall.label}
            className="absolute inset-0 cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        )}
        <Icon className="size-3 shrink-0" />
        <span className="shrink-0">{verb}</span>
        {file ? (
          <button
            type="button"
            title={`Open ${file.path}`}
            onClick={() => openFile(file.artifactId)}
            className="relative z-10 inline-flex min-w-0 cursor-pointer items-center gap-1 rounded bg-muted px-1 py-px font-mono text-[11px] text-foreground transition-colors hover:bg-accent"
          >
            <FileTypeIcon filename={file.path} className="size-3.5" />
            <span className="truncate">{file.path}</span>
          </button>
        ) : target ? (
          <span className="min-w-0 truncate font-mono text-[11px]">
            {target}
          </span>
        ) : null}
        {diff && <DiffCounts diff={diff} />}
        {toolCall.status === "error" && (
          <span className="shrink-0 rounded bg-destructive/10 px-1 text-destructive">
            Failed
          </span>
        )}
        {expandable && (
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            className={cn(
              "size-3 shrink-0 transition-transform duration-150 ease-out",
              open && "rotate-90"
            )}
            strokeWidth={2}
          />
        )}
      </div>
      {expandable && (
        <CollapsibleContent>
          <div className="mt-1 mb-1 ml-4.5 max-h-64 overflow-auto rounded-md border border-border/50 bg-muted/30 font-mono text-[11px] leading-4">
            {diff?.patch && (
              <pre className="py-1.5">
                {diff.patch.split("\n").map((line, i) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: static patch lines
                    key={i}
                    className={`whitespace-pre-wrap break-all px-2 ${diffLineClass(line)}`}
                  >
                    {line || " "}
                  </div>
                ))}
                {diff.truncated && (
                  <div className="px-2 text-muted-foreground/60">
                    … diff truncated
                  </div>
                )}
              </pre>
            )}
            {summary && (
              <pre
                className={cn(
                  "whitespace-pre-wrap p-2 [overflow-wrap:anywhere]",
                  diff?.patch && "border-border/50 border-t"
                )}
              >
                {summary}
              </pre>
            )}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  )
}

// `status` is absent while a call is in flight. During streaming that means
// "running"; on a settled message it's a legacy row from before status was
// recorded, so it must not sit forever as pending.
function stepStatus(
  t: LorToolCallView,
  streaming?: boolean
): ChainOfThoughtStepStatus {
  if (t.status === "error") return "error"
  if (t.status === "ok") return "completed"
  return streaming ? "active" : "completed"
}

export function LorToolTrail({
  toolCalls,
  streaming,
  embedded = false,
}: {
  toolCalls: LorToolCallView[]
  streaming?: boolean
  embedded?: boolean
}) {
  const [open, setOpen] = useState(false)
  if (toolCalls.length === 0) return null
  // Files Lor shared this turn; a sandbox row that wrote one shows its chip.
  const shared = toolCalls.flatMap((t) => t.files ?? [])

  // Force open while streaming so live progress is visible; collapse to a
  // summary once the answer settles (the user can re-open).
  const expanded = embedded || open || Boolean(streaming)
  const summary = streaming
    ? (toolCalls[toolCalls.length - 1]?.label ?? "Working…")
    : `Used ${toolCalls.length} tool${toolCalls.length === 1 ? "" : "s"}`

  return (
    <ChainOfThought className="mt-1" open={expanded} onOpenChange={setOpen}>
      {!embedded && <ChainOfThoughtTrigger>{summary}</ChainOfThoughtTrigger>}
      <ChainOfThoughtContent className="mt-1.5 space-y-1.5">
        {toolCalls.map((t) => {
          // Lor's sandbox work reads as flat rows (session-files-runbook.md
          // decision 5).
          if (SANDBOX_TOOLS.has(t.toolName)) {
            return (
              <SandboxRow key={t.toolCallId} toolCall={t} delivered={shared} />
            )
          }
          const Icon = toolIcon(t.toolName)
          const drillable = hasDetail(t)
          return (
            <ChainOfThoughtStep
              key={t.toolCallId}
              status={stepStatus(t, streaming)}
              hasContent={drillable}
              // Nexus opens steps by default; the trail is a summary, so rows
              // start closed and only auto-open while one is running.
              defaultOpen={false}
              autoCloseOnComplete
            >
              <ChainOfThoughtStepTitle icon={<Icon className="size-3.5" />}>
                {t.label}
              </ChainOfThoughtStepTitle>
              {drillable && (
                <ChainOfThoughtStepContent className="space-y-1">
                  {t.detail?.summary && (
                    // Full output, markdown parsed but kept dim and small so it
                    // reads as detail under the step; scrollable so the user can
                    // read everything.
                    <div className="max-h-80 overflow-y-auto">
                      <MessageMarkdown
                        content={t.detail.summary}
                        mentions={[]}
                        className="text-muted-foreground/80 text-xs [&_*]:!text-xs"
                      />
                    </div>
                  )}
                  {t.detail?.items?.map((it) => {
                    const key = `${t.toolCallId}:${it.url ?? it.title}`
                    return it.url ? (
                      <a
                        key={key}
                        href={it.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex cursor-pointer items-center gap-1 text-primary text-xs hover:text-primary/80"
                      >
                        <ItemGlyph item={it} />
                        <span className="truncate underline-offset-2 hover:underline">
                          {it.title}
                        </span>
                      </a>
                    ) : (
                      <span
                        key={key}
                        className="inline-flex items-center gap-1 text-muted-foreground text-xs"
                      >
                        <ItemGlyph item={it} />
                        <span className="truncate">{it.title}</span>
                      </span>
                    )
                  })}
                </ChainOfThoughtStepContent>
              )}
            </ChainOfThoughtStep>
          )
        })}
      </ChainOfThoughtContent>
    </ChainOfThought>
  )
}
