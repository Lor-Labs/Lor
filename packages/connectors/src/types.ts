import type { IntegrationProvider, MerlinCapability } from "@repo/db/schema"

export type ConnectorAuthType = "github-app" | "oauth" | "api-key"

// Dependency-light description of a connector — the single source of truth for
// ids, labels, capabilities, and auth metadata. Server bindings (provider,
// tools, webhooks) and the client icon are registered separately, keyed by id.
export type ConnectorDescriptor = {
  id: IntegrationProvider
  label: string
  description: string
  authType: ConnectorAuthType
  // Server env keys this connector needs configured to be usable.
  envKeys: readonly string[]
}

export type CapabilityDescriptor = {
  key: MerlinCapability
  label: string
  description: string
  // The connector that must be connected to grant this capability.
  connector: IntegrationProvider
}
