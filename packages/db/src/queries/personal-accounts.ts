import { isHarnessEnabled } from "@repo/utils/features"
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

export async function personalRequestHarness(
  workspaceId: string,
  userId: string
) {
  const settings = await getPersonalHarnessSettings(workspaceId, userId)
  if (settings.defaultHarness !== "auto") return settings.defaultHarness
  for (const [harness, provider] of [
    ["claude_code", "claude"],
    ["codex", "chatgpt"],
  ] as const) {
    if (
      isHarnessEnabled(harness) &&
      (await hasPersonalAccount(userId, provider))
    )
      return harness
  }
  return "pi" as const
}

// Whether a person's own plan pays for what they ask: they linked an account
// that is in use, or picked how their requests run (Lor's API included).
// With neither, the agent's own accounts are the backup
// (reference/agents-and-chats.md, decision 7).
export async function hasOwnRequestRoute(workspaceId: string, userId: string) {
  const settings = await getPersonalHarnessSettings(workspaceId, userId)
  if (settings.defaultHarness !== "auto") return true
  return (await personalRequestHarness(workspaceId, userId)) !== "pi"
}

// Whose plan pays for a turn woken by this message: the person who addressed
// the agent, when they have a route of their own. Null: the agent's settings
// decide. Background observation of human chat does not authorize using its
// author's plan.
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
      explicit: sql<boolean>`${message.content} like ${`%<@${LOR_USER_ID}>%`}`,
      threadRootId: message.threadRootId,
      repliedToLor: sql<boolean>`exists (select 1 from message r where r.id = ${message.referencedMessageId} and r.author_id = ${LOR_USER_ID}::uuid)`,
    })
    .from(message)
    .innerJoin(user, eq(user.id, message.authorId))
    .innerJoin(channel, eq(channel.id, message.channelId))
    .where(
      and(eq(message.id, triggerMessageId), eq(message.channelId, channelId))
    )
  if (!trigger || trigger.isBot || !trigger.workspaceId) return null
  // In the chat only a mention or a reply wakes the agent, so a top-level
  // trigger was addressed to it. In a thread it also hears the rest.
  const addressed =
    trigger.explicit || trigger.repliedToLor || !trigger.threadRootId
  if (!addressed) return null
  return (await hasOwnRequestRoute(trigger.workspaceId, trigger.userId))
    ? trigger.userId
    : null
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
  if (!account)
    throw new Error(
      scope.userId
        ? "No available linked account for this provider. Connect an account in Settings → Linked accounts, or wait for its usage limit to reset."
        : "None of this agent's accounts for this provider is available. An admin can change them in the agent's settings, or switch it to API billing."
    )
  return { ...base, source: "subscription", accountId: account.id }
}

// Used by queue admission before a run has pinned its own payer.
export async function autonomousUsesSubscription(agentId: string | null) {
  const settings = await getHarnessSettings({ agentId })
  return settings.defaultHarness === "claude_code"
    ? settings.claudeUseSubscriptions
    : settings.defaultHarness === "codex" && settings.codexUseSubscriptions
}
