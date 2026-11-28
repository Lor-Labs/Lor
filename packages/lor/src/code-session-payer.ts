import { checkCredits } from "@repo/billing"
import { workspaceInferenceKeyId } from "@repo/db/queries/inference"
import {
  getHarnessSettings,
  getPersonalHarnessSettings,
  HarnessAccountLimitError,
  hasPersonalAccount,
  resolveHarnessAccount,
} from "@repo/db/queries/personal-accounts"
import type { HarnessAccountRoute } from "@repo/db/schema"
import {
  CODE_SESSION_HARNESSES,
  type CodeSessionHarness,
  isCodeSessionHarness,
  isHarnessEnabled,
} from "@repo/utils/features"

// Who pays for a new code session and on which harness
// (reference/harness-accounts.md, "Code session payer"): the requester's own
// Claude Code or Codex plan, else the agent's Runs policy (its subscription
// accounts or the workspace's provider key), else Lor credits through the AI
// Gateway, else a refusal. Never Pi.

export type CodeSessionPayer =
  | "requester"
  | "agent_subscription"
  | "workspace_key"
  | "lor_credits"

export type CodeSessionRoute = {
  harness: CodeSessionHarness
  route: HarnessAccountRoute
  payer: CodeSessionPayer
}

export const CODE_SESSIONS_UNCONFIGURED =
  "Code sessions aren't set up in this workspace, so none can start. Link a Claude Code or Codex account in Settings → Linked accounts, or ask an admin to set what this agent's code sessions run on (its settings → Runs: a subscription, a workspace API key in Workspace settings → AI providers, or Lor credits)."

const CREDITS_EMPTY =
  "No code session can start: nobody's linked plan or workspace API key can pay for it, and the workspace is out of Lor credits. Link a Claude Code or Codex account in Settings → Linked accounts, add a workspace API key in Workspace settings → AI providers, or top up credits in Billing."

const PERSONAL_ONLY =
  "This code session must run on the asker's own plan, and they have no Claude Code or Codex account linked. Tell them to link one in Lor's Settings → Linked accounts, then ask again."

const PERSONAL_OPTED_OUT =
  "This code session must run on the asker's own plan, and their Settings → Linked accounts say requests in this workspace use Lor's API billing instead. Tell them to pick Claude Code, Codex or Automatic there, then ask again."

export class CodeSessionUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CodeSessionUnavailableError"
  }
}

export const PAYER_LABELS: Record<CodeSessionPayer, string> = {
  requester: "the plan of the person who asked",
  agent_subscription: "the agent's own subscription",
  workspace_key: "the workspace's API key",
  lor_credits: "Lor credits",
}

export const HARNESS_LABELS: Record<CodeSessionHarness, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
}

const providerOf = (harness: CodeSessionHarness) =>
  harness === "claude_code" ? ("claude" as const) : ("chatgpt" as const)

// The wanted harness alone, else the preferred one first, then the rest.
function harnessOrder(
  wanted: CodeSessionHarness | undefined,
  preferred: string | null | undefined
): CodeSessionHarness[] {
  const enabled = CODE_SESSION_HARNESSES.filter(isHarnessEnabled)
  if (wanted) return enabled.includes(wanted) ? [wanted] : []
  return isCodeSessionHarness(preferred) && enabled.includes(preferred)
    ? [preferred, ...enabled.filter((h) => h !== preferred)]
    : enabled
}

async function requesterRoute(
  workspaceId: string,
  userId: string,
  wanted: CodeSessionHarness | undefined
): Promise<CodeSessionRoute | "opted_out" | null> {
  const personal = await getPersonalHarnessSettings(workspaceId, userId)
  // "pi" in personal settings: the person chose not to spend their plan,
  // even when a coding agent is picked explicitly.
  if (personal.defaultHarness === "pi") return "opted_out"
  for (const harness of harnessOrder(wanted, personal.defaultHarness)) {
    const provider = providerOf(harness)
    if (!(await hasPersonalAccount(userId, provider))) continue
    // A plan at its usage limit throws: the work never moves to another
    // plan or payer (Jacob, 11-27).
    const route = await resolveHarnessAccount(
      { workspaceId, userId, agentId: null },
      provider
    )
    return { harness, route, payer: "requester" }
  }
  return null
}

export async function resolveCodeSessionPayer(args: {
  workspaceId: string
  // The agent whose Runs settings pay when nobody's plan does.
  agentId: string | null
  // A person who asked directly; null for Loops, events and check-ins,
  // which never spend a person's plan.
  requestUserId: string | null
  wanted?: CodeSessionHarness
  // Only the requester's own plan may pay (a Discord place).
  personalOnly?: boolean
}): Promise<CodeSessionRoute> {
  const { workspaceId, agentId, requestUserId, wanted } = args
  if (harnessOrder(wanted, null).length === 0)
    throw new CodeSessionUnavailableError(
      wanted
        ? `${HARNESS_LABELS[wanted]} is unavailable right now. Pick another coding agent.`
        : CODE_SESSIONS_UNCONFIGURED
    )

  const own = requestUserId
    ? await requesterRoute(workspaceId, requestUserId, wanted)
    : null
  if (own && own !== "opted_out") return own
  if (args.personalOnly)
    throw new CodeSessionUnavailableError(
      own === "opted_out" ? PERSONAL_OPTED_OUT : PERSONAL_ONLY
    )

  const settings = await getHarnessSettings({ agentId })
  const order = harnessOrder(wanted, settings.defaultHarness)
  const scope = { workspaceId, userId: null, agentId }
  for (const harness of order) {
    const provider = providerOf(harness)
    const claude = provider === "claude"
    const useSubscriptions = claude
      ? settings.claudeUseSubscriptions
      : settings.codexUseSubscriptions
    const billing = claude
      ? settings.claudeApiBilling
      : settings.codexApiBilling
    if (useSubscriptions && agentId) {
      try {
        const route = await resolveHarnessAccount(scope, provider)
        return { harness, route, payer: payerOfRoute(route) }
      } catch (err) {
        if (err instanceof HarnessAccountLimitError) throw err
        // No account selected or connected: try the next payer.
      }
    } else if (
      billing === "byok" &&
      (await workspaceInferenceKeyId(
        workspaceId,
        claude ? "anthropic" : "openai"
      ))
    ) {
      return {
        harness,
        route: {
          ...scope,
          provider,
          source: "api",
          accountId: null,
          apiBilling: "byok",
        },
        payer: "workspace_key",
      }
    }
  }

  const harness = order[0]
  if (!harness)
    throw new CodeSessionUnavailableError(CODE_SESSIONS_UNCONFIGURED)
  if (!(await checkCredits(workspaceId)).allowed)
    throw new CodeSessionUnavailableError(CREDITS_EMPTY)
  return {
    harness,
    route: {
      ...scope,
      provider: providerOf(harness),
      source: "api",
      accountId: null,
      apiBilling: "lor",
    },
    payer: "lor_credits",
  }
}

// What paid a route that was pinned before, for a session's follow-up.
export function payerOfRoute(route: HarnessAccountRoute): CodeSessionPayer {
  if (route.source === "subscription")
    return route.userId ? "requester" : "agent_subscription"
  return route.apiBilling === "byok" ? "workspace_key" : "lor_credits"
}
