import { CONNECTOR_LIST } from "@repo/connectors"
import { db } from "@repo/db"
import type { IntegrationProvider } from "@repo/db/schema"
import { integrationConnection } from "@repo/db/schema"
import { resolveChannelCapabilities } from "@repo/lor/capabilities"
import {
  connectorSupportsFiles,
  isSearchableConnector,
} from "@repo/lor/connector-search"
import { and, eq } from "drizzle-orm"

export type ChannelConnector = {
  id: IntegrationProvider
  label: string
  // Whether this connector can also browse files, which the composer offers as
  // a second step (pick a container, then a path).
  supportsFiles: boolean
}

// Composer searches require the matching search tool; code-file browsing also
// requires the code investigation tool. Profiles and workspace selections apply.
export function attachableConnectors(
  connected: Set<IntegrationProvider>,
  connectorTools: readonly string[] = [],
  purpose: "records" | "files" | "any" = "any"
): ChannelConnector[] {
  const tools = new Set(connectorTools)
  const searchTools: Partial<Record<IntegrationProvider, string>> = {
    github: "search_github",
    linear: "search_linear",
    attio: "search_attio",
    notion: "search_notion",
  }
  const canSearch = (provider: IntegrationProvider) =>
    tools.has(searchTools[provider] ?? "")
  const canBrowseFiles = (provider: IntegrationProvider) =>
    connectorSupportsFiles(provider) &&
    provider === "github" &&
    tools.has("investigate_code")
  return CONNECTOR_LIST.filter(
    (descriptor) =>
      isSearchableConnector(descriptor.id) &&
      connected.has(descriptor.id) &&
      (purpose === "records"
        ? canSearch(descriptor.id)
        : purpose === "files"
          ? canBrowseFiles(descriptor.id)
          : canSearch(descriptor.id) || canBrowseFiles(descriptor.id))
  ).map((descriptor) => ({
    id: descriptor.id,
    label: descriptor.label,
    supportsFiles: canBrowseFiles(descriptor.id),
  }))
}

// Attaching is the composer's mirror of what Lor may read in a channel, so
// the same tool selection gates both.
export async function allowedChannelConnectors(
  workspaceId: string,
  channelId: string,
  purpose: "records" | "files" | "any" = "any"
): Promise<ChannelConnector[]> {
  const [grants, connections] = await Promise.all([
    resolveChannelCapabilities(channelId, workspaceId),
    db
      .select({ provider: integrationConnection.provider })
      .from(integrationConnection)
      .where(
        and(
          eq(integrationConnection.workspaceId, workspaceId),
          eq(integrationConnection.status, "active")
        )
      ),
  ])

  return attachableConnectors(
    new Set(connections.map((row) => row.provider)),
    grants.connectorTools,
    purpose
  )
}
