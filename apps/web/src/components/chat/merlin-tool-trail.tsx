import { env } from "@repo/env/client"
import { cn } from "@repo/ui/lib/utils"
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
// to answer, each row drillable into its result. Expanded live while streaming
// (so progress shows), collapsed once settled; persisted, so it survives reload.

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
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({})
  if (toolCalls.length === 0) return null

  // Force open while streaming so live progress is visible; collapse to a summary
  // once the answer settles (the user can re-open).
  const expanded = open || Boolean(streaming)
  const summary = streaming
    ? (toolCalls[toolCalls.length - 1]?.label ?? "Working…")
    : `Used ${toolCalls.length} tool${toolCalls.length === 1 ? "" : "s"}`

  return (
    <div className="mt-1 text-[11px] text-muted-foreground">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex max-w-full cursor-pointer items-center gap-1 rounded px-0.5 hover:text-foreground"
      >
        <ChevronRight
          className={cn(
            "size-3 shrink-0 transition-transform",
            expanded && "rotate-90",
            streaming && "animate-pulse"
          )}
        />
        <span className={cn("truncate", streaming && "shimmer")}>
          {summary}
        </span>
      </button>

      {expanded && (
        <div className="mt-0.5 flex flex-col gap-0.5 border-muted-foreground/15 border-l pl-2">
          {toolCalls.map((t) => {
            const Icon = toolIcon(t.toolName)
            const drillable = hasDetail(t)
            const rowOpen = openRows[t.toolCallId] ?? false
            const children = childrenByParent?.get(t.toolCallId) ?? []
            return (
              <div key={t.toolCallId}>
                <button
                  type="button"
                  disabled={!drillable}
                  aria-expanded={drillable ? rowOpen : undefined}
                  onClick={() =>
                    setOpenRows((m) => ({ ...m, [t.toolCallId]: !rowOpen }))
                  }
                  className={cn(
                    "flex w-full items-center gap-1.5 rounded px-0.5 text-left",
                    drillable && "cursor-pointer hover:text-foreground"
                  )}
                >
                  <Icon className="size-3 shrink-0" />
                  <span className="truncate">{t.label}</span>
                  {t.status === "error" && (
                    <span className="shrink-0 text-destructive">failed</span>
                  )}
                  {drillable && (
                    <ChevronRight
                      className={cn(
                        "ml-auto size-3 shrink-0 transition-transform",
                        rowOpen && "rotate-90"
                      )}
                    />
                  )}
                </button>
                {/* Nested sub-steps (e.g. the code agent's own tool calls),
                    streamed live as it explores. */}
                {children.length > 0 && (
                  <div className="mt-0.5 ml-[18px] flex flex-col gap-0.5 border-muted-foreground/15 border-l pl-2">
                    {children.map((c) => {
                      const ChildIcon = toolIcon(c.toolName)
                      return (
                        <span
                          key={c.toolCallId}
                          className="inline-flex items-center gap-1.5"
                        >
                          <ChildIcon className="size-3 shrink-0" />
                          <span className="truncate">{c.label}</span>
                        </span>
                      )
                    })}
                  </div>
                )}
                {drillable && rowOpen && (
                  <div className="mt-0.5 mb-1 ml-[18px] flex flex-col gap-1">
                    {t.detail?.summary && (
                      // Full output, markdown parsed but kept dimmed + 11px to
                      // match the trail (the [&_*] rule downsizes Streamdown's
                      // headings); scrollable so the user can read everything.
                      <div className="max-h-80 overflow-y-auto">
                        <MessageMarkdown
                          content={t.detail.summary}
                          mentions={[]}
                          className="text-[11px] text-muted-foreground/80 [&_*]:!text-[11px]"
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
                          className="inline-flex cursor-pointer items-center gap-1 text-primary hover:text-primary/80"
                        >
                          <ItemGlyph item={it} />
                          <span className="truncate underline-offset-2 hover:underline">
                            {it.title}
                          </span>
                        </a>
                      ) : (
                        <span
                          key={key}
                          className="inline-flex items-center gap-1"
                        >
                          <ItemGlyph item={it} />
                          <span className="truncate">{it.title}</span>
                        </span>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
