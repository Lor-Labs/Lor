import type { IntegrationProvider, LorCapability } from "@repo/db/schema"
import type {
  CapabilityDescriptor,
  ConnectorDescriptor,
  ConnectorEventDescriptor,
  ConnectorEventKey,
} from "./types"

// Exhaustive over integrationProviderEnum — adding a provider value without a
// descriptor here is a compile error.
export const CONNECTORS: Record<IntegrationProvider, ConnectorDescriptor> = {
  github: {
    id: "github",
    label: "GitHub",
    description:
      "Search pull requests and issues, analyze connected repositories, and propose changes as draft pull requests.",
    authType: "github-app",
    envKeys: [
      "GITHUB_APP_ID",
      "GITHUB_APP_PRIVATE_KEY",
      "GITHUB_APP_SLUG",
      "GITHUB_WEBHOOK_SECRET",
    ],
  },
  linear: {
    id: "linear",
    label: "Linear",
    description:
      "Search issues and projects, and create, update, or comment on issues.",
    authType: "oauth",
    envKeys: [
      "LINEAR_CLIENT_ID",
      "LINEAR_CLIENT_SECRET",
      "LINEAR_WEBHOOK_SECRET",
      "INTEGRATION_ENCRYPTION_KEY",
    ],
  },
  datadog: {
    id: "datadog",
    label: "Datadog",
    description: "Search and analyze logs from your Datadog account.",
    authType: "api-key",
    envKeys: ["INTEGRATION_ENCRYPTION_KEY"],
  },
  attio: {
    id: "attio",
    label: "Attio",
    description:
      "Search CRM records and inspect pipelines, activity, meetings, and transcripts.",
    authType: "oauth",
    envKeys: [
      "ATTIO_CLIENT_ID",
      "ATTIO_CLIENT_SECRET",
      "INTEGRATION_ENCRYPTION_KEY",
    ],
  },
  notion: {
    id: "notion",
    label: "Notion",
    description:
      "Search and read selected pages, databases, comments, and workspace users.",
    authType: "oauth",
    envKeys: [
      "NOTION_CLIENT_ID",
      "NOTION_CLIENT_SECRET",
      "INTEGRATION_ENCRYPTION_KEY",
    ],
  },
  cloudwatch: {
    id: "cloudwatch",
    label: "CloudWatch",
    description: "Query logs and metrics from your AWS account.",
    authType: "api-key",
    envKeys: ["INTEGRATION_ENCRYPTION_KEY"],
  },
  betterstack: {
    id: "betterstack",
    label: "Better Stack",
    description:
      "Investigate errors, logs, and incidents. Enable state changes when your team needs them.",
    authType: "api-key",
    envKeys: ["INTEGRATION_ENCRYPTION_KEY"],
  },
  // BYO inbound webhooks (reference/automation-primitives.md §3): each webhook
  // a user creates in channel settings is one connection row under this
  // provider + a channel-anchored trigger. Never listed on the connect page.
  webhook: {
    id: "webhook",
    label: "Webhooks",
    description: "Send data into a channel from any app or service.",
    authType: "token",
    envKeys: ["INTEGRATION_ENCRYPTION_KEY"],
    internal: true,
  },
}

// Datadog is multi-region: the API/MCP hosts derive from the site. Validated at
// the connect endpoint and stored on the connection's `site` column. GovCloud
// sites (ddog-gov.com) are deliberately absent — Datadog's MCP server, which
// backs this connector's tools, doesn't support them.
export const DATADOG_SITES = [
  "datadoghq.com",
  "datadoghq.eu",
  "us3.datadoghq.com",
  "us5.datadoghq.com",
  "ap1.datadoghq.com",
  "ap2.datadoghq.com",
] as const

export type DatadogSite = (typeof DATADOG_SITES)[number]

// CloudWatch is region-scoped: one connection queries one region's logs and
// metrics (stored on the connection's `site` column, like the Datadog site).
// Commercial partitions only — GovCloud and China use different endpoints and
// credentials.
export const AWS_REGIONS = [
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
  "ca-central-1",
  "ca-west-1",
  "mx-central-1",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "eu-central-1",
  "eu-central-2",
  "eu-north-1",
  "eu-south-1",
  "eu-south-2",
  "il-central-1",
  "ap-east-1",
  "ap-east-2",
  "ap-south-1",
  "ap-south-2",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-southeast-3",
  "ap-southeast-4",
  "ap-southeast-5",
  "ap-southeast-7",
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-northeast-3",
  "af-south-1",
  "me-south-1",
  "me-central-1",
  "sa-east-1",
] as const

export type AwsRegion = (typeof AWS_REGIONS)[number]

// Exhaustive over lorCapabilityEnum — adding a capability value without a
// descriptor here is a compile error.
export const CAPABILITIES: Record<LorCapability, CapabilityDescriptor> = {
  github: {
    key: "github",
    label: "GitHub",
    description: "Search and read pull requests & issues",
    connector: "github",
  },
  code_intelligence: {
    key: "code_intelligence",
    label: "Code Intelligence",
    description:
      "Analyze and answer questions about your connected repositories",
    connector: "github",
  },
  code_actions: {
    key: "code_actions",
    label: "Code Actions",
    description:
      "Make code changes and open pull requests for the team to review",
    connector: "github",
  },
  linear: {
    key: "linear",
    label: "Linear",
    description: "Search and read issues, projects & comments",
    connector: "linear",
  },
  linear_write: {
    key: "linear_write",
    label: "Write to Linear",
    description: "Create and update issues and post comments",
    connector: "linear",
  },
  datadog: {
    key: "datadog",
    label: "Datadog",
    description: "Search and analyze logs",
    connector: "datadog",
  },
  attio: {
    key: "attio",
    label: "Attio",
    description: "Search and read CRM records, activity & call transcripts",
    connector: "attio",
  },
  notion: {
    key: "notion",
    label: "Notion",
    description: "Search and read selected pages, databases & comments",
    connector: "notion",
  },
  cloudwatch: {
    key: "cloudwatch",
    label: "CloudWatch",
    description: "Query logs (Logs Insights) and metrics",
    connector: "cloudwatch",
  },
  betterstack: {
    key: "betterstack",
    label: "Better Stack",
    description: "Read errors, query telemetry, and investigate incidents",
    connector: "betterstack",
  },
  betterstack_write: {
    key: "betterstack_write",
    label: "Write to Better Stack",
    description: "Resolve incidents and change error triage states",
    connector: "betterstack",
  },
  web: {
    key: "web",
    label: "Web Search",
    description: "Search the web and read public pages",
    connector: null,
  },
  artifacts: {
    key: "artifacts",
    label: "Artifacts",
    description: "Create files (documents, data, code) in a sandbox workbench",
    connector: null,
  },
  custom_tools: {
    key: "custom_tools",
    label: "All API tools",
    description:
      "Use all current and future custom HTTP API tools in this workspace",
    connector: null,
  },
}

// Exhaustive over integrationProviderEnum — a new provider must declare its
// notifiable events (empty is fine; Datadog is live-query only).
export const CONNECTOR_EVENTS: Record<
  IntegrationProvider,
  readonly ConnectorEventDescriptor[]
> = {
  github: [
    { key: "pr_opened", label: "Pull request opened" },
    { key: "pr_merged", label: "Pull request merged" },
    { key: "issue_opened", label: "Issue opened" },
    { key: "issue_closed", label: "Issue closed" },
    { key: "release_published", label: "Release published" },
  ],
  linear: [
    { key: "issue_created", label: "Issue created" },
    { key: "issue_completed", label: "Issue completed" },
  ],
  datadog: [],
  attio: [
    { key: "call_recording_ready", label: "Call recording ready" },
    { key: "note_created", label: "Note created" },
    { key: "list_entry_created", label: "Record added to a list" },
  ],
  notion: [],
  cloudwatch: [],
  betterstack: [],
  webhook: [{ key: "data_received", label: "Data received" }],
}

export function isConnectorEvent(
  provider: IntegrationProvider,
  key: string
): key is ConnectorEventKey {
  return CONNECTOR_EVENTS[provider].some((e) => e.key === key)
}

// Internal connectors (webhook) are excluded: they aren't user-connectable
// from the integrations page.
export const CONNECTOR_LIST: ConnectorDescriptor[] = Object.values(
  CONNECTORS
).filter((connector) => !connector.internal)
export const CAPABILITY_LIST: CapabilityDescriptor[] =
  Object.values(CAPABILITIES)

export function connectorCapabilities(
  connector: IntegrationProvider
): CapabilityDescriptor[] {
  return CAPABILITY_LIST.filter((c) => c.connector === connector)
}

// Capabilities a workspace can grant given its active connections. Built-in
// capabilities (connector: null) are always available.
export function availableCapabilities(
  connectedProviders: Set<IntegrationProvider>
): CapabilityDescriptor[] {
  return CAPABILITY_LIST.filter(
    (c) => c.connector === null || connectedProviders.has(c.connector)
  )
}
