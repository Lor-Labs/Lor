import type { IntegrationProvider, MerlinCapability } from "@repo/db/schema"
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
    description: "Pull requests, issues, and code intelligence.",
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
    description: "Issues, projects, and comments.",
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
    description: "Log search and analysis.",
    authType: "api-key",
    envKeys: ["INTEGRATION_ENCRYPTION_KEY"],
  },
  attio: {
    id: "attio",
    label: "Attio",
    description: "CRM records, pipelines, notes, meetings, and transcripts.",
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
    description: "Selected pages, databases, comments, and workspace users.",
    authType: "oauth",
    envKeys: [
      "NOTION_CLIENT_ID",
      "NOTION_CLIENT_SECRET",
      "INTEGRATION_ENCRYPTION_KEY",
    ],
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

// Exhaustive over merlinCapabilityEnum — adding a capability value without a
// descriptor here is a compile error.
export const CAPABILITIES: Record<MerlinCapability, CapabilityDescriptor> = {
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
  attio: [],
  notion: [],
}

export function isConnectorEvent(
  provider: IntegrationProvider,
  key: string
): key is ConnectorEventKey {
  return CONNECTOR_EVENTS[provider].some((e) => e.key === key)
}

export const CONNECTOR_LIST: ConnectorDescriptor[] = Object.values(CONNECTORS)
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
