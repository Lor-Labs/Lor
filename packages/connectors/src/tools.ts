import type { IntegrationProvider, LorCapability } from "@repo/db/schema"

export type ConnectorToolDescriptor = {
  name: string
  capability: LorCapability
  label: string
  description: string
  readOnlyHint: boolean
  defaultEnabled: boolean
}

// Upstream names verified against Better Stack's official MCP reference/examples.
export const BETTERSTACK_TOOLS: readonly (ConnectorToolDescriptor & {
  upstreamName: string
})[] = [
  {
    name: "list_betterstack_applications",
    capability: "betterstack",
    upstreamName: "applications",
    label: "List applications",
    description: "Discover error-tracking applications.",
    readOnlyHint: true,
    defaultEnabled: true,
  },
  {
    name: "list_betterstack_errors",
    capability: "betterstack",
    upstreamName: "errors",
    label: "List errors",
    description: "List error groups, counts, and triage states.",
    readOnlyHint: true,
    defaultEnabled: true,
  },
  {
    name: "fetch_betterstack_error",
    capability: "betterstack",
    upstreamName: "error",
    label: "Read error",
    description: "Inspect an error, call site, and occurrences.",
    readOnlyHint: true,
    defaultEnabled: true,
  },
  {
    name: "list_betterstack_sources",
    capability: "betterstack",
    upstreamName: "sources",
    label: "List sources",
    description: "Discover telemetry sources.",
    readOnlyHint: true,
    defaultEnabled: true,
  },
  {
    name: "fetch_betterstack_source",
    capability: "betterstack",
    upstreamName: "source",
    label: "Read source",
    description: "Inspect source collections and configuration.",
    readOnlyHint: true,
    defaultEnabled: true,
  },
  {
    name: "list_betterstack_source_fields",
    capability: "betterstack",
    upstreamName: "source_fields",
    label: "List source fields",
    description: "Discover fields for log and span queries.",
    readOnlyHint: true,
    defaultEnabled: true,
  },
  {
    name: "get_betterstack_query_help",
    capability: "betterstack",
    upstreamName: "query_help",
    label: "Read query guidance",
    description: "Get the source-specific logs and spans query syntax.",
    readOnlyHint: true,
    defaultEnabled: true,
  },
  {
    name: "get_betterstack_errors_query_help",
    capability: "betterstack",
    upstreamName: "errors_query_help",
    label: "Read error query guidance",
    description: "Get the exception and error-pattern query syntax.",
    readOnlyHint: true,
    defaultEnabled: true,
  },
  {
    name: "plan_betterstack_query_windows",
    capability: "betterstack",
    upstreamName: "query_windows",
    label: "Plan query windows",
    description: "Estimate scan size and split long-range queries.",
    readOnlyHint: true,
    defaultEnabled: true,
  },
  {
    name: "query_betterstack",
    capability: "betterstack",
    upstreamName: "query",
    label: "Query telemetry",
    description:
      "Read logs, traces, metrics, or exceptions with ClickHouse SQL.",
    readOnlyHint: true,
    defaultEnabled: true,
  },
  {
    name: "list_betterstack_incidents",
    capability: "betterstack",
    upstreamName: "incidents",
    label: "List incidents",
    description: "List uptime and monitoring incidents.",
    readOnlyHint: true,
    defaultEnabled: true,
  },
  {
    name: "fetch_betterstack_incident",
    capability: "betterstack",
    upstreamName: "incident",
    label: "Read incident",
    description: "Inspect an incident and its cause.",
    readOnlyHint: true,
    defaultEnabled: true,
  },
  {
    name: "list_betterstack_monitors",
    capability: "betterstack",
    upstreamName: "monitors",
    label: "List monitors",
    description: "List uptime monitors and current status.",
    readOnlyHint: true,
    defaultEnabled: true,
  },
  {
    name: "fetch_betterstack_monitor",
    capability: "betterstack",
    upstreamName: "monitor",
    label: "Read monitor",
    description: "Inspect an uptime monitor.",
    readOnlyHint: true,
    defaultEnabled: true,
  },
  {
    name: "resolve_betterstack_incident",
    capability: "betterstack_write",
    upstreamName: "resolve_incident",
    label: "Resolve incident",
    description: "Mark an incident as resolved; this can notify responders.",
    readOnlyHint: false,
    defaultEnabled: false,
  },
  {
    name: "update_betterstack_error_state",
    capability: "betterstack_write",
    upstreamName: "update_error_state",
    label: "Update error state",
    description:
      "Resolve, ignore, or reopen an error and change its notification settings.",
    readOnlyHint: false,
    defaultEnabled: false,
  },
]

// This catalog is reviewed by Lor; custom MCP hints remain provider declarations.
export const CONNECTOR_TOOLS: Record<
  IntegrationProvider,
  readonly ConnectorToolDescriptor[]
> = {
  github: [
    {
      name: "search_github",
      capability: "github",
      label: "Search GitHub",
      description: "Search pull requests and issues.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
    {
      name: "fetch_github",
      capability: "github",
      label: "Read GitHub item",
      description: "Read a pull request or issue and discussion.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
    {
      name: "investigate_code",
      capability: "code_intelligence",
      label: "Investigate code",
      description: "Analyze connected repositories.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
    {
      name: "propose_code_change",
      capability: "code_actions",
      label: "Propose code change",
      description: "Push a branch and open a draft pull request.",
      readOnlyHint: false,
      defaultEnabled: true,
    },
  ],
  linear: [
    {
      name: "search_linear",
      capability: "linear",
      label: "Search Linear",
      description: "Find issues by keyword.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
    {
      name: "list_linear_issues",
      capability: "linear",
      label: "List Linear issues",
      description: "List work by team, state, assignee, or project.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
    {
      name: "fetch_linear",
      capability: "linear",
      label: "Read Linear issue",
      description: "Read an issue and its comments.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
    {
      name: "create_linear_issue",
      capability: "linear_write",
      label: "Create issue",
      description: "Create a Linear issue.",
      readOnlyHint: false,
      defaultEnabled: true,
    },
    {
      name: "comment_linear",
      capability: "linear_write",
      label: "Comment on issue",
      description: "Add a comment to an issue.",
      readOnlyHint: false,
      defaultEnabled: true,
    },
    {
      name: "update_linear_issue",
      capability: "linear_write",
      label: "Update issue",
      description: "Change issue fields and workflow state.",
      readOnlyHint: false,
      defaultEnabled: true,
    },
  ],
  datadog: [
    {
      name: "search_datadog_logs",
      capability: "datadog",
      label: "Search logs",
      description: "Search indexed Datadog logs.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
    {
      name: "analyze_datadog_logs",
      capability: "datadog",
      label: "Analyze logs",
      description: "Count and aggregate Datadog logs.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
  ],
  attio: [
    {
      name: "search_attio",
      capability: "attio",
      label: "Search CRM",
      description: "Search CRM records.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
    {
      name: "fetch_attio_record",
      capability: "attio",
      label: "Read CRM record",
      description: "Read record values and relationships.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
    {
      name: "query_attio",
      capability: "attio",
      label: "Query CRM",
      description: "Read schemas, records, and pipelines.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
    {
      name: "fetch_attio_activity",
      capability: "attio",
      label: "Read CRM activity",
      description: "Read notes, meetings, and transcripts.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
  ],
  notion: [
    {
      name: "search_notion",
      capability: "notion",
      label: "Search Notion",
      description: "Find selected pages and data sources.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
    {
      name: "fetch_notion_page",
      capability: "notion",
      label: "Read page",
      description: "Read page content, properties, and comments.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
    {
      name: "query_notion_data_source",
      capability: "notion",
      label: "Query database",
      description: "Read database schemas and rows.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
    {
      name: "list_notion_users",
      capability: "notion",
      label: "List people",
      description: "Resolve workspace people without email addresses.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
  ],
  cloudwatch: [
    {
      name: "list_cloudwatch_log_groups",
      capability: "cloudwatch",
      label: "List log groups",
      description: "Discover CloudWatch log groups.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
    {
      name: "search_cloudwatch_logs",
      capability: "cloudwatch",
      label: "Search logs",
      description: "Run a Logs Insights query.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
    {
      name: "list_cloudwatch_metrics",
      capability: "cloudwatch",
      label: "List metrics",
      description: "Discover metric namespaces and dimensions.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
    {
      name: "get_cloudwatch_metrics",
      capability: "cloudwatch",
      label: "Read metrics",
      description: "Fetch metric datapoints.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
  ],
  betterstack: BETTERSTACK_TOOLS,
  webhook: [],
}

export function recommendedConnectorTools(
  provider: IntegrationProvider
): string[] {
  return CONNECTOR_TOOLS[provider]
    .filter((tool) => tool.defaultEnabled)
    .map((tool) => tool.name)
}

export function enabledConnectorTools(
  provider: IntegrationProvider,
  saved: readonly string[]
): string[] {
  const names = new Set(saved)
  return CONNECTOR_TOOLS[provider]
    .filter((tool) => names.has(tool.name))
    .map((tool) => tool.name)
}
