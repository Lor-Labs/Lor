import type { IntegrationProvider } from "@repo/db/schema"

export type ConnectorToolDescriptor = {
  name: string
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
    upstreamName: "applications",
    label: "List applications",
    description: "Discover error-tracking applications.",
    readOnlyHint: true,
    defaultEnabled: true,
  },
  {
    name: "list_betterstack_errors",
    upstreamName: "errors",
    label: "List errors",
    description: "List error groups, counts, and triage states.",
    readOnlyHint: true,
    defaultEnabled: true,
  },
  {
    name: "fetch_betterstack_error",
    upstreamName: "error",
    label: "Read error",
    description: "Inspect an error, call site, and occurrences.",
    readOnlyHint: true,
    defaultEnabled: true,
  },
  {
    name: "list_betterstack_sources",
    upstreamName: "sources",
    label: "List sources",
    description: "Discover telemetry sources.",
    readOnlyHint: true,
    defaultEnabled: true,
  },
  {
    name: "fetch_betterstack_source",
    upstreamName: "source",
    label: "Read source",
    description: "Inspect source collections and configuration.",
    readOnlyHint: true,
    defaultEnabled: true,
  },
  {
    name: "list_betterstack_source_fields",
    upstreamName: "source_fields",
    label: "List source fields",
    description: "Discover fields for log and span queries.",
    readOnlyHint: true,
    defaultEnabled: true,
  },
  {
    name: "get_betterstack_query_help",
    upstreamName: "query_help",
    label: "Read query guidance",
    description: "Get the source-specific logs and spans query syntax.",
    readOnlyHint: true,
    defaultEnabled: true,
  },
  {
    name: "get_betterstack_errors_query_help",
    upstreamName: "errors_query_help",
    label: "Read error query guidance",
    description: "Get the exception and error-pattern query syntax.",
    readOnlyHint: true,
    defaultEnabled: true,
  },
  {
    name: "plan_betterstack_query_windows",
    upstreamName: "query_windows",
    label: "Plan query windows",
    description: "Estimate scan size and split long-range queries.",
    readOnlyHint: true,
    defaultEnabled: true,
  },
  {
    name: "query_betterstack",
    upstreamName: "query",
    label: "Query telemetry",
    description:
      "Read logs, traces, metrics, or exceptions with ClickHouse SQL.",
    readOnlyHint: true,
    defaultEnabled: true,
  },
  {
    name: "list_betterstack_incidents",
    upstreamName: "incidents",
    label: "List incidents",
    description: "List uptime and monitoring incidents.",
    readOnlyHint: true,
    defaultEnabled: true,
  },
  {
    name: "fetch_betterstack_incident",
    upstreamName: "incident",
    label: "Read incident",
    description: "Inspect an incident and its cause.",
    readOnlyHint: true,
    defaultEnabled: true,
  },
  {
    name: "list_betterstack_monitors",
    upstreamName: "monitors",
    label: "List monitors",
    description: "List uptime monitors and current status.",
    readOnlyHint: true,
    defaultEnabled: true,
  },
  {
    name: "fetch_betterstack_monitor",
    upstreamName: "monitor",
    label: "Read monitor",
    description: "Inspect an uptime monitor.",
    readOnlyHint: true,
    defaultEnabled: true,
  },
  {
    name: "resolve_betterstack_incident",
    upstreamName: "resolve_incident",
    label: "Resolve incident",
    description: "Mark an incident as resolved; this can notify responders.",
    readOnlyHint: false,
    defaultEnabled: false,
  },
  {
    name: "update_betterstack_error_state",
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
      label: "Search GitHub",
      description: "Search pull requests and issues.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
    {
      name: "fetch_github",
      label: "Read GitHub item",
      description: "Read a pull request or issue and discussion.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
    {
      name: "investigate_code",
      label: "Investigate code",
      description: "Analyze connected repositories.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
    {
      name: "propose_code_change",
      label: "Propose code change",
      description: "Push a branch and open a draft pull request.",
      readOnlyHint: false,
      defaultEnabled: true,
    },
  ],
  linear: [
    {
      name: "search_linear",
      label: "Search Linear",
      description: "Find issues by keyword.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
    {
      name: "list_linear_issues",
      label: "List Linear issues",
      description: "List work by team, state, assignee, or project.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
    {
      name: "fetch_linear",
      label: "Read Linear issue",
      description: "Read an issue and its comments.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
    {
      name: "create_linear_issue",
      label: "Create issue",
      description: "Create a Linear issue.",
      readOnlyHint: false,
      defaultEnabled: true,
    },
    {
      name: "comment_linear",
      label: "Comment on issue",
      description: "Add a comment to an issue.",
      readOnlyHint: false,
      defaultEnabled: true,
    },
    {
      name: "update_linear_issue",
      label: "Update issue",
      description: "Change issue fields and workflow state.",
      readOnlyHint: false,
      defaultEnabled: true,
    },
  ],
  datadog: [
    {
      name: "search_datadog_logs",
      label: "Search logs",
      description: "Search indexed Datadog logs.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
    {
      name: "analyze_datadog_logs",
      label: "Analyze logs",
      description: "Count and aggregate Datadog logs.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
  ],
  attio: [
    {
      name: "search_attio",
      label: "Search CRM",
      description: "Search CRM records.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
    {
      name: "fetch_attio_record",
      label: "Read CRM record",
      description: "Read record values and relationships.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
    {
      name: "query_attio",
      label: "Query CRM",
      description: "Read schemas, records, and pipelines.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
    {
      name: "fetch_attio_activity",
      label: "Read CRM activity",
      description: "Read notes, meetings, and transcripts.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
  ],
  notion: [
    {
      name: "search_notion",
      label: "Search Notion",
      description: "Find selected pages and data sources.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
    {
      name: "fetch_notion_page",
      label: "Read page",
      description: "Read page content, properties, and comments.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
    {
      name: "query_notion_data_source",
      label: "Query database",
      description: "Read database schemas and rows.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
    {
      name: "list_notion_users",
      label: "List people",
      description: "Resolve workspace people without email addresses.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
  ],
  cloudwatch: [
    {
      name: "list_cloudwatch_log_groups",
      label: "List log groups",
      description: "Discover CloudWatch log groups.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
    {
      name: "search_cloudwatch_logs",
      label: "Search logs",
      description: "Run a Logs Insights query.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
    {
      name: "list_cloudwatch_metrics",
      label: "List metrics",
      description: "Discover metric namespaces and dimensions.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
    {
      name: "get_cloudwatch_metrics",
      label: "Read metrics",
      description: "Fetch metric datapoints.",
      readOnlyHint: true,
      defaultEnabled: true,
    },
  ],
  betterstack: BETTERSTACK_TOOLS,
  webhook: [],
}

// Frozen rollout snapshot. Never extend this when adding tools to the catalog.
const LEGACY_TOOLS: Record<IntegrationProvider, readonly string[]> = {
  github: [
    "search_github",
    "fetch_github",
    "investigate_code",
    "propose_code_change",
  ],
  linear: [
    "search_linear",
    "list_linear_issues",
    "fetch_linear",
    "create_linear_issue",
    "comment_linear",
    "update_linear_issue",
  ],
  datadog: ["search_datadog_logs", "analyze_datadog_logs"],
  attio: [
    "search_attio",
    "fetch_attio_record",
    "query_attio",
    "fetch_attio_activity",
  ],
  notion: [
    "search_notion",
    "fetch_notion_page",
    "query_notion_data_source",
    "list_notion_users",
  ],
  cloudwatch: [
    "list_cloudwatch_log_groups",
    "search_cloudwatch_logs",
    "list_cloudwatch_metrics",
    "get_cloudwatch_metrics",
  ],
  betterstack: [],
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
  saved: readonly string[] | null
): string[] {
  const names = new Set(saved ?? LEGACY_TOOLS[provider])
  return CONNECTOR_TOOLS[provider]
    .filter((tool) => names.has(tool.name))
    .map((tool) => tool.name)
}
