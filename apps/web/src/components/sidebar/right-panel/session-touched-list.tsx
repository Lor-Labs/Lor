import {
  AiBrain01Icon,
  BubbleChatIcon,
  Call02Icon,
  File01Icon,
  Link01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { cn } from "@repo/ui/lib/utils"
import { formatDateTime } from "@repo/utils/date"
import { Link } from "@tanstack/react-router"
import { type ReactNode, useState } from "react"
import type { SessionTouch } from "@/hooks/use-agent-session"
import { useOpenFile } from "@/hooks/use-file-panel"
import { useMessageIdNavigation } from "@/hooks/use-message-search-navigation"
import type { ConnectorKey } from "@/lib/api-types"
import {
  connectorForUrl,
  connectorLinkLabel,
  connectorLogo,
  isConnectorKey,
} from "@/lib/connector-ui"
import { toSearchPreviewText } from "@/lib/search-preview"

// What Lor's runs in a session read, cited, wrote or were pointed at, each
// with the other sessions that touched the same item: how Lor links issues,
// pages and sessions over time (the touch table, session-memory.md Step 5).
// Issues first, then pages and records, conversations, memory, files, links.

const SHOWN = 8

type Kind = SessionTouch["kind"]

const KIND_RANK: Record<Kind, number> = {
  linear_issue: 0,
  github_issue: 0,
  github_pr: 0,
  notion_page: 1,
  attio_record: 1,
  attio_list_entry: 1,
  attio_task: 1,
  source: 1,
  github_repo: 1,
  message: 2,
  call: 2,
  brain_page: 3,
  artifact: 4,
  betterstack_incident: 5,
  betterstack_error: 5,
  url: 6,
}

const KIND_CONNECTOR: Partial<Record<Kind, ConnectorKey>> = {
  linear_issue: "linear",
  github_issue: "github",
  github_pr: "github",
  github_repo: "github",
  notion_page: "notion",
  attio_record: "attio",
  attio_list_entry: "attio",
  attio_task: "attio",
  betterstack_incident: "betterstack",
  betterstack_error: "betterstack",
}

const KIND_ICON: Partial<Record<Kind, IconSvgElement>> = {
  message: BubbleChatIcon,
  call: Call02Icon,
  brain_page: AiBrain01Icon,
  artifact: File01Icon,
}

const ACTION_LABEL = {
  wrote: "Wrote",
  cited: "Cited",
  read: "Read",
  mentioned: "Mentioned",
  started_from: "Started from",
} as const
const ACTION_ORDER = ["wrote", "cited", "read", "mentioned", "started_from"]

function urlLabel(raw: string) {
  const known = connectorLinkLabel(raw)
  if (known) return known
  try {
    const url = new URL(raw)
    return `${url.hostname.replace(/^www\./, "")}${url.pathname === "/" ? "" : url.pathname}`
  } catch {
    return raw
  }
}

function describe(item: SessionTouch): { title: string; detail: string[] } {
  const state = item.detail ? [item.detail] : []
  switch (item.kind) {
    case "linear_issue":
    case "github_issue":
    case "github_pr":
      return {
        title: item.title ?? item.value,
        detail: item.title ? [item.value, ...state] : state,
      }
    case "github_repo":
      return { title: item.value, detail: [] }
    case "notion_page":
      return { title: item.title ?? "Notion page", detail: state }
    case "attio_record":
      return { title: item.title ?? "Attio record", detail: state }
    case "attio_list_entry":
      return { title: item.title ?? "Attio list entry", detail: state }
    case "attio_task":
      return { title: item.title ?? "Attio task", detail: state }
    case "source":
      return { title: item.title ?? "Source", detail: state }
    case "message":
      return {
        title: item.title ?? "Message",
        detail: [toSearchPreviewText(item.detail, item.mentions)],
      }
    case "call":
      return {
        title: item.title ?? "Call",
        detail: item.detail ? [formatDateTime(item.detail)] : [],
      }
    case "brain_page":
    case "artifact":
      return { title: item.title ?? item.value, detail: [] }
    case "betterstack_incident":
      return { title: `Incident ${item.value}`, detail: [] }
    case "betterstack_error":
      return {
        title: item.value.slice(item.value.indexOf(":") + 1),
        detail: [],
      }
    case "url":
      return { title: urlLabel(item.value), detail: [] }
  }
}

function ItemIcon({ item }: { item: SessionTouch }) {
  const icon = KIND_ICON[item.kind]
  if (icon) {
    return <HugeiconsIcon icon={icon} className="size-3.5" strokeWidth={2} />
  }
  const connector =
    KIND_CONNECTOR[item.kind] ??
    (isConnectorKey(item.provider) ? item.provider : null) ??
    connectorForUrl(item.url ?? undefined)
  if (!connector && item.kind === "url") {
    return (
      <HugeiconsIcon icon={Link01Icon} className="size-3.5" strokeWidth={2} />
    )
  }
  const Logo = connectorLogo(connector)
  return <Logo className="size-3.5" />
}

export function SessionTouchedList({
  items,
  workspaceSlug,
}: {
  items: SessionTouch[]
  workspaceSlug: string
}) {
  const [showAll, setShowAll] = useState(false)
  const sorted = [...items].sort(
    (a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]
  )
  const shown = showAll ? sorted : sorted.slice(0, SHOWN)
  return (
    <div className="flex flex-col gap-0.5">
      {shown.map((item) => (
        <TouchedRow
          key={`${item.kind}|${item.value}`}
          item={item}
          workspaceSlug={workspaceSlug}
        />
      ))}
      {sorted.length > SHOWN && (
        <button
          type="button"
          onClick={() => setShowAll(!showAll)}
          className="cursor-pointer self-start rounded-md px-1 py-0.5 text-muted-foreground text-xs transition-colors hover:text-foreground"
        >
          {showAll ? "Show fewer" : `Show all ${sorted.length}`}
        </button>
      )}
    </div>
  )
}

function TouchedRow({
  item,
  workspaceSlug,
}: {
  item: SessionTouch
  workspaceSlug: string
}) {
  const goToMessage = useMessageIdNavigation()
  const openFile = useOpenFile()
  const { title, detail } = describe(item)
  const actions = [...item.actions]
    .sort((a, b) => ACTION_ORDER.indexOf(a) - ACTION_ORDER.indexOf(b))
    .map((action, index) =>
      index === 0 ? ACTION_LABEL[action] : ACTION_LABEL[action].toLowerCase()
    )
    .join(", ")
  const meta = [...detail, actions].filter(Boolean).join(" · ")

  const body = (
    <>
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-muted-foreground">
        <ItemIcon item={item} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-foreground text-sm">{title}</span>
        <span className="truncate text-muted-foreground text-xs">{meta}</span>
      </span>
    </>
  )
  const rowClass =
    "flex w-full min-w-0 items-start gap-2 rounded-md px-1 py-1 text-left transition-colors"
  let row: ReactNode
  if (item.url) {
    row = (
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        title={title}
        className={cn(rowClass, "hover:bg-foreground/5")}
      >
        {body}
      </a>
    )
  } else if (item.messageId) {
    const messageId = item.messageId
    row = (
      <button
        type="button"
        title={title}
        onClick={() => void goToMessage(messageId)}
        className={cn(rowClass, "cursor-pointer hover:bg-foreground/5")}
      >
        {body}
      </button>
    )
  } else if (item.kind === "artifact") {
    row = (
      <button
        type="button"
        title={title}
        onClick={() => openFile(item.value)}
        className={cn(rowClass, "cursor-pointer hover:bg-foreground/5")}
      >
        {body}
      </button>
    )
  } else {
    row = (
      <div title={title} className={rowClass}>
        {body}
      </div>
    )
  }

  return (
    <div>
      {row}
      {item.otherSessionCount > 0 && (
        <p className="flex min-w-0 items-center gap-1 pb-1 pl-7 text-muted-foreground text-xs">
          <span className="shrink-0">Also in</span>
          {item.otherSessions.map((other, index) => (
            <span key={other.id} className="flex min-w-0 items-center gap-1">
              {index > 0 && <span aria-hidden="true">·</span>}
              <Link
                to="/$workspaceSlug/session/$sessionId"
                params={{ workspaceSlug, sessionId: other.id }}
                title={other.title}
                className="min-w-0 max-w-40 truncate font-medium transition-colors hover:text-foreground"
              >
                {other.title}
              </Link>
            </span>
          ))}
          {item.otherSessionCount > item.otherSessions.length && (
            <span className="shrink-0">
              +{item.otherSessionCount - item.otherSessions.length}
            </span>
          )}
        </p>
      )}
    </div>
  )
}
