import { recordUsage } from "@repo/billing"
import type { ConnectorEventKey } from "@repo/connectors"
import { APP_USER_ID, and, db, eq, schema } from "@repo/db"
import type { IntegrationProvider } from "@repo/db/schema"
import { type IngestSourceInput, ingestSource } from "@repo/merlin/sources"
import { startActRun } from "@/lib/act-runs"
import { postBotMessage } from "@/lib/bot-messages"
import { logger } from "@/lib/logger"

// The Remember payload a webhook handler supplies; the trigger resolves the rest.
export type RememberDraft = Omit<
  IngestSourceInput,
  "workspaceId" | "connectionId" | "provider" | "hint"
>

// Raw payloads logged on trigger_delivery are capped — Lor stores the whole
// payload only for BYO webhooks, and only up to this.
const DELIVERY_PAYLOAD_MAX = 64 * 1024

export type DispatchOutcome = {
  // The posted channel message id, when the POST effect ran.
  posted: string | null
  remembered: boolean
  // The headless agent run id, when the Act effect started.
  acted: string | null
}

// The Act run's user turn: everything the event gave us, most readable first.
// First-party content lives at the provider, so this snapshot is all the run
// gets — include the Remember draft's full content when there is one.
function actPayload(input: {
  event: string
  text: string
  remember?: RememberDraft
  payload?: string
}): string {
  const parts = [`Event: ${input.event}`, input.text]
  const r = input.remember
  if (r) {
    parts.push(
      [
        r.title ? `Title: ${r.title}` : null,
        r.url ? `Link: ${r.url}` : null,
        r.author ? `Author: ${r.author}` : null,
        r.content,
      ]
        .filter(Boolean)
        .join("\n")
    )
  }
  if (input.payload) parts.push(`Raw payload:\n${input.payload}`)
  return parts.join("\n\n")
}

// Fan one connector event out to its trigger's effects (POST, Remember, Act),
// and log the delivery. No trigger row — or a disabled one — means the event
// is off (returns null). See reference/automation-primitives.md §2.
export async function dispatchConnectorEvent(input: {
  provider: IntegrationProvider
  externalId: string
  event: ConnectorEventKey
  label: string
  text: string
  // BYO webhook post identity (bucket-restricted, from the stored config).
  avatarUrl?: string
  // Omit when the event has nothing ingestable; Remember is then a no-op.
  remember?: RememberDraft
  // Raw inbound payload for the delivery log (BYO webhooks only).
  payload?: string
}): Promise<DispatchOutcome | null> {
  const target = await db
    .select({
      trigger: {
        id: schema.connectorTrigger.id,
        post: schema.connectorTrigger.post,
        remember: schema.connectorTrigger.remember,
        rememberHint: schema.connectorTrigger.rememberHint,
        actInstructions: schema.connectorTrigger.actInstructions,
        dailyRunCap: schema.connectorTrigger.dailyRunCap,
        enabled: schema.connectorTrigger.enabled,
      },
      connection: {
        id: schema.integrationConnection.id,
        workspaceId: schema.integrationConnection.workspaceId,
      },
      channel: {
        id: schema.channel.id,
        workspaceId: schema.channel.workspaceId,
        name: schema.channel.name,
      },
    })
    .from(schema.connectorTrigger)
    .innerJoin(
      schema.integrationConnection,
      eq(schema.connectorTrigger.connectionId, schema.integrationConnection.id)
    )
    .innerJoin(
      schema.channel,
      eq(schema.connectorTrigger.channelId, schema.channel.id)
    )
    .where(
      and(
        eq(schema.integrationConnection.provider, input.provider),
        eq(schema.integrationConnection.externalId, input.externalId),
        eq(schema.integrationConnection.status, "active"),
        eq(schema.connectorTrigger.event, input.event),
        // Belt: never act across tenants even if a stale trigger survives.
        eq(schema.channel.workspaceId, schema.integrationConnection.workspaceId)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!target?.trigger.enabled) return null

  let postedMessageId: string | null = null
  if (target.trigger.post) {
    const message = await postBotMessage({
      channel: target.channel,
      authorId: APP_USER_ID,
      content: input.text,
      overrideName: input.label,
      overrideAvatarUrl: input.avatarUrl,
      // Memory rule: with Remember on, the `source` row is the canonical copy
      // and this message is just a pointer; POST-only messages stay canonical
      // chat content. See reference/automation-primitives.md §2.
      excludedFromMemory: target.trigger.remember,
    })
    postedMessageId = message.id
  }

  const remembered = target.trigger.remember && !!input.remember
  if (remembered && input.remember) {
    // Fire-and-forget: the summarize call is too slow to hold webhook acks
    // open, and an ingest hiccup must not fail the delivery.
    void ingestSource(
      {
        workspaceId: target.connection.workspaceId,
        connectionId: target.connection.id,
        provider: input.provider,
        hint: target.trigger.rememberHint,
        ...input.remember,
      },
      // Metered at true cost, never debited — "free ingestion" stays a pricing
      // decision whose price is visible in the ledger.
      (u) => void recordUsage(u)
    ).catch((err) => {
      logger.error(
        { err, provider: input.provider, event: input.event },
        "Connector event ingest failed"
      )
    })
  }

  let acted: string | null = null
  const delivery = await db
    .insert(schema.triggerDelivery)
    .values({
      triggerId: target.trigger.id,
      payload: input.payload
        ? input.payload.slice(0, DELIVERY_PAYLOAD_MAX)
        : null,
      posted: postedMessageId !== null,
      remembered,
    })
    .returning({ id: schema.triggerDelivery.id })
    .then((rows) => rows[0] ?? null)
    .catch((err) => {
      logger.warn({ err, event: input.event }, "Delivery log insert failed")
      return null
    })

  // Act: hand the payload + trigger instructions to a headless agent run.
  // Anchored on the delivery row — no delivery log, no run.
  if (delivery && target.trigger.actInstructions !== null) {
    acted = await startActRun({
      triggerId: target.trigger.id,
      deliveryId: delivery.id,
      dailyRunCap: target.trigger.dailyRunCap,
      workspaceId: target.connection.workspaceId,
      channelId: target.channel.id,
      label: input.label,
      payload: actPayload(input),
    })
  }

  logger.info(
    {
      provider: input.provider,
      event: input.event,
      channelId: target.channel.id,
      posted: postedMessageId !== null,
      remembered,
      acted,
    },
    "Dispatched connector event"
  )
  return { posted: postedMessageId, remembered, acted }
}
