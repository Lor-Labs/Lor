import type { IntegrationProvider, MerlinCapability } from "@repo/db/schema"
import type { CapabilityDescriptor, ConnectorDescriptor } from "./types"

// Exhaustive over integrationProviderEnum — adding a provider value without a
// descriptor here is a compile error.
export const CONNECTORS: Record<IntegrationProvider, ConnectorDescriptor> = {
  github: {
    id: "github",
    label: "GitHub",
    description: "Pull requests, issues, and code investigation.",
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
}

// Datadog is multi-region: the API/MCP hosts derive from the site. Validated at
// the connect endpoint and stored on the connection's `site` column.
export const DATADOG_SITES = [
  "datadoghq.com",
  "datadoghq.eu",
  "us3.datadoghq.com",
  "us5.datadoghq.com",
  "ap1.datadoghq.com",
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
  code: {
    key: "code",
    label: "Code investigation",
    description:
      "Explore the connected codebase in an ephemeral sandbox environment",
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
    label: "Create & comment in Linear",
    description: "Create issues and post comments",
    connector: "linear",
  },
  datadog: {
    key: "datadog",
    label: "Datadog",
    description: "Search and analyze logs",
    connector: "datadog",
  },
}

export const CONNECTOR_LIST: ConnectorDescriptor[] = Object.values(CONNECTORS)
export const CAPABILITY_LIST: CapabilityDescriptor[] =
  Object.values(CAPABILITIES)

export function connectorCapabilities(
  connector: IntegrationProvider
): CapabilityDescriptor[] {
  return CAPABILITY_LIST.filter((c) => c.connector === connector)
}

// Capabilities a workspace can grant given its active connections.
export function availableCapabilities(
  connectedProviders: Set<IntegrationProvider>
): CapabilityDescriptor[] {
  return CAPABILITY_LIST.filter((c) => connectedProviders.has(c.connector))
}
