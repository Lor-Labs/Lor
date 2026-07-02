import { DatadogLogo } from "@repo/ui/components/logos/datadog"
import { LinearLogo } from "@repo/ui/components/logos/linear"
import { cn } from "@repo/ui/lib/utils"
import { Github } from "lucide-react"
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

type ConnectorUI = {
  logo: Logo
  // Result URLs on this host belong to the connector (tool-trail links).
  urlHost: RegExp
  // Tool names the connector contributes (tool-trail row icons).
  tools: readonly string[]
}

// The single client-side registry for connector branding — exhaustive over the
// connector enum, so a new connector without an entry is a compile error. Add a
// connector here (logo + host + tools) and it lights up across settings, agent
// profiles, and the tool trail.
const CONNECTOR_UI: Record<ConnectorKey, ConnectorUI> = {
  github: {
    logo: Github,
    urlHost: /(^|\.)github\.com\b/i,
    tools: ["search_github", "fetch_github"],
  },
  linear: {
    logo: LinearMark,
    urlHost: /(^|\.)linear\.app\b/i,
    tools: [
      "search_linear",
      "fetch_linear",
      "create_linear_issue",
      "comment_linear",
    ],
  },
  datadog: {
    logo: DatadogMark,
    urlHost: /(^|\.)datadoghq\.(com|eu)\b/i,
    tools: ["search_datadog_logs", "analyze_datadog_logs"],
  },
}

const CONNECTOR_KEYS = Object.keys(CONNECTOR_UI) as ConnectorKey[]

export function connectorLogo(key: ConnectorKey): Logo {
  return CONNECTOR_UI[key].logo
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
