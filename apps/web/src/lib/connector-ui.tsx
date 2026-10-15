import { Globe02Icon, WebhookIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { BETTERSTACK_TOOLS } from "@repo/connectors"
import { AttioLogo } from "@repo/ui/components/logos/attio"
import { AWSCloudWatchLogo } from "@repo/ui/components/logos/aws-cloudwatch"
import { BetterStackLogo } from "@repo/ui/components/logos/betterstack"
import { DatadogLogo } from "@repo/ui/components/logos/datadog"
import { GitHubLogo } from "@repo/ui/components/logos/github"
import { LinearLogo } from "@repo/ui/components/logos/linear"
import { NotionLogo } from "@repo/ui/components/logos/notion"
import { cn } from "@repo/ui/lib/utils"
import type { ComponentType } from "react"
import type { ConnectorKey } from "@/lib/api-types"

type Logo = ComponentType<{ className?: string }>

// fill-current so brand marks inherit the surrounding text color.
function LinearMark({ className }: { className?: string }) {
  return <LinearLogo variant="logo" className={cn(className, "fill-current")} />
}

// The Datadog mark hardcodes its brand fill on the path; override via CSS.
function DatadogMark({ className }: { className?: string }) {
  return <DatadogLogo className={cn(className, "[&_path]:fill-current")} />
}

function AttioMark({ className }: { className?: string }) {
  return <AttioLogo className={className} />
}

function NotionMark({ className }: { className?: string }) {
  return <NotionLogo className={className} />
}

// The CloudWatch mark ships a brand-pink tile behind a white glyph; drop the
// tile and let the glyph inherit the surrounding color, like the other marks.
function CloudwatchMark({ className }: { className?: string }) {
  return (
    <AWSCloudWatchLogo
      className={cn(
        className,
        "[&_rect]:fill-transparent [&_path]:fill-current"
      )}
    />
  )
}

function GithubMark({ className }: { className?: string }) {
  return <GitHubLogo className={className} />
}

function WebhookMark({ className }: { className?: string }) {
  return (
    <HugeiconsIcon icon={WebhookIcon} className={className} strokeWidth={2} />
  )
}

// Same glyph as mobile's Globe02Icon so web capabilities match across surfaces.
export function GlobeMark({ className }: { className?: string }) {
  return <HugeiconsIcon icon={Globe02Icon} className={className} />
}

type ConnectorUI = {
  logo: Logo
  // Result URLs on this host belong to the connector (tool-trail links).
  urlHost: RegExp
  // Tool names the connector contributes (tool-trail row icons).
  tools: readonly string[]
  // Chip label for a pasted url of this connector, derived without a round trip.
  linkLabel: (url: URL) => string | null
}

// "meeting-notes-2f0a…" → "meeting notes"
function prettifySlug(segment: string): string {
  return decodeURIComponent(segment)
    .replace(/-?[0-9a-f]{32}$/i, "")
    .replaceAll("-", " ")
    .trim()
}

function lastSegment(url: URL): string {
  const segments = url.pathname.split("/").filter(Boolean)
  return segments.at(-1) ?? url.hostname
}

// "#L12-L20" → ":12-20", the line range a file link was copied with.
function lineRange(url: URL): string {
  const match = url.hash.match(/^#L(\d+)(?:-L(\d+))?$/)
  if (!match) return ""
  return match[2] ? `:${match[1]}-${match[2]}` : `:${match[1]}`
}

function githubLabel(url: URL): string {
  const segments = url.pathname.split("/").filter(Boolean)
  const [owner, repo, kind, rest] = segments
  if (!(owner && repo)) return lastSegment(url)
  if (!(kind && rest)) return `${owner}/${repo}`
  if (kind === "pull" || kind === "issues") return `${owner}/${repo}#${rest}`
  if (kind === "commit") return `${owner}/${repo}@${rest.slice(0, 7)}`
  // blob/tree carry the ref in `rest`, then the path — which is the useful
  // label. Falls back to the repo for a bare branch link.
  if (kind === "blob" || kind === "tree") {
    const path = segments.slice(4).map(decodeURIComponent).join("/")
    return path ? `${path}${lineRange(url)}` : `${owner}/${repo}`
  }
  return `${owner}/${repo}`
}

function linearLabel(url: URL): string {
  const segments = url.pathname.split("/").filter(Boolean)
  const issueIndex = segments.indexOf("issue")
  const identifier = issueIndex >= 0 ? segments[issueIndex + 1] : null
  return identifier ?? (prettifySlug(lastSegment(url)) || lastSegment(url))
}

function attioLabel(url: URL): string {
  // app.attio.com/<workspace>/<object>/<recordId>/<tab>
  const [, object, recordId] = url.pathname.split("/").filter(Boolean)
  if (!object) return lastSegment(url)
  const name = prettifySlug(object)
  return recordId ? `${name} ${recordId.slice(0, 8)}` : name
}

// The single client-side registry for connector branding — exhaustive over the
// connector enum, so a new connector without an entry is a compile error. Add a
// connector here (logo + host + tools) and it lights up across settings, agent
// profiles, and the tool trail.
const CONNECTOR_UI: Record<ConnectorKey, ConnectorUI> = {
  github: {
    logo: GithubMark,
    urlHost: /(^|\.)github\.com\b/i,
    tools: ["search_github", "fetch_github"],
    linkLabel: githubLabel,
  },
  linear: {
    logo: LinearMark,
    urlHost: /(^|\.)linear\.app\b/i,
    tools: [
      "search_linear",
      "list_linear_issues",
      "fetch_linear",
      "create_linear_issue",
      "comment_linear",
      "update_linear_issue",
    ],
    linkLabel: linearLabel,
  },
  datadog: {
    logo: DatadogMark,
    // Anchored to the hostname end so datadoghq.com.evil.com can't wear the mark.
    urlHost: /(^|\.)datadoghq\.(com|eu)$/i,
    tools: ["search_datadog_logs", "analyze_datadog_logs"],
    linkLabel: () => "Datadog",
  },
  attio: {
    logo: AttioMark,
    urlHost: /(^|\.)attio\.com$/i,
    tools: [
      "search_attio",
      "fetch_attio_record",
      "query_attio",
      "fetch_attio_activity",
    ],
    linkLabel: attioLabel,
  },
  notion: {
    logo: NotionMark,
    urlHost: /(^|\.)notion\.(so|site|com)$/i,
    tools: [
      "search_notion",
      "fetch_notion_page",
      "query_notion_data_source",
      "list_notion_users",
    ],
    linkLabel: (url) => prettifySlug(lastSegment(url)) || lastSegment(url),
  },
  cloudwatch: {
    logo: CloudwatchMark,
    // Regional consoles are subdomains (us-east-1.console.aws.amazon.com).
    urlHost: /(^|\.)console\.aws\.amazon\.com$/i,
    tools: [
      "list_cloudwatch_log_groups",
      "search_cloudwatch_logs",
      "list_cloudwatch_metrics",
      "get_cloudwatch_metrics",
    ],
    linkLabel: () => "CloudWatch",
  },
  betterstack: {
    logo: BetterStackLogo,
    urlHost: /(^|\.)betterstack\.com$/i,
    tools: BETTERSTACK_TOOLS.map((tool) => tool.name),
    linkLabel: () => "Better Stack",
  },
  // BYO inbound webhooks have no agent tools or URL host.
  webhook: {
    logo: WebhookMark,
    urlHost: /$^/,
    tools: [],
    linkLabel: () => null,
  },
}

const CONNECTOR_KEYS = Object.keys(CONNECTOR_UI) as ConnectorKey[]

const CONNECTOR_BRANDS: Partial<
  Record<ConnectorKey, { accent: string; avatarClassName: string }>
> = {
  github: {
    accent: "#24292f",
    avatarClassName:
      "bg-[#24292f]! text-white! dark:bg-[#f0f6fc]! dark:text-[#24292f]!",
  },
  linear: {
    accent: "#5e6ad2",
    avatarClassName:
      "bg-[#5e6ad2]! text-white! shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]",
  },
}

// Null = a built-in capability with no connector (web) — wears the globe, which
// is also the fallback for a key outside the registry (pasted HTML can carry an
// arbitrary data-connector into a composer chip).
export function connectorLogo(key: ConnectorKey | null): Logo {
  return (key ? CONNECTOR_UI[key]?.logo : null) ?? GlobeMark
}

export function connectorAccentColor(key: ConnectorKey): string | undefined {
  return CONNECTOR_BRANDS[key]?.accent
}

export function connectorAvatarClassName(
  key: ConnectorKey
): string | undefined {
  return CONNECTOR_BRANDS[key]?.avatarClassName
}

// hasOwn, not `in` — otherwise "toString" and friends read as connectors.
export function isConnectorKey(value: unknown): value is ConnectorKey {
  return typeof value === "string" && Object.hasOwn(CONNECTOR_UI, value)
}

// The connector behind a bot display name ("GitHub" → github) — used to brand
// webhook/connector message avatars. Labels lowercase to the connector ids.
export function connectorForName(name?: string | null): ConnectorKey | null {
  if (!name) return null
  const key = name.toLowerCase().replaceAll(" ", "")
  return CONNECTOR_KEYS.find((k) => k === key) ?? null
}

// The connector a tool belongs to, or null for built-in (non-connector) tools.
export function connectorForTool(toolName: string): ConnectorKey | null {
  return (
    CONNECTOR_KEYS.find((key) => CONNECTOR_UI[key].tools.includes(toolName)) ??
    null
  )
}

// The connector a result URL belongs to, or null when it matches none.
export function connectorForUrl(url?: string): ConnectorKey | null {
  if (!url) return null
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return null
  }
  return (
    CONNECTOR_KEYS.find((key) => CONNECTOR_UI[key].urlHost.test(host)) ?? null
  )
}

// Chip label for a connector url, derived from the url alone.
export function connectorLinkLabel(url: string): string | null {
  const connector = connectorForUrl(url)
  if (!connector) return null
  try {
    return CONNECTOR_UI[connector].linkLabel(new URL(url)) || null
  } catch {
    return null
  }
}
