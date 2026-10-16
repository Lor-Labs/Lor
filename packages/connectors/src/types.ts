import type { IntegrationProvider, LorCapability } from "@repo/db/schema"

export type ConnectorAuthType = "github-app" | "oauth" | "api-key" | "token"

// Dependency-light description of a connector — the single source of truth for
// ids, labels, tools, and auth metadata. Server bindings (provider,
// tools, webhooks) and the client icon are registered separately, keyed by id.
export type ConnectorDescriptor = {
  id: IntegrationProvider
  label: string
  description: string
  authType: ConnectorAuthType
  // Server env keys this connector needs configured to be usable.
  envKeys: readonly string[]
  // Not user-connectable from the integrations page (e.g. `webhook` rows are
  // created from channel settings). Excluded from CONNECTOR_LIST.
  internal?: true
}

// Webhook event kinds a connector can route to a channel. Keys are stored on
// `connector_trigger.event` — validated against the registry, so renaming a
// key orphans existing triggers.
export type ConnectorEventKey =
  | "pr_opened"
  | "pr_merged"
  | "issue_opened"
  | "issue_closed"
  | "release_published"
  | "issue_created"
  | "issue_completed"
  | "call_recording_ready"
  | "note_created"
  | "list_entry_created"
  | "data_received"

export type ConnectorEventDescriptor = {
  key: ConnectorEventKey
  label: string
}

export type CapabilityDescriptor = {
  key: LorCapability
  label: string
  description: string
  // Standalone abilities have no connector; connector tools use explicit names.
  connector: IntegrationProvider | null
}
