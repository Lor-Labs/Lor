import { recordUsage } from "@repo/billing"
import type { ConnectorEventKey } from "@repo/connectors"
import { APP_USER_ID, and, db, eq, schema } from "@repo/db"
import type { Embed, IntegrationProvider } from "@repo/db/schema"
import { ACT_DELIVERY_PAYLOAD_MAX } from "@repo/lor/act-runs"
import { enrichMeetingEmbed } from "@repo/lor/meeting-insights"
import { type IngestSourceInput, ingestSource } from "@repo/lor/sources"
import { channelRoom, threadRoom } from "@repo/realtime-types"
import { startActRun } from "@/lib/act-runs"
import { getEmitter, postBotMessage } from "@/lib/bot-messages"
import { logger } from "@/lib/logger"

// The Remember payload a webhook handler supplies; the trigger resolves the rest.
export type RememberDraft = Omit<
  IngestSourceInput,
  "workspaceId" | "connectionId" | "channelId" | "provider" | "hint"
>

// Raw payloads logged on trigger_delivery are capped — Lor stores the whole
// payload only for BYO webhooks, and only up to this.
const DELIVERY_PAYLOAD_MAX = 64 * 1024

export type DispatchOutcome = {
  // The posted channel message id, when the POST effect ran.
  posted: string | null
  remembered: boolean
  // The Act run id, when the Act effect started.
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
  // Structured cards for the POST effect (webhook embeds/attachments).
  embeds?: Embed[]
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
        actWindowSeconds: schema.connectorTrigger.actWindowSeconds,
        hourlyRunCap: schema.connectorTrigger.hourlyRunCap,
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
    // A POST failure must not take Remember, the delivery log, or Act with it.
    try {
      const message = await postBotMessage({
        channel: target.channel,
        authorId: APP_USER_ID,
        content: input.text,
        embeds: input.embeds,
        overrideName: input.label,
        overrideAvatarUrl: input.avatarUrl,
        // Memory rule: with Remember on, the `source` row is the canonical copy
        // and this message is just a pointer; POST-only messages stay canonical
        // chat content. See reference/automation-primitives.md §2.
        excludedFromMemory: target.trigger.remember,
      })
      postedMessageId = message.id
      // Meeting insights are a model call — too slow to hold the webhook ack
      // open. Post the base card first, then patch the embeds in place.
      if (
        input.provider === "attio" &&
        input.event === "call_recording_ready" &&
        input.embeds?.length
      ) {
        void enrichPostedMeetingEmbeds({
          messageId: message.id,
          channelId: target.channel.id,
          workspaceId: target.connection.workspaceId,
          embeds: input.embeds,
        }).catch((err) =>
          logger.warn({ err }, "Meeting embed enrichment failed")
        )
      }
    } catch (err) {
      logger.error(
        { err, provider: input.provider, event: input.event },
        "Connector event post failed"
      )
    }
  }

  const remembered = target.trigger.remember && !!input.remember
  if (remembered && input.remember) {
    // Fire-and-forget: the summarize call is too slow to hold webhook acks
    // open, and an ingest hiccup must not fail the delivery.
    void ingestSource(
      {
        workspaceId: target.connection.workspaceId,
        connectionId: target.connection.id,
        channelId: target.channel.id,
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
  // Act's queue lives in the delivery log: any Act-on delivery keeps a capped
  // copy of its run payload, so a flush minutes later can rebuild the turn for
  // whatever a burst (or an in-flight run) left waiting.
  const actOn = target.trigger.actInstructions !== null
  const actText = actOn ? actPayload(input) : null
  const delivery = await db
    .insert(schema.triggerDelivery)
    .values({
      triggerId: target.trigger.id,
      payload: input.payload
        ? input.payload.slice(0, DELIVERY_PAYLOAD_MAX)
        : null,
      actPayload: actText ? actText.slice(0, ACT_DELIVERY_PAYLOAD_MAX) : null,
      actLabel: actOn ? input.label : null,
      posted: postedMessageId !== null,
      remembered,
    })
    .returning({ id: schema.triggerDelivery.id })
    .then((rows) => rows[0] ?? null)
    .catch((err) => {
      logger.warn({ err, event: input.event }, "Delivery log insert failed")
      return null
    })

  // Act: the worker turns the run into a new session whose first turn is the
  // payload. Anchored on the delivery row — no delivery log, no run.
  let actOutcome = "off"
  if (delivery && actText !== null) {
    const started = await startActRun({
      triggerId: target.trigger.id,
      deliveryId: delivery.id,
      windowSeconds: target.trigger.actWindowSeconds,
      hourlyRunCap: target.trigger.hourlyRunCap,
      dailyRunCap: target.trigger.dailyRunCap,
      workspaceId: target.connection.workspaceId,
      channelId: target.channel.id,
      label: input.label,
      payload: actText,
    })
    actOutcome = started.kind === "skipped" ? started.reason : started.kind
    if (started.kind === "started") acted = started.runId
  }

  logger.info(
    {
      provider: input.provider,
      event: input.event,
      channelId: target.channel.id,
      posted: postedMessageId !== null,
      remembered,
      act: actOutcome,
      acted,
    },
    "Dispatched connector event"
  )
  return { posted: postedMessageId, remembered, acted }
}

// Follow-up to the POST effect: run meeting-insight enrichment after the base
// card is live, then broadcast the patched embeds (same path as link unfurls).
async function enrichPostedMeetingEmbeds(input: {
  messageId: string
  channelId: string
  workspaceId: string
  embeds: Embed[]
}) {
  const embeds = await Promise.all(
    input.embeds.map((embed) =>
      enrichMeetingEmbed(embed, input.workspaceId, (usage) => {
        void recordUsage(usage).catch((err) =>
          logger.warn({ err }, "Meeting insight usage recording failed")
        )
      })
    )
  )
  await db
    .update(schema.message)
    .set({ embeds })
    .where(eq(schema.message.id, input.messageId))
  const io = await getEmitter()
  io.to([channelRoom(input.channelId), threadRoom(input.messageId)]).emit(
    "message:embeds:updated",
    { channelId: input.channelId, messageId: input.messageId, embeds }
  )
}
