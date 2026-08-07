import { CONNECTOR_LIST, connectorCapabilities } from "@repo/connectors"
import { db } from "@repo/db"
import type { IntegrationProvider, MerlinCapability } from "@repo/db/schema"
import { integrationConnection } from "@repo/db/schema"
import { resolveChannelCapabilities } from "@repo/merlin/capabilities"
import {
  connectorSupportsFiles,
  isSearchableConnector,
} from "@repo/merlin/connector-search"
import { and, eq } from "drizzle-orm"

export type ChannelConnector = {
  id: IntegrationProvider
  label: string
  // Whether this connector can also browse files, which the composer offers as
  // a second step (pick a container, then a path).
  supportsFiles: boolean
}

// A connector is attachable when it's connected, has searchable records, and the
// channel grants at least one of its capabilities.
export function attachableConnectors(
  capabilities: MerlinCapability[],
  connected: Set<IntegrationProvider>
): ChannelConnector[] {
  return CONNECTOR_LIST.filter(
    (descriptor) =>
      isSearchableConnector(descriptor.id) &&
      connected.has(descriptor.id) &&
      connectorCapabilities(descriptor.id).some((capability) =>
        capabilities.includes(capability.key)
      )
  ).map((descriptor) => ({
    id: descriptor.id,
    label: descriptor.label,
    supportsFiles: connectorSupportsFiles(descriptor.id),
  }))
}

// Attaching is the composer's mirror of what Merlin may read in a channel, so
// the same capability resolution gates both.
export async function allowedChannelConnectors(
  workspaceId: string,
  channelId: string
): Promise<ChannelConnector[]> {
  const [capabilities, connections] = await Promise.all([
    resolveChannelCapabilities(channelId),
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
    capabilities,
    new Set(connections.map((row) => row.provider))
  )
}
