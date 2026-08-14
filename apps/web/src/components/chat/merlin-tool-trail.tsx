import { env } from "@repo/env/client"
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtStep,
  ChainOfThoughtStepContent,
  type ChainOfThoughtStepStatus,
  ChainOfThoughtStepTitle,
  ChainOfThoughtTrigger,
} from "@repo/ui/components/nexus-ui/chain-of-thought"
import {
  BookOpen,
  ChevronRight,
  Code,
  Download,
  ExternalLink,
  PencilLine,
  Search,
  Terminal,
  Wrench,
} from "lucide-react"
import { type ComponentType, useState } from "react"
import { MessageMarkdown } from "@/components/chat/message-markdown"
import type { MerlinToolCallView } from "@/lib/api-types"
import {
  connectorForTool,
  connectorForUrl,
  connectorLogo,
  GlobeMark,
} from "@/lib/connector-ui"

// Codex/Cursor-style tool trail: a collapsible summary of the tools Merlin used
// to answer, each row drillable into its result. Built on Nexus's Chain of
// Thought, which supplies the timeline rail, per-step status, shimmer while a
// step runs, and auto-open/close as steps change state. Expanded live while
// streaming (so progress shows), collapsed once settled; the root stays
// controlled so history doesn't flash open before auto-closing.

// Brand marks and lucide glyphs share one shape here.
type TrailIcon = ComponentType<{ className?: string }>

function toolIcon(toolName: string): TrailIcon {
  // Connector tools wear their brand mark; built-in tools get an action glyph.
  const connector = connectorForTool(toolName)
  if (connector) return connectorLogo(connector)
  switch (toolName) {
    case "investigate_code":
      return Code
    case "search_sources":
    case "search_messages":
    case "grep":
    case "find":
      return Search
    case "search_web":
    case "fetch_web":
      return GlobeMark
    case "fetch_source":
      return Download
    case "ls":
    case "tree":
    case "read":
      return BookOpen
    case "bash":
      return Terminal
    case "write":
    case "mkdir":
    case "move":
    case "link":
      return PencilLine
    default:
      return Wrench
  }
}

// Provider logo for a result item, inferred from its url; falls back to a
// generic external-link glyph.
function itemIcon(url?: string): TrailIcon {
  const connector = connectorForUrl(url)
  return connector ? connectorLogo(connector) : ExternalLink
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

function hasDetail(t: MerlinToolCallView): boolean {
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

function DiffCounts({
  diff,
}: {
  diff: NonNullable<MerlinToolCallView["diff"]>
}) {
  return (
    <span className="shrink-0 tabular-nums">
      <span className="text-success">+{diff.additions}</span>
      {diff.deletions > 0 && (
        <span className="ml-1 text-destructive">−{diff.deletions}</span>
      )}
    </span>
  )
}

// A nested sandbox sub-step. File changes (write/edit) get Codex-style
// +N/−N counts and expand into the unified diff.
function SubStepRow({ toolCall }: { toolCall: MerlinToolCallView }) {
  const [open, setOpen] = useState(false)
  const Icon = toolIcon(toolCall.toolName)
  const diff = toolCall.diff

  const row = (
    <>
      <Icon className="size-3 shrink-0" />
      <span className="truncate">{toolCall.label}</span>
      {diff && <DiffCounts diff={diff} />}
    </>
  )
  if (!diff?.patch) {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
        {row}
      </span>
    )
  }
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex cursor-pointer items-center gap-1.5 text-left text-muted-foreground text-xs hover:text-foreground"
      >
        {row}
        <ChevronRight
          className={`size-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>
      {open && (
        <pre className="max-h-64 overflow-auto rounded-md border border-border/50 bg-muted/30 p-2 font-mono text-[11px] leading-4">
          {diff.patch.split("\n").map((line, i) => (
            <div
              // Patch lines have no identity beyond position.
              // biome-ignore lint/suspicious/noArrayIndexKey: static content
              key={i}
              className={`whitespace-pre-wrap break-all px-1 ${diffLineClass(line)}`}
            >
              {line || " "}
            </div>
          ))}
          {diff.truncated && (
            <div className="px-1 text-muted-foreground/60">
              … diff truncated
            </div>
          )}
        </pre>
      )}
    </div>
  )
}

// `status` is absent while a call is in flight. During streaming that means
// "running"; on a settled message it's a legacy row from before status was
// recorded, so it must not sit forever as pending.
function stepStatus(
  t: MerlinToolCallView,
  streaming?: boolean
): ChainOfThoughtStepStatus {
  if (t.status === "error") return "error"
  if (t.status === "ok") return "completed"
  return streaming ? "active" : "completed"
}

export function MerlinToolTrail({
  toolCalls,
  childrenByParent,
  streaming,
}: {
  toolCalls: MerlinToolCallView[]
  childrenByParent?: Map<string, MerlinToolCallView[]>
  streaming?: boolean
}) {
  const [open, setOpen] = useState(false)
  if (toolCalls.length === 0) return null

  // Force open while streaming so live progress is visible; collapse to a
  // summary once the answer settles (the user can re-open).
  const expanded = open || Boolean(streaming)
  const summary = streaming
    ? (toolCalls[toolCalls.length - 1]?.label ?? "Working…")
    : `Used ${toolCalls.length} tool${toolCalls.length === 1 ? "" : "s"}`

  return (
    <ChainOfThought className="mt-1" open={expanded} onOpenChange={setOpen}>
      <ChainOfThoughtTrigger>{summary}</ChainOfThoughtTrigger>
      <ChainOfThoughtContent className="mt-1.5 space-y-1.5">
        {toolCalls.map((t) => {
          const Icon = toolIcon(t.toolName)
          const children = childrenByParent?.get(t.toolCallId) ?? []
          const drillable = hasDetail(t) || children.length > 0
          return (
            <ChainOfThoughtStep
              key={t.toolCallId}
              status={stepStatus(t, streaming)}
              hasContent={drillable}
              // Nexus opens steps by default; the trail is a summary, so rows
              // start closed and only auto-open while one is running.
              defaultOpen={false}
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
                  {/* Nested sub-steps (e.g. the code agent's own tool calls),
                      streamed live as it explores. */}
                  {children.length > 0 && (
                    <div className="flex flex-col gap-1 border-border/50 border-l pl-2.5">
                      {children.map((c) => (
                        <SubStepRow key={c.toolCallId} toolCall={c} />
                      ))}
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
