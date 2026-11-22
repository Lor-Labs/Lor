import { isHarnessEnabled } from "@repo/utils/features"
import { and, asc, eq, sql } from "drizzle-orm"
import { LOR_USER_ID } from "../constants"
import { db } from "../index"
import { channel } from "../schemas/channels"
import { message } from "../schemas/messages"
import {
  type HarnessAccountRoute,
  type HarnessAccountScope,
  harnessAccountPreference,
  type PersonalAccountProvider,
  personalAccount,
  personalHarnessSettings,
  type WorkspaceHarnessSettings,
  workspaceHarnessSettings,
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

// Background observation of human chat does not authorize using its author's plan.
export async function channelRequestUserId(
  channelId: string,
  triggerMessageId: string | null
) {
  if (!triggerMessageId) return null
  const [trigger] = await db
    .select({
      userId: message.authorId,
      isBot: user.isBot,
      explicit: sql<boolean>`${message.content} like ${`%<@${LOR_USER_ID}>%`}`,
      threadRootId: message.threadRootId,
      wakeMode: channel.agentWakeMode,
      repliedToLor: sql<boolean>`exists (select 1 from message r where r.id = ${message.referencedMessageId} and r.author_id = ${LOR_USER_ID}::uuid)`,
      agentInThread: sql<boolean>`exists (select 1 from message r where r.thread_root_id = ${message.threadRootId} and r.author_id = ${LOR_USER_ID}::uuid)`,
    })
    .from(message)
    .innerJoin(user, eq(user.id, message.authorId))
    .innerJoin(channel, eq(channel.id, message.channelId))
    .where(
      and(eq(message.id, triggerMessageId), eq(message.channelId, channelId))
    )
  if (!trigger || trigger.isBot) return null
  return trigger.explicit ||
    trigger.repliedToLor ||
    trigger.agentInThread ||
    (trigger.wakeMode === "mention" && !trigger.threadRootId)
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

export async function getWorkspaceHarnessSettings(
  workspaceId: string
): Promise<WorkspaceHarnessSettings> {
  const [saved] = await db
    .select()
    .from(workspaceHarnessSettings)
    .where(eq(workspaceHarnessSettings.workspaceId, workspaceId))
  return (
    saved ?? {
      workspaceId,
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
  )
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
    scope.userId ? null : getWorkspaceHarnessSettings(scope.workspaceId),
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
    const settings = await getWorkspaceHarnessSettings(scope.workspaceId)
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
        : "No available Lor account for this provider. An admin can update Workspace settings → Autonomous runs, or switch autonomous runs to API billing."
    )
  return { ...base, source: "subscription", accountId: account.id }
}

// Used by queue admission before a run has pinned its own payer.
export async function autonomousUsesSubscription(workspaceId: string) {
  const settings = await getWorkspaceHarnessSettings(workspaceId)
  return settings.defaultHarness === "claude_code"
    ? settings.claudeUseSubscriptions
    : settings.defaultHarness === "codex" && settings.codexUseSubscriptions
}
