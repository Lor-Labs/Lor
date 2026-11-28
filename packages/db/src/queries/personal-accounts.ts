import { and, asc, eq, sql } from "drizzle-orm"
import { LOR_USER_ID } from "../constants"
import { db } from "../index"
import { agent, agentHarnessSettings } from "../schemas/agents"
import { channel } from "../schemas/channels"
import { message } from "../schemas/messages"
import {
  type HarnessAccountRoute,
  type HarnessAccountScope,
  type HarnessSettings,
  harnessAccountPreference,
  type PersonalAccountProvider,
  personalAccount,
  personalHarnessSettings,
} from "../schemas/personal-accounts"
import { user } from "../schemas/users"

export async function getPersonalHarnessSettings(
  workspaceId: string,
  userId: string
) {
  const [settings] = await db
    .select()
    .from(personalHarnessSettings)
    .where(
      and(
        eq(personalHarnessSettings.workspaceId, workspaceId),
        eq(personalHarnessSettings.userId, userId)
      )
    )
  return { defaultHarness: settings?.defaultHarness ?? "auto" }
}

// The person who asked for a turn woken by this message: they addressed the
// agent, or the inbox classifier read the message as meant for it (LOR-171).
// Code sessions the turn starts try their plan first and fall back to the
// agent's settings when they have none (resolveCodeSessionPayer). Null:
// automation or background observation of human chat, which never spends a
// person's plan.
export async function channelRequestUserId(
  channelId: string,
  triggerMessageId: string | null
) {
  if (!triggerMessageId) return null
  const [trigger] = await db
    .select({
      userId: message.authorId,
      isBot: user.isBot,
      workspaceId: channel.workspaceId,
      // A mention of Lor or of one of the chat's agents by its own id.
      explicit: sql<boolean>`(${message.content} like ${`%<@${LOR_USER_ID}>%`} or exists (select 1 from channel_agent ca where ca.channel_id = ${message.channelId} and ${message.content} like '%<@' || ca.agent_id || '>%'))`,
      threadRootId: message.threadRootId,
      // It named no agent and the inbox classifier woke one for it.
      inferred: sql<boolean>`exists (select 1 from agent_inbox i where i.message_id = ${message.id} and i.inferred)`,
      repliedToLor: sql<boolean>`exists (select 1 from message r where r.id = ${message.referencedMessageId} and (r.author_id = ${LOR_USER_ID}::uuid or exists (select 1 from agent a where a.id = r.author_id)))`,
    })
    .from(message)
    .innerJoin(user, eq(user.id, message.authorId))
    .innerJoin(channel, eq(channel.id, message.channelId))
    .where(
      and(eq(message.id, triggerMessageId), eq(message.channelId, channelId))
    )
  if (!trigger || trigger.isBot || !trigger.workspaceId) return null
  // In the chat only a mention, a reply or the classifier wakes the agent,
  // so a top-level trigger was addressed to it. In a thread it also hears
  // the rest.
  const addressed =
    trigger.explicit ||
    trigger.repliedToLor ||
    trigger.inferred ||
    !trigger.threadRootId
  return addressed ? trigger.userId : null
}

// Whether a person linked their own account at a provider: a Claude Code or
// Codex turn runs only on the sender's own Claude subscription or ChatGPT plan.
export async function hasPersonalAccount(
  userId: string,
  provider: PersonalAccountProvider
): Promise<boolean> {
  const [row] = await db
    .select({ id: personalAccount.id })
    .from(personalAccount)
    .where(
      and(
        eq(personalAccount.userId, userId),
        eq(personalAccount.provider, provider)
      )
    )
    .limit(1)
  return Boolean(row)
}

const DEFAULT_HARNESS_SETTINGS: HarnessSettings = {
  defaultHarness: "pi",
  apiModel: null,
  claudeApiBilling: "lor",
  codexApiBilling: "lor",
  claudeAccountId: null,
  codexAccountId: null,
  claudeUseSubscriptions: false,
  codexUseSubscriptions: false,
  claudeAutoFallback: true,
  codexAutoFallback: true,
}

// The run settings that apply when no person's plan pays: the agent's own
// (reference/agents-and-chats.md). Work with no agent (a voice channel's
// Loop) runs on the defaults: Lor's own agent on Lor credits.
export async function getHarnessSettings(scope: {
  agentId?: string | null
}): Promise<HarnessSettings> {
  if (!scope.agentId) return DEFAULT_HARNESS_SETTINGS
  const [row] = await db
    .select({ model: agent.model, settings: agentHarnessSettings })
    .from(agent)
    .leftJoin(agentHarnessSettings, eq(agentHarnessSettings.agentId, agent.id))
    .where(eq(agent.id, scope.agentId))
  if (!row) return DEFAULT_HARNESS_SETTINGS
  const { agentId: _agentId, ...saved } = row.settings ?? {
    agentId: scope.agentId,
    ...DEFAULT_HARNESS_SETTINGS,
  }
  return { ...DEFAULT_HARNESS_SETTINGS, ...saved, apiModel: row.model }
}

export function harnessAccountOwner(scope: HarnessAccountScope) {
  return scope.userId
    ? eq(personalAccount.userId, scope.userId)
    : eq(personalAccount.workspaceId, scope.workspaceId)
}

export function orderHarnessAccounts<T extends { id: string }>(
  accounts: T[],
  preference?: { accountId: string | null; accountOrder?: string[] } | null
) {
  const priority = [
    ...new Set([
      ...(preference?.accountId ? [preference.accountId] : []),
      ...(preference?.accountOrder ?? []),
    ]),
  ]
  const positions = new Map(priority.map((id, index) => [id, index]))
  return [...accounts].sort(
    (a, b) =>
      (positions.get(a.id) ?? priority.length) -
      (positions.get(b.id) ?? priority.length)
  )
}

export async function harnessAccountPool(
  scope: HarnessAccountScope,
  provider: "claude" | "chatgpt"
) {
  const [accounts, preference, settings] = await Promise.all([
    db
      .select()
      .from(personalAccount)
      .where(
        and(harnessAccountOwner(scope), eq(personalAccount.provider, provider))
      )
      .orderBy(asc(personalAccount.createdAt), asc(personalAccount.id)),
    scope.userId
      ? db
          .select()
          .from(harnessAccountPreference)
          .where(
            and(
              eq(harnessAccountPreference.workspaceId, scope.workspaceId),
              eq(harnessAccountPreference.userId, scope.userId),
              eq(harnessAccountPreference.provider, provider)
            )
          )
          .then((rows) => rows[0])
      : null,
    scope.userId ? null : getHarnessSettings(scope),
  ])
  const useSubscriptions = scope.userId
    ? true
    : provider === "claude"
      ? settings?.claudeUseSubscriptions
      : settings?.codexUseSubscriptions
  const preferred = scope.userId
    ? preference?.accountId
    : provider === "claude"
      ? settings?.claudeAccountId
      : settings?.codexAccountId
  const autoFallback = scope.userId
    ? (preference?.autoFallback ?? true)
    : provider === "claude"
      ? (settings?.claudeAutoFallback ?? true)
      : (settings?.codexAutoFallback ?? true)
  const ordered = orderHarnessAccounts(accounts, {
    accountId: preferred ?? null,
    accountOrder: preference?.accountOrder,
  })
  return {
    accounts: ordered,
    autoFallback,
    useSubscriptions: Boolean(useSubscriptions),
  }
}

export async function resolveHarnessAccount(
  scope: HarnessAccountScope,
  provider: "claude" | "chatgpt",
  options: { pinned?: HarnessAccountRoute; exclude?: string[] } = {}
): Promise<HarnessAccountRoute> {
  const { accounts, autoFallback, useSubscriptions } = await harnessAccountPool(
    scope,
    provider
  )
  const base = { ...scope, provider }
  // A retry cannot change its payer when workspace settings change.
  if (
    options.pinned?.source === "api" ||
    (!options.pinned && !useSubscriptions)
  ) {
    const settings = await getHarnessSettings(scope)
    return {
      ...base,
      source: "api",
      accountId: null,
      apiBilling:
        options.pinned?.apiBilling ??
        (provider === "claude"
          ? settings.claudeApiBilling
          : settings.codexApiBilling),
    }
  }
  const pinnedId = options.pinned?.accountId
  if (pinnedId && !accounts.some((a) => a.id === pinnedId))
    throw new Error(
      "The account for this turn was disconnected. Start a new turn to use another account."
    )
  const ordered = pinnedId
    ? [
        ...accounts.filter((a) => a.id === pinnedId),
        ...accounts.filter((a) => a.id !== pinnedId),
      ]
    : accounts
  const candidates = autoFallback ? ordered : ordered.slice(0, 1)
  const account = candidates.find(
    (a) =>
      !options.exclude?.includes(a.id) &&
      (!a.unavailableUntil || a.unavailableUntil.getTime() <= Date.now())
  )
  if (!account) {
    // Every account is resting after its usage limit: say whose and when
    // the soonest one resets. A turn on a person's plan never falls back to
    // the agent's (Jacob, 11-27).
    const resting = candidates.filter(
      (a) => !options.exclude?.includes(a.id) && a.unavailableUntil
    )
    if (resting.length > 0) {
      const until = new Date(
        Math.min(...resting.map((a) => a.unavailableUntil?.getTime() ?? 0))
      )
      const owner = scope.userId
        ? await db
            .select({ name: user.name })
            .from(user)
            .where(eq(user.id, scope.userId))
            .then((rows) => rows[0]?.name ?? null)
        : null
      throw new HarnessAccountLimitError(provider, until, owner, scope.userId)
    }
    throw new HarnessAccountUnavailableError(
      scope.userId
        ? "No available linked account for this provider. Connect an account in Settings → Linked accounts, or wait for its usage limit to reset."
        : "None of this agent's accounts for this provider is available. An admin can change them in the agent's settings, or switch it to API billing."
    )
  }
  return { ...base, source: "subscription", accountId: account.id }
}

const PLAN_NAME = { claude: "Claude plan", chatgpt: "ChatGPT plan" } as const

// "in about 2 hours": the reader's time zone isn't known here.
function resetsIn(until: Date) {
  const minutes = Math.max(
    1,
    Math.round((until.getTime() - Date.now()) / 60_000)
  )
  if (minutes < 60) return `in about ${minutes} min`
  const hours = Math.round(minutes / 60)
  return hours < 48
    ? `in about ${hours} h`
    : `in about ${Math.round(hours / 24)} days`
}

// No connected or selected account can pay (as opposed to a query failure),
// so a code-session payer may move on to the next payer.
export class HarnessAccountUnavailableError extends Error {}

// A person's (or an agent's) plan is at its usage limit on every account
// that could pay. The message names whose and when it resets, for the
// person in the session and for an agent steering it.
export class HarnessAccountLimitError extends Error {
  constructor(
    readonly provider: "claude" | "chatgpt",
    readonly until: Date,
    readonly ownerName: string | null,
    readonly userId: string | null
  ) {
    super(
      userId
        ? `${ownerName ?? "Your"}${ownerName ? "'s" : ""} ${PLAN_NAME[provider]} is at its usage limit and resets ${resetsIn(until)}. Wait for it, or link another account in Settings → Linked accounts.`
        : `This agent's ${PLAN_NAME[provider]} accounts are at their usage limit; the first resets ${resetsIn(until)}. An admin can switch it to API billing in the agent's settings.`
    )
    this.name = "HarnessAccountLimitError"
  }
}

// What an agent is told when a person's plan can't run the session it
// steers: tell them, and don't move the work to another plan.
export const PLAN_LIMIT_AGENT_HINT =
  "Tell the person who asked, in the chat, with when it resets. Don't start it again on another plan or harness."
