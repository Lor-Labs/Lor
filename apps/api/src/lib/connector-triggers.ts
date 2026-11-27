import { randomUUID } from "node:crypto"
import { recordUsage } from "@repo/billing"
import type { ConnectorEventKey } from "@repo/connectors"
import { APP_USER_ID, and, asc, db, eq, isNull, schema } from "@repo/db"
import { ownConversation } from "@repo/db/queries/agent-conversations"
import { channelAgentId } from "@repo/db/queries/agents"
import { workspaceBetaAccess } from "@repo/db/queries/beta-access"
import type {
  Embed,
  IntegrationProvider,
  TriggerSourceMessage,
} from "@repo/db/schema"
import { ACT_DELIVERY_PAYLOAD_MAX } from "@repo/lor/act-runs"
import { addInboxNote, triggerInboxNote } from "@repo/lor/channel-agent"
import { decideListenerFilter } from "@repo/lor/listener-filter"
import { enrichMeetingEmbed } from "@repo/lor/meeting-insights"
import { channelRoom, threadRoom } from "@repo/realtime-types"
import { AGENT_INBOX_BATCH_MS } from "@repo/realtime-types/queues"
import { startActRun } from "@/lib/act-runs"
import { flushAgentInbox } from "@/lib/agent-inbox-queue"
import { getEmitter, postBotMessage } from "@/lib/bot-messages"
import { logger } from "@/lib/logger"

// The item an event is about, as the webhook handler read it. Feeds the Act
// run's turn.
export type EventItem = {
  title: string
  url: string | null
  author: string | null
  content: string
}

// Raw payloads logged on trigger_delivery are capped — Lor stores the whole
// payload only for BYO webhooks, and only up to this.
const DELIVERY_PAYLOAD_MAX = 64 * 1024
// The trigger card's copy of the posted message, shown in the session. The
// Act turn reads actPayload, so this one is only for display.
const SOURCE_MESSAGE_CONTENT_MAX = 16 * 1024
const SOURCE_MESSAGE_MAX = 64 * 1024

function capSourceMessage(
  source: TriggerSourceMessage
): TriggerSourceMessage | null {
  const capped = {
    ...source,
    content: source.content?.slice(0, SOURCE_MESSAGE_CONTENT_MAX) ?? null,
  }
  const size = (value: TriggerSourceMessage) =>
    Buffer.byteLength(JSON.stringify(value))
  if (size(capped) <= SOURCE_MESSAGE_MAX) return capped
  const plain = { ...capped, embeds: [], attachments: [] }
  return size(plain) <= SOURCE_MESSAGE_MAX ? plain : null
}

export type DispatchOutcome = {
  // The posted channel message id, when the POST effect ran.
  posted: string | null
  // The Act run id, when the Act effect started.
  acted: string | null
}

// The Act run's user turn: everything the event gave us, most readable first.
// First-party content lives at the provider, so this snapshot is all the run
// gets — include the item's full content when there is one.
function actPayload(input: {
  event: string
  text: string
  item?: EventItem
  payload?: string
}): string {
  const parts = [`Event: ${input.event}`, input.text]
  const r = input.item
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

type DispatchInput = {
  provider: IntegrationProvider
  externalId: string
  event: ConnectorEventKey
  label: string
  text: string
  // Structured cards for the POST effect (webhook embeds/attachments).
  embeds?: Embed[]
  // BYO webhook post identity (bucket-restricted, from the stored config).
  avatarUrl?: string
  item?: EventItem
  // What the event is about, for Act's per_subject sessions. Defaults to the
  // item's URL.
  subject?: string
  // The event's item is ingested into `source`, so the posted card is only a
  // pointer and stays out of message search.
  ingested?: boolean
  // Raw inbound payload for the delivery log (BYO webhooks only).
  payload?: string
}

async function listListeners(input: DispatchInput) {
  return db
    .select({
      trigger: {
        id: schema.connectorTrigger.id,
        agentId: schema.connectorTrigger.agentId,
        filter: schema.connectorTrigger.filter,
        post: schema.connectorTrigger.post,
        notify: schema.connectorTrigger.notify,
        actInstructions: schema.connectorTrigger.actInstructions,
        actRepoFullName: schema.connectorTrigger.actRepoFullName,
        actBaseBranch: schema.connectorTrigger.actBaseBranch,
        actWindowSeconds: schema.connectorTrigger.actWindowSeconds,
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
        type: schema.channel.type,
      },
      setUpBy: schema.user.name,
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
    .leftJoin(
      schema.user,
      eq(schema.connectorTrigger.configuredById, schema.user.id)
    )
    .where(
      and(
        eq(schema.integrationConnection.provider, input.provider),
        eq(schema.integrationConnection.externalId, input.externalId),
        eq(schema.integrationConnection.status, "active"),
        eq(schema.connectorTrigger.event, input.event),
        eq(schema.connectorTrigger.enabled, true),
        // An archived chat's listeners stay set up and hear nothing until it
        // is unarchived (reference/agents-and-chats.md, decision 52).
        isNull(schema.channel.archivedAt),
        // Belt: never act across tenants even if a stale trigger survives.
        eq(schema.channel.workspaceId, schema.integrationConnection.workspaceId)
      )
    )
    .orderBy(asc(schema.connectorTrigger.createdAt))
}

type Listener = Awaited<ReturnType<typeof listListeners>>[number]

function deliveryBase(target: Listener, input: DispatchInput) {
  return {
    triggerId: target.trigger.id,
    payload: input.payload
      ? input.payload.slice(0, DELIVERY_PAYLOAD_MAX)
      : null,
    subject: input.subject ?? input.item?.url ?? null,
  }
}

// A listener's filter, asked before anything else: an event it turns away
// is logged and nothing happens for that listener.
async function passesFilter(
  target: Listener,
  input: DispatchInput
): Promise<boolean> {
  if (!target.trigger.filter?.trim()) return true
  const decision = await decideListenerFilter({
    filter: target.trigger.filter,
    label: input.label,
    text: inboxBody(input),
  })
  if (decision.responded) {
    void recordUsage({
      workspaceId: target.connection.workspaceId,
      tool: "lor.listener.filter",
      model: decision.model,
      inputTokens: decision.inputTokens,
      outputTokens: decision.outputTokens,
      costUsd: decision.costUsd,
      wallMs: decision.wallMs,
    }).catch((err) =>
      logger.warn({ err }, "Listener filter usage recording failed")
    )
  }
  if (decision.passed) return true
  await db
    .insert(schema.triggerDelivery)
    .values({ ...deliveryBase(target, input), outcome: "filtered" })
    .catch((err) =>
      logger.warn({ err, event: input.event }, "Delivery log insert failed")
    )
  logger.info(
    { provider: input.provider, event: input.event, score: decision.score },
    "Connector event turned away by its listener's filter"
  )
  return false
}

// The POST effect: the event as a message in the listener's chat. A failure
// must not take the delivery log or the agent's wake with it.
async function postEventCard(
  target: Listener,
  input: DispatchInput,
  quiet: boolean
): Promise<TriggerSourceMessage | null> {
  try {
    const message = await postBotMessage({
      channel: target.channel,
      authorId: APP_USER_ID,
      content: input.text,
      embeds: input.embeds,
      overrideName: input.label,
      overrideAvatarUrl: input.avatarUrl,
      excludedFromMemory: input.ingested ?? false,
      // Off by default: the event shows as unread and the agent's own
      // message is what pings people.
      quiet,
    })
    // Meeting insights are a model call — too slow to hold the webhook ack
    // open. Post the base card first, then patch the embeds in place.
    if (input.embeds?.some((embed) => embed.meeting)) {
      void enrichPostedMeetingEmbeds({
        messageId: message.id,
        channelId: target.channel.id,
        workspaceId: target.connection.workspaceId,
        embeds: input.embeds,
      }).catch((err) => logger.warn({ err }, "Meeting embed enrichment failed"))
    }
    return {
      id: message.id,
      content: message.content,
      createdAt: message.createdAt,
      author: message.author,
      overrideName: message.overrideName ?? null,
      overrideAvatarUrl: message.overrideAvatarUrl ?? null,
      mentions: message.mentions,
      attachments: message.attachments,
      embeds: message.embeds,
    }
  } catch (err) {
    logger.error(
      { err, provider: input.provider, event: input.event },
      "Connector event post failed"
    )
    return null
  }
}

// One listener's delivery: the log row, then its agent's inbox (or an Act
// run for a channel that is not a chat).
async function deliverToListener(
  target: Listener,
  input: DispatchInput,
  card: TriggerSourceMessage | null
): Promise<DispatchOutcome> {
  const postedMessageId = card?.id ?? null
  const sourceMessage: TriggerSourceMessage = card ?? {
    id: randomUUID(),
    content: input.text,
    createdAt: new Date().toISOString(),
    author: { id: APP_USER_ID, name: input.label, image: null },
    overrideName: input.label,
    overrideAvatarUrl: input.avatarUrl ?? null,
    mentions: [],
    attachments: [],
    embeds: input.embeds ?? [],
  }

  let acted: string | null = null
  // Act's queue lives in the delivery log: any Act-on delivery keeps a capped
  // copy of its run payload, so a flush minutes later can rebuild the turn for
  // whatever a burst (or an in-flight run) left waiting.
  const actOn = target.trigger.actInstructions !== null
  // A text channel has an always-on agent: its events go to the agent's
  // inbox, not to a session of their own (reference/always-on-agents.md §3).
  const toInbox = target.channel.type === "text"
  const actText = actOn && !toInbox ? actPayload(input) : null
  const delivery = await db
    .insert(schema.triggerDelivery)
    .values({
      ...deliveryBase(target, input),
      actPayload: actText ? actText.slice(0, ACT_DELIVERY_PAYLOAD_MAX) : null,
      actLabel: actText ? input.label : null,
      sourceMessage: actText ? capSourceMessage(sourceMessage) : null,
      posted: postedMessageId !== null,
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
  if (delivery && toInbox && (actOn || postedMessageId)) {
    actOutcome = await deliverToInbox({
      deliveryId: delivery.id,
      workspaceId: target.connection.workspaceId,
      channelId: target.channel.id,
      trigger: target.trigger,
      setUpBy: target.setUpBy,
      label: input.label,
      event: input.event,
      body: inboxBody(input),
      cardMessageId: postedMessageId,
    }).catch((err) => {
      logger.error(
        { err, triggerId: target.trigger.id, deliveryId: delivery.id },
        "Trigger inbox delivery failed"
      )
      return "error"
    })
  }
  if (delivery && actText !== null) {
    const started = await startActRun({
      triggerId: target.trigger.id,
      deliveryId: delivery.id,
      windowSeconds: target.trigger.actWindowSeconds,
      workspaceId: target.connection.workspaceId,
      channelId: target.channel.id,
      label: input.label,
      payload: actText,
    }).catch((err) => {
      // Caught so one listener's failure can't fail the delivery (and get
      // its cards reposted on the provider's retry).
      logger.error(
        { err, triggerId: target.trigger.id, deliveryId: delivery.id },
        "Trigger act run failed"
      )
      return null
    })
    if (!started) actOutcome = "error"
    else {
      actOutcome = started.kind === "skipped" ? started.reason : started.kind
      if (started.kind === "started") acted = started.runId
    }
  }

  if (delivery) {
    await db
      .update(schema.triggerDelivery)
      .set({ outcome: actOutcome })
      .where(eq(schema.triggerDelivery.id, delivery.id))
      .catch(() => {})
  }
  logger.info(
    {
      provider: input.provider,
      event: input.event,
      channelId: target.channel.id,
      posted: postedMessageId !== null,
      act: actOutcome,
      acted,
    },
    "Dispatched connector event"
  )
  return { posted: postedMessageId, acted }
}

// Fan one connector event out to everyone who listens to it, and log each
// delivery. Nobody listening means the event is off (returns null). Each
// listener's filter is asked on its own, so one agent's condition never
// holds an event back from another. See reference/automation-primitives.md
// §2 and reference/agents-and-chats.md (decisions 40 and 42).
export async function dispatchConnectorEvent(
  input: DispatchInput
): Promise<DispatchOutcome | null> {
  const listeners = await listListeners(input)
  const first = listeners[0]
  if (!first) return null
  if (
    (await workspaceBetaAccess(first.connection.workspaceId)).state !== "active"
  )
    return null

  const heard = (
    await Promise.all(
      listeners.map(async (target) =>
        (await passesFilter(target, input)) ? target : null
      )
    )
  ).filter((target) => target !== null)

  // Listeners that post into the same chat share one message, which pings
  // people when any of them asks for it.
  const cards = new Map<string, TriggerSourceMessage | null>()
  for (const target of heard) {
    const chatId = target.channel.id
    if (!target.trigger.post || cards.has(chatId)) continue
    const notify = heard.some(
      (other) =>
        other.channel.id === chatId &&
        other.trigger.post &&
        other.trigger.notify
    )
    cards.set(chatId, await postEventCard(target, input, !notify))
  }

  const outcome: DispatchOutcome = { posted: null, acted: null }
  for (const target of heard) {
    const card = target.trigger.post
      ? (cards.get(target.channel.id) ?? null)
      : null
    const delivered = await deliverToListener(target, input, card)
    outcome.posted ??= delivered.posted
    outcome.acted ??= delivered.acted
  }
  return outcome
}

// The event as the agent reads it: its text, then what the item adds. A
// plain webhook's item only repeats its text.
function inboxBody(input: {
  text: string
  item?: EventItem
  payload?: string
}): string {
  const text = input.text.trim()
  const item = input.item
  const details = item
    ? [
        item.title && !text.includes(item.title)
          ? `Title: ${item.title}`
          : null,
        item.url ? `Link: ${item.url}` : null,
        item.author ? `Author: ${item.author}` : null,
        item.content.trim() && item.content.trim() !== text
          ? item.content
          : null,
      ].filter((line): line is string => line !== null)
    : []
  const parts = [text, details.join("\n")].filter(Boolean)
  // A payload with no readable text is all there is to go on.
  if (parts.length === 0 && input.payload) {
    parts.push(`Raw payload:\n${input.payload}`)
  }
  return parts.join("\n\n")
}

// One event into the inbox of the agent that listens for it (the chat's
// first agent when the listener names none). A listener with instructions
// wakes the agent; one that only posts a card leaves the event to be read at
// the agent's next check-in.
async function deliverToInbox(input: {
  deliveryId: string
  workspaceId: string
  channelId: string
  trigger: {
    id: string
    agentId: string | null
    actInstructions: string | null
    actRepoFullName: string | null
    actBaseBranch: string | null
  }
  setUpBy: string | null
  label: string
  event: string
  body: string
  cardMessageId: string | null
}): Promise<string> {
  const { trigger } = input
  const note = triggerInboxNote({
    label: input.label,
    event: input.event,
    body: input.body,
    cardMessageId: input.cardMessageId,
    instructions: trigger.actInstructions,
    setUpBy: input.setUpBy,
    code: trigger.actRepoFullName
      ? {
          repoFullName: trigger.actRepoFullName,
          baseBranch: trigger.actBaseBranch,
        }
      : null,
  })
  const agentId = trigger.agentId ?? (await channelAgentId(input.channelId))
  if (!agentId) return "no_agent"
  const conversationId = (
    await ownConversation({ workspaceId: input.workspaceId, agentId })
  ).id
  // A listener that wakes its agent wakes it for every event: there are no
  // hourly or daily caps (decided 2026-11-26). Bursts are batched by the
  // inbox, and the listener's filter is what turns events away.
  const lane = trigger.actInstructions !== null ? "wake" : "wait"
  // An event goes to the listening agent's own conversation.
  const added = await addInboxNote({
    workspaceId: input.workspaceId,
    channelId: input.channelId,
    conversationId,
    source: "trigger",
    sourceId: input.deliveryId,
    deliveryId: input.deliveryId,
    lane,
    note,
  })
  if (added && lane === "wake") {
    await flushAgentInbox(added, AGENT_INBOX_BATCH_MS)
  }
  return lane
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
