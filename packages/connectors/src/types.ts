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

// Webhook event kinds a connector can post to a channel. Keys are stored on
// `connector_notification_route.event` — validated against the registry, so
// renaming a key orphans existing routes.
export type ConnectorEventKey =
  | "pr_opened"
  | "pr_merged"
  | "issue_opened"
  | "issue_closed"
  | "release_published"
  | "issue_created"
  | "issue_completed"

export type ConnectorEventDescriptor = {
  key: ConnectorEventKey
  label: string
}

export type CapabilityDescriptor = {
  key: MerlinCapability
  label: string
  description: string
  // The connector that must be connected to grant this capability, or null for
  // built-in capabilities (e.g. web) that need no workspace connection.
  connector: IntegrationProvider | null
}
