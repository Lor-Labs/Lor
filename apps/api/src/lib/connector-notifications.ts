import type { ConnectorEventKey } from "@repo/connectors"
import { APP_USER_ID, and, db, eq, schema } from "@repo/db"
import type { IntegrationProvider } from "@repo/db/schema"
import { postBotMessage } from "@/lib/bot-messages"
import { logger } from "@/lib/logger"

// Post one connector event into the channel its route points at. These
// messages are pointers — the canonical content lives in `source` (or the
// provider itself), so they're excluded from Merlin memory. No-op when the
// connection has no route for this event.
export async function postConnectorNotification(input: {
  provider: IntegrationProvider
  externalId: string
  event: ConnectorEventKey
  label: string
  text: string
}): Promise<void> {
  const target = await db
    .select({
      id: schema.channel.id,
      workspaceId: schema.channel.workspaceId,
      name: schema.channel.name,
    })
    .from(schema.connectorNotificationRoute)
    .innerJoin(
      schema.integrationConnection,
      eq(
        schema.connectorNotificationRoute.connectionId,
        schema.integrationConnection.id
      )
    )
    .innerJoin(
      schema.channel,
      eq(schema.connectorNotificationRoute.channelId, schema.channel.id)
    )
    .where(
      and(
        eq(schema.integrationConnection.provider, input.provider),
        eq(schema.integrationConnection.externalId, input.externalId),
        eq(schema.integrationConnection.status, "active"),
        eq(schema.connectorNotificationRoute.event, input.event),
        // Belt: never post across tenants even if a stale route survives.
        eq(schema.channel.workspaceId, schema.integrationConnection.workspaceId)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!target) return

  await postBotMessage({
    channel: target,
    authorId: APP_USER_ID,
    content: input.text,
    overrideName: input.label,
    excludedFromMemory: true,
  })
  logger.info(
    { provider: input.provider, event: input.event, channelId: target.id },
    "Posted connector notification"
  )
}
