import { recordUsage } from "@repo/billing"
import {
  CONNECTOR_EVENTS,
  CONNECTOR_LIST,
  CONNECTOR_TOOLS,
  type ConnectorDescriptor,
  enabledConnectorTools,
  isConnectorEvent,
  recommendedConnectorTools,
} from "@repo/connectors"
import { db, schema } from "@repo/db"
import { agentIdsByChannel } from "@repo/db/queries/agents"
import { assertWorkspaceActive } from "@repo/db/queries/beta-access"
import { listAccessibleChannelIds } from "@repo/db/queries/channel-access"
import {
  channel,
  connectorTrigger,
  integrationConnection,
} from "@repo/db/schema"
import { env } from "@repo/env/server"
import { suggestListeners } from "@repo/lor/listener-suggest"
import {
  connectGranola as connectGranolaKey,
  deleteAttioWebhook,
  deleteGranolaWebhook,
  connectAttio as exchangeAttioCode,
  connectLinear as exchangeLinearCode,
  connectNotion as exchangeNotionCode,
  type GranolaConnectError,
  getAttioAccessToken,
  getGranolaApiKey,
  getInstallationOverview,
  connectBetterstack as verifyBetterstackToken,
  connectCircleback as verifyCirclebackKey,
  connectCloudwatch as verifyCloudwatchKeys,
  connectDatadog as verifyDatadogKeys,
} from "@repo/lor/providers"
import { encryptSecret } from "@repo/utils/crypto"
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm"
import { actCodeChanged, actCodeOf, checkActTarget } from "@/lib/act-target"
import {
  githubAccountToken,
  githubAuthorizeUrl,
  verifyGithubInstallationOwner,
} from "@/lib/github-account"
import {
  clearGithubConnectIntent,
  readGithubConnectIntent,
  recordGithubConnectIntent,
} from "@/lib/github-connect-intent"
import { invalidateGithubRepoCache } from "@/lib/github-repo-cache"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { lastActByTrigger } from "@/lib/last-act"
import { logger } from "@/lib/logger"
import { signOAuthState, verifyOAuthState } from "@/lib/oauth-state"
import {
  assertWorkspaceAuthority,
  hasWorkspaceAuthority,
  resolveWorkspaceAuthority,
} from "@/lib/permissions"
import { userCanAccessChannel } from "@/lib/queries/channel-access"
import type { AppRouteHandler } from "@/lib/types/app-types"
import { ATTIO_WEBHOOK_EVENTS } from "@/routes/v1/integrations/attio/index"
import type {
  CompleteGithubSetupRoute,
  ConnectAttioRoute,
  ConnectBetterstackRoute,
  ConnectCirclebackRoute,
  ConnectCloudwatchRoute,
  ConnectDatadogRoute,
  ConnectGranolaRoute,
  ConnectLinearRoute,
  ConnectNotionRoute,
  CreateListenerRoute,
  DeleteListenerRoute,
  DisconnectIntegrationRoute,
  ListenerActivityRoute,
  ListenerSuggestionsRoute,
  ListIntegrationsRoute,
  SetCirclebackWebhookSecretRoute,
  StartGithubConnectRoute,
  UpdateIntegrationToolsRoute,
  UpdateListenerRoute,
} from "@/routes/v1/integrations/routes"

// Used for both the authorize URL and the token exchange — they must match.
const linearRedirectUri = () =>
  `${env.APP_BASE_URL}/integrations/linear/callback`

const attioRedirectUri = () => `${env.APP_BASE_URL}/integrations/attio/callback`

// Where Attio delivers events — must be publicly reachable (tunnel in dev).
const attioWebhookTargetUrl = () =>
  `${env.NEXT_PUBLIC_API_URL.replace(/\/+$/, "")}/v1/integrations/attio/webhook`

// Granola accepts only a public HTTPS URL, so local development connects
// without a webhook. The path names the connection by its key fingerprint.
function granolaWebhookTargetUrl(): ((externalId: string) => string) | null {
  const base = env.NEXT_PUBLIC_API_URL.replace(/\/+$/, "")
  let url: URL
  try {
    url = new URL(base)
  } catch {
    return null
  }
  if (
    url.protocol !== "https:" ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    /^(127\.|10\.|192\.168\.|0\.0\.0\.0$)/.test(url.hostname)
  ) {
    return null
  }
  return (externalId) => `${base}/v1/integrations/granola/webhook/${externalId}`
}

// Pasted into a Circleback automation's "Send webhook request" step.
const circlebackWebhookUrl = (connectionId: string) =>
  `${env.NEXT_PUBLIC_API_URL.replace(/\/+$/, "")}/v1/integrations/circleback/webhook/${connectionId}`

const GRANOLA_CONNECT_ERRORS: Record<GranolaConnectError, string> = {
  invalid_key:
    "Granola didn't accept this API key. Check that it was copied whole and hasn't been revoked.",
  not_workspace_key:
    "This looks like a personal Granola key. Lor needs a workspace API key: a Granola admin creates one in Settings → Connectors → Workspace API keys.",
  webhooks_unavailable:
    "Granola's webhooks aren't available for this workspace. They need a Business or Enterprise plan.",
  webhook_failed:
    "Granola didn't register Lor's webhook. Try again in a minute.",
}

const notionRedirectUri = () =>
  `${env.APP_BASE_URL}/integrations/notion/callback`

// actor=app: actions are attributed to the Lor app (and its app user costs
// no Linear seat). Scope is comma-separated per Linear — keep the comma literal.
function linearConnectUrl(state: string): string | null {
  if (!env.LINEAR_CLIENT_ID) return null
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.LINEAR_CLIENT_ID,
    redirect_uri: linearRedirectUri(),
    state,
    actor: "app",
    prompt: "consent",
  })
  return `https://linear.app/oauth/authorize?${params.toString()}&scope=read,write`
}

function attioConnectUrl(state: string): string | null {
  if (!env.ATTIO_CLIENT_ID) return null
  // Attio OAuth scopes are configured on the app in the Developer Console,
  // not requested on this URL. Keep the required reads and webhook:read-write;
  // enable the four reviewed ATTIO_WRITE_SCOPES for CRM writes. Reconnect to
  // receive updated scopes. Tool selections still restrict what Lor can use.
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.ATTIO_CLIENT_ID,
    redirect_uri: attioRedirectUri(),
    state,
  })
  return `https://app.attio.com/authorize?${params.toString()}`
}

function notionConnectUrl(state: string): string | null {
  if (!env.NOTION_CLIENT_ID) return null
  // Notion capabilities are configured in the Developer portal, not requested
  // on this URL. Configure Read/Insert/Update content, Read/Insert comments,
  // and User information without email addresses. New capabilities require
  // reauthorization; workspace and profile tool selections still restrict writes.
  const params = new URLSearchParams({
    owner: "user",
    client_id: env.NOTION_CLIENT_ID,
    redirect_uri: notionRedirectUri(),
    response_type: "code",
    state,
  })
  return `https://api.notion.com/v1/oauth/authorize?${params.toString()}`
}

function githubInstallUrl(state: string): string | null {
  if (!env.GITHUB_APP_SLUG) return null
  return `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new?state=${encodeURIComponent(state)}`
}

// The connect entry point per auth type. The `state` round-trips back to the
// callback/setup redirect as a short-lived signed state, CSRF-bound to the
// user + workspace. Clients start GitHub through startGithubConnect instead,
// which also records the connect intent. null → the connector shows as
// Unavailable.
function connectUrlFor(
  descriptor: ConnectorDescriptor,
  ctx: { slug: string; userId: string }
): string | null {
  switch (descriptor.authType) {
    case "github-app":
      return githubInstallUrl(signOAuthState(ctx.slug, ctx.userId))
    case "oauth":
      switch (descriptor.id) {
        case "linear":
          return linearConnectUrl(signOAuthState(ctx.slug, ctx.userId))
        case "attio":
          return attioConnectUrl(signOAuthState(ctx.slug, ctx.userId))
        case "notion":
          return notionConnectUrl(signOAuthState(ctx.slug, ctx.userId))
        default:
          return null
      }
    case "api-key":
      // Keyed connectors are entered in-app, not via a redirect.
      return null
    case "token":
      // BYO webhooks are created from channel settings, never connected here.
      return null
  }
}

export const listIntegrations: AppRouteHandler<ListIntegrationsRoute> = async (
  c
) => {
  const canManage = hasWorkspaceAuthority(c.var.authority, {
    connector: ["manage"],
  })
  const workspace = c.var.workspace

  const connections = await db
    .select({
      id: integrationConnection.id,
      provider: integrationConnection.provider,
      accountLogin: integrationConnection.accountLogin,
      enabledTools: integrationConnection.enabledTools,
      externalId: integrationConnection.externalId,
      webhookSecret: integrationConnection.webhookSecret,
      webhookReceivedAt: integrationConnection.webhookReceivedAt,
    })
    .from(integrationConnection)
    .where(
      and(
        eq(integrationConnection.workspaceId, workspace.id),
        eq(integrationConnection.status, "active")
      )
    )
  const byProvider = new Map(connections.map((r) => [r.provider, r]))

  const triggers =
    connections.length > 0
      ? await db
          .select({
            id: connectorTrigger.id,
            connectionId: connectorTrigger.connectionId,
            event: connectorTrigger.event,
            channelId: connectorTrigger.channelId,
            agentId: connectorTrigger.agentId,
            filter: connectorTrigger.filter,
            post: connectorTrigger.post,
            notify: connectorTrigger.notify,
            actInstructions: connectorTrigger.actInstructions,
            actSessionMode: connectorTrigger.actSessionMode,
            actRepoFullName: connectorTrigger.actRepoFullName,
            actBaseBranch: connectorTrigger.actBaseBranch,
            actWindowSeconds: connectorTrigger.actWindowSeconds,
          })
          .from(connectorTrigger)
          .where(
            inArray(
              connectorTrigger.connectionId,
              connections.map((r) => r.id)
            )
          )
          .orderBy(asc(connectorTrigger.createdAt))
      : []
  const accessibleChannels = await listAccessibleChannelIds(
    c.var.user.id,
    workspace.id
  )
  const visibleTriggers = triggers.filter((trigger) =>
    accessibleChannels.has(trigger.channelId)
  )
  // Oldest first, so an event's listeners keep the order they were added in.
  const triggersByEvent = new Map<string, typeof visibleTriggers>()
  for (const trigger of visibleTriggers) {
    const key = `${trigger.connectionId}:${trigger.event}`
    triggersByEvent.set(key, [...(triggersByEvent.get(key) ?? []), trigger])
  }
  // A listener that names no agent is heard by its chat's first one.
  const chatAgents = await agentIdsByChannel([
    ...new Set(visibleTriggers.map((t) => t.channelId)),
  ])

  // Newest agent_run per trigger in one query — one per event would fan out
  // across every connector.
  const lastActs = await lastActByTrigger(
    visibleTriggers.map((t) => t.id),
    [...accessibleChannels]
  )

  if (!env.GITHUB_APP_SLUG) {
    logger.warn(
      { workspaceSlug: workspace.slug },
      "GITHUB_APP_SLUG not set; GitHub integration shows as Unavailable"
    )
  }

  // GitHub surfaces its accessible repos (read-only) + manage URL; other
  // connectors have none. Best-effort — a hiccup leaves them null.
  const MAX_REPOS = 100

  const providers = await Promise.all(
    CONNECTOR_LIST.map(async (descriptor) => {
      const conn = byProvider.get(descriptor.id) ?? null
      let repos:
        | { fullName: string; private: boolean; defaultBranch: string }[]
        | null = null
      let repoCount: number | null = null
      let manageUrl: string | null = null
      if (descriptor.id === "github" && conn) {
        const overview = await getInstallationOverview(conn.externalId).catch(
          () => null
        )
        if (overview) {
          repoCount = overview.repos.length
          repos = overview.repos.slice(0, MAX_REPOS).map((r) => ({
            fullName: r.fullName,
            private: r.private,
            defaultBranch: r.defaultBranch,
          }))
          manageUrl = overview.manageUrl
        }
      }
      const configuredUrl = connectUrlFor(descriptor, {
        slug: workspace.slug,
        userId: c.var.user.id,
      })
      return {
        id: descriptor.id,
        name: descriptor.label,
        description: descriptor.description,
        tools: [...CONNECTOR_TOOLS[descriptor.id]],
        enabledTools: conn
          ? enabledConnectorTools(descriptor.id, conn.enabledTools)
          : recommendedConnectorTools(descriptor.id),
        connected: !!conn,
        accountLogin: conn?.accountLogin ?? null,
        connectionId: conn?.id ?? null,
        authType: descriptor.authType,
        canManage,
        // Whether the connector is configured server-side — independent of the
        // caller's permission. api-key connectors have no connect URL; they only
        // need the encryption key configured to accept pasted credentials.
        available:
          descriptor.authType === "api-key"
            ? Boolean(env.INTEGRATION_ENCRYPTION_KEY)
            : configuredUrl !== null,
        connectUrl: canManage ? configuredUrl : null,
        repos,
        repoCount,
        manageUrl,
        inboundWebhook:
          descriptor.id === "circleback" && conn && canManage
            ? {
                url: circlebackWebhookUrl(conn.id),
                secretSet: conn.webhookSecret !== null,
                receivedAt: conn.webhookReceivedAt?.toISOString() ?? null,
              }
            : null,
        events: CONNECTOR_EVENTS[descriptor.id].map((e) => ({
          key: e.key,
          label: e.label,
          listeners: (conn
            ? (triggersByEvent.get(`${conn.id}:${e.key}`) ?? [])
            : []
          ).map((trigger) => ({
            id: trigger.id,
            channelId: trigger.channelId,
            agentId:
              trigger.agentId ?? chatAgents.get(trigger.channelId)?.[0] ?? null,
            filter: trigger.filter,
            post: trigger.post,
            notify: trigger.notify,
            actInstructions: trigger.actInstructions,
            actSessionMode: trigger.actSessionMode,
            actCode: actCodeOf(trigger),
            actWindowSeconds: trigger.actWindowSeconds,
            lastAct: lastActs.get(trigger.id) ?? null,
          })),
        })),
      }
    })
  )

  return c.json({ providers }, HttpStatusCodes.OK)
}

export const startGithubConnect: AppRouteHandler<
  StartGithubConnectRoute
> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { connector: ["manage"] })
  const workspace = c.var.workspace
  const user = c.var.user

  await assertWorkspaceActive(workspace.id)
  const unavailable = () =>
    c.json(
      { success: false, message: "GitHub isn't available on this server" },
      HttpStatusCodes.BAD_REQUEST
    )
  const url = githubInstallUrl(signOAuthState(workspace.slug, user.id))
  if (!url) return unavailable()

  // Setup verifies installation ownership with the person's own GitHub
  // account, so a missing or expired link is authorized first; its callback
  // then asks for the install URL again.
  const account = await githubAccountToken(user.id).catch(() => null)
  if (account?.status !== "ok") {
    const authorizeUrl = githubAuthorizeUrl(user.id, workspace.slug)
    if (!authorizeUrl) return unavailable()
    return c.json(
      { url: authorizeUrl, step: "account" as const },
      HttpStatusCodes.OK
    )
  }

  // Best effort: a fresh install returns the signed state on its own.
  await recordGithubConnectIntent(user.id, workspace.id).catch((err) =>
    logger.warn({ err }, "GitHub connect intent not recorded")
  )
  return c.json({ url, step: "install" as const }, HttpStatusCodes.OK)
}

// GitHub's Setup URL page posts here. Session-scoped because the workspace
// isn't in the URL: the signed state names it on a fresh install, and the
// connect intent covers the configure-page redirect that drops `state`.
export const completeGithubSetup: AppRouteHandler<
  CompleteGithubSetupRoute
> = async (c) => {
  const user = c.var.user
  const { installationId, state } = c.req.valid("json")

  const stateSlug = state ? verifyOAuthState(state, user.id) : null
  const intentWorkspaceId = state
    ? null
    : await readGithubConnectIntent(user.id).catch(() => null)
  const target = stateSlug
    ? eq(schema.workspace.slug, stateSlug)
    : intentWorkspaceId
      ? eq(schema.workspace.id, intentWorkspaceId)
      : null
  const workspace = target
    ? await db
        .select({
          id: schema.workspace.id,
          slug: schema.workspace.slug,
          ownerId: schema.workspace.ownerId,
        })
        .from(schema.workspace)
        .where(target)
        .limit(1)
        .then((rows) => rows[0])
    : undefined
  if (!workspace) {
    return c.json(
      {
        success: false,
        message: "This GitHub connection expired. Start it again from Lor.",
      },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const member = await db
    .select({
      userId: schema.workspaceMember.userId,
      role: schema.workspaceMember.role,
    })
    .from(schema.workspaceMember)
    .where(
      and(
        eq(schema.workspaceMember.workspaceId, workspace.id),
        eq(schema.workspaceMember.userId, user.id)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!member) {
    return c.json(
      { success: false, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }
  assertWorkspaceAuthority(await resolveWorkspaceAuthority(member, workspace), {
    connector: ["manage"],
  })

  await assertWorkspaceActive(workspace.id)
  const account = await githubAccountToken(user.id).catch(() => null)
  const verified =
    account?.status === "ok"
      ? await verifyGithubInstallationOwner(
          account.token,
          installationId
        ).catch(() => null)
      : null
  if (!verified) {
    return c.json(
      {
        success: false,
        message:
          "Connect the GitHub account that owns this installation. For an organization, an organization owner must connect it.",
      },
      HttpStatusCodes.FORBIDDEN
    )
  }
  const accountLogin = verified.accountLogin

  const ok = await replaceActiveConnection({
    workspaceId: workspace.id,
    provider: "github",
    connectedById: user.id,
    externalId: installationId,
    clearOnRevoke: {},
    values: { accountLogin },
  })
  if (!ok) {
    return c.json(
      {
        success: false,
        message: "This GitHub installation is connected to another workspace",
      },
      HttpStatusCodes.CONFLICT
    )
  }

  // A (re)install can change the selected repos — drop any stale cached list.
  await invalidateGithubRepoCache(installationId)
  await clearGithubConnectIntent(user.id).catch(() => {})

  return c.json(
    { success: true as const, workspaceSlug: workspace.slug, accountLogin },
    HttpStatusCodes.OK
  )
}

type ConnectionWrite = Partial<typeof integrationConnection.$inferInsert>

// Shared connect transaction: serialize concurrent connects for this
// workspace+provider (advisory lock, held until commit/rollback), refuse an
// externalId connected to another workspace, retire this workspace's other
// active rows (wiping their secrets via clearOnRevoke), and upsert the new
// connection. Returns false when the externalId is connected elsewhere.
async function replaceActiveConnection(opts: {
  workspaceId: string
  provider: ConnectorDescriptor["id"]
  connectedById: string
  externalId: string
  clearOnRevoke: ConnectionWrite
  values: ConnectionWrite
  // Upsert set when it differs from the insert values (defaults to values).
  set?: ConnectionWrite
  // Take over another workspace's revoked row. Only for external ids the
  // connect itself proves (OAuth code exchange, verified keys); a GitHub
  // installation id is client-supplied, so GitHub never reclaims.
  reclaimRevoked?: boolean
}): Promise<boolean> {
  const { workspaceId, provider, externalId } = opts
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${workspaceId}:${provider}`}, 0))`
    )

    const existing = await tx
      .select({
        id: integrationConnection.id,
        workspaceId: integrationConnection.workspaceId,
        status: integrationConnection.status,
      })
      .from(integrationConnection)
      .where(
        and(
          eq(integrationConnection.provider, provider),
          eq(integrationConnection.externalId, externalId)
        )
      )
      .limit(1)
      .then((rows) => rows[0])
    if (existing && existing.workspaceId !== workspaceId) {
      if (existing.status !== "revoked" || !opts.reclaimRevoked) return false
      // A revoked row (replaced or suspended) no longer serves its old
      // workspace, and retrieval already ignores its sources. Delete it, with
      // its triggers and repo config, so the external id can move here.
      await tx
        .delete(integrationConnection)
        .where(eq(integrationConnection.id, existing.id))
    }

    await tx
      .update(integrationConnection)
      .set({ status: "revoked", ...opts.clearOnRevoke })
      .where(
        and(
          eq(integrationConnection.workspaceId, workspaceId),
          eq(integrationConnection.provider, provider),
          eq(integrationConnection.status, "active"),
          ne(integrationConnection.externalId, externalId)
        )
      )

    const written = await tx
      .insert(integrationConnection)
      .values({
        workspaceId,
        provider,
        externalId,
        status: "active",
        enabledTools: recommendedConnectorTools(provider),
        ...opts.values,
        createdBy: opts.connectedById,
      })
      .onConflictDoUpdate({
        target: [
          integrationConnection.provider,
          integrationConnection.externalId,
        ],
        // Guards the reassignment race the pre-check can't: only update a row
        // this workspace already owns.
        set: {
          workspaceId,
          status: "active",
          ...(opts.set ?? opts.values),
          createdBy: opts.connectedById,
        },
        setWhere: eq(integrationConnection.workspaceId, workspaceId),
      })
      .returning({ id: integrationConnection.id })

    return written.length > 0
  })
}

// Every OAuth connector stores the same rotating-credential columns; wipe them
// all when retiring a row.
const OAUTH_TOKEN_WIPE = {
  accessToken: null,
  refreshToken: null,
  tokenExpiresAt: null,
  scope: null,
  // A revoked row must not keep a stale webhook binding — the receiver looks
  // connections up by webhookId.
  webhookId: null,
  webhookSecret: null,
} satisfies ConnectionWrite

export const connectLinear: AppRouteHandler<ConnectLinearRoute> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { connector: ["manage"] })
  const workspace = c.var.workspace
  const { code, state } = c.req.valid("json")

  // Verify the signed OAuth state before spending the code: it must be minted
  // for this user and bound to this workspace (blocks connection fixation).
  if (verifyOAuthState(state, c.var.user.id) !== workspace.slug) {
    return c.json(
      { success: false, message: "Invalid or expired connection request" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  // Exchange the code for tokens + resolve the org (returns encrypted tokens).
  const result = await exchangeLinearCode(code, linearRedirectUri()).catch(
    () => null
  )
  if (!result) {
    return c.json(
      { success: false, message: "Couldn't connect Linear" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const ok = await replaceActiveConnection({
    workspaceId: workspace.id,
    provider: "linear",
    connectedById: c.var.user.id,
    externalId: result.externalId,
    reclaimRevoked: true,
    clearOnRevoke: OAUTH_TOKEN_WIPE,
    values: {
      accountLogin: result.accountLabel,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      tokenExpiresAt: result.tokenExpiresAt,
      scope: result.scope,
    },
  })

  if (!ok) {
    return c.json(
      {
        success: false,
        message: "This Linear workspace is connected to another workspace",
      },
      HttpStatusCodes.CONFLICT
    )
  }

  return c.json(
    { success: true as const, accountLogin: result.accountLabel },
    HttpStatusCodes.OK
  )
}

export const connectDatadog: AppRouteHandler<ConnectDatadogRoute> = async (
  c
) => {
  assertWorkspaceAuthority(c.var.authority, { connector: ["manage"] })
  const workspace = c.var.workspace
  const { site, apiKey, appKey } = c.req.valid("json")

  if (!env.INTEGRATION_ENCRYPTION_KEY) {
    return c.json(
      { success: false, message: "Datadog isn't available on this server" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  // Verify the keys can actually read logs before persisting (returns them
  // encrypted, with the external id fingerprinted from the API key).
  const result = await verifyDatadogKeys({ site, apiKey, appKey }).catch(
    () => null
  )
  if (!result) {
    return c.json(
      {
        success: false,
        message:
          "Couldn't verify the Datadog keys — check the site, API key, and that the application key can read logs",
      },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const ok = await replaceActiveConnection({
    workspaceId: workspace.id,
    provider: "datadog",
    connectedById: c.var.user.id,
    externalId: result.externalId,
    reclaimRevoked: true,
    clearOnRevoke: { apiKey: null, appKey: null, site: null },
    values: {
      accountLogin: result.accountLabel,
      apiKey: result.apiKey,
      appKey: result.appKey,
      site,
    },
  })

  if (!ok) {
    return c.json(
      {
        success: false,
        message: "These Datadog keys are connected to another workspace",
      },
      HttpStatusCodes.CONFLICT
    )
  }

  return c.json(
    { success: true as const, accountLogin: result.accountLabel },
    HttpStatusCodes.OK
  )
}

export const connectCloudwatch: AppRouteHandler<
  ConnectCloudwatchRoute
> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { connector: ["manage"] })
  const workspace = c.var.workspace
  const { region, accessKeyId, secretAccessKey } = c.req.valid("json")

  if (!env.INTEGRATION_ENCRYPTION_KEY) {
    return c.json(
      {
        success: false,
        message: "CloudWatch isn't available on this server",
      },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  // Verify the keys can resolve their account and read logs before
  // persisting (returns them encrypted, external id = the AWS account id).
  const result = await verifyCloudwatchKeys({
    region,
    accessKeyId,
    secretAccessKey,
  }).catch(() => null)
  if (!result) {
    return c.json(
      {
        success: false,
        message:
          "Couldn't verify the AWS credentials — check the region, access key, and that the key can read CloudWatch logs",
      },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const ok = await replaceActiveConnection({
    workspaceId: workspace.id,
    provider: "cloudwatch",
    connectedById: c.var.user.id,
    externalId: result.externalId,
    reclaimRevoked: true,
    clearOnRevoke: { apiKey: null, appKey: null, site: null },
    values: {
      accountLogin: result.accountLabel,
      apiKey: result.accessKeyId,
      appKey: result.secretAccessKey,
      site: region,
    },
  })

  if (!ok) {
    return c.json(
      {
        success: false,
        message: "This AWS account is connected to another workspace",
      },
      HttpStatusCodes.CONFLICT
    )
  }

  return c.json(
    { success: true as const, accountLogin: result.accountLabel },
    HttpStatusCodes.OK
  )
}

export const connectAttio: AppRouteHandler<ConnectAttioRoute> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { connector: ["manage"] })
  const workspace = c.var.workspace
  const { code, state } = c.req.valid("json")

  if (verifyOAuthState(state, c.var.user.id) !== workspace.slug) {
    return c.json(
      { success: false, message: "Invalid or expired connection request" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const result = await exchangeAttioCode(code, attioRedirectUri(), {
    targetUrl: attioWebhookTargetUrl(),
    eventTypes: ATTIO_WEBHOOK_EVENTS,
  }).catch(() => null)
  if (!result) {
    return c.json(
      {
        success: false,
        message:
          "Couldn't connect Attio — verify the app has the required read access and webhook:read-write. Supported CRM write scopes are record_permission, list_entry, note, and task; remove other write scopes.",
      },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  // A reconnect to a DIFFERENT Attio workspace revokes the old row and wipes
  // its webhookId/token (OAUTH_TOKEN_WIPE) — capture them first so the old
  // provider-side webhook can be deleted, like the disconnect path does.
  const outgoing = await db
    .select({
      externalId: integrationConnection.externalId,
      webhookId: integrationConnection.webhookId,
    })
    .from(integrationConnection)
    .where(
      and(
        eq(integrationConnection.workspaceId, workspace.id),
        eq(integrationConnection.provider, "attio"),
        eq(integrationConnection.status, "active"),
        ne(integrationConnection.externalId, result.externalId)
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
  const outgoingToken = outgoing?.webhookId
    ? await getAttioAccessToken(outgoing.externalId).catch(() => null)
    : null

  const ok = await replaceActiveConnection({
    workspaceId: workspace.id,
    provider: "attio",
    connectedById: c.var.user.id,
    externalId: result.externalId,
    reclaimRevoked: true,
    clearOnRevoke: OAUTH_TOKEN_WIPE,
    values: {
      accountLogin: result.accountLabel,
      accessToken: result.accessToken,
      tokenExpiresAt: result.tokenExpiresAt,
      scope: result.scope,
      webhookId: result.webhookId,
      webhookSecret: result.webhookSecret,
    },
    // Attio issues no refresh token; a reused row must not keep a stale one.
    set: {
      accountLogin: result.accountLabel,
      accessToken: result.accessToken,
      refreshToken: null,
      tokenExpiresAt: result.tokenExpiresAt,
      scope: result.scope,
      webhookId: result.webhookId,
      webhookSecret: result.webhookSecret,
    },
  })

  if (!ok) {
    return c.json(
      {
        success: false,
        message: "This Attio workspace is connected to another workspace",
      },
      HttpStatusCodes.CONFLICT
    )
  }

  if (outgoingToken && outgoing?.webhookId) {
    // Best effort — a leftover webhook just degrades on Attio's side.
    void deleteAttioWebhook(outgoingToken, outgoing.webhookId)
  } else if (outgoing?.webhookId) {
    // No token means no way to delete it — leave a trace of the leak.
    logger.warn(
      { webhookId: outgoing.webhookId, externalId: outgoing.externalId },
      "Old Attio webhook left registered; token unavailable for cleanup"
    )
  }

  return c.json(
    { success: true as const, accountLogin: result.accountLabel },
    HttpStatusCodes.OK
  )
}

export const connectNotion: AppRouteHandler<ConnectNotionRoute> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { connector: ["manage"] })
  const workspace = c.var.workspace
  const { code, state } = c.req.valid("json")

  if (verifyOAuthState(state, c.var.user.id) !== workspace.slug) {
    return c.json(
      { success: false, message: "Invalid or expired connection request" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const result = await exchangeNotionCode(code, notionRedirectUri()).catch(
    () => null
  )
  if (!result) {
    return c.json(
      {
        success: false,
        message:
          "Couldn't connect Notion — verify the connection has Read content, Read comments, and user information without email addresses",
      },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const ok = await replaceActiveConnection({
    workspaceId: workspace.id,
    provider: "notion",
    connectedById: c.var.user.id,
    externalId: result.externalId,
    reclaimRevoked: true,
    clearOnRevoke: OAUTH_TOKEN_WIPE,
    values: {
      providerWorkspaceId: result.providerWorkspaceId,
      accountLogin: result.accountLabel,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      tokenExpiresAt: null,
      scope: result.scope,
    },
  })

  if (!ok) {
    return c.json(
      {
        success: false,
        message: "This Notion authorization is connected elsewhere",
      },
      HttpStatusCodes.CONFLICT
    )
  }

  return c.json(
    { success: true as const, accountLogin: result.accountLabel },
    HttpStatusCodes.OK
  )
}

// The connection a listener route names, when it is this workspace's and
// has events of its own. Channel webhooks are managed under webhook:manage.
async function listenerConnection(workspaceId: string, connectionId: string) {
  const connection = await db
    .select({
      id: integrationConnection.id,
      provider: integrationConnection.provider,
    })
    .from(integrationConnection)
    .where(
      and(
        eq(integrationConnection.id, connectionId),
        eq(integrationConnection.workspaceId, workspaceId)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  return connection && connection.provider !== "webhook" ? connection : null
}

// A chat a listener can be anchored to: a text chat of this workspace the
// caller can see. Pointing one at a chat they can't see would let an admin
// read a private chat's replies.
async function listenerChat(
  workspaceId: string,
  channelId: string,
  userId: string
): Promise<boolean> {
  const target = await db
    .select({ id: channel.id })
    .from(channel)
    .where(
      and(
        eq(channel.id, channelId),
        eq(channel.workspaceId, workspaceId),
        eq(channel.type, "text")
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  return !!target && (await userCanAccessChannel(channelId, userId))
}

// Several agents can listen to one event, each once
// (reference/agents-and-chats.md, decision 42).
export const createListener: AppRouteHandler<CreateListenerRoute> = async (
  c
) => {
  assertWorkspaceAuthority(c.var.authority, { connector: ["manage"] })
  const workspace = c.var.workspace
  const { connectionId } = c.req.valid("param")
  const body = c.req.valid("json")

  const connection = await listenerConnection(workspace.id, connectionId)
  if (!connection) {
    return c.json(
      { success: false, message: "Connection not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  if (!isConnectorEvent(connection.provider, body.event)) {
    return c.json(
      { success: false, message: "Unknown event for this connector" },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  if (!(await listenerChat(workspace.id, body.channelId, c.var.user.id))) {
    return c.json(
      { success: false, message: "Chat not found in this workspace" },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  // The agent that listens reports in this chat, so it has to be in it.
  const inChat =
    (await agentIdsByChannel([body.channelId])).get(body.channelId) ?? []
  if (body.agentId && !inChat.includes(body.agentId)) {
    return c.json(
      { success: false, message: "That agent is not in this chat" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const existing = await db
    .select({
      agentId: connectorTrigger.agentId,
      channelId: connectorTrigger.channelId,
    })
    .from(connectorTrigger)
    .where(
      and(
        eq(connectorTrigger.connectionId, connection.id),
        eq(connectorTrigger.event, body.event)
      )
    )
  // An earlier listener that names no agent is heard by its chat's first
  // one: count that agent as listening too, so nobody is woken twice.
  const firstAgents = await agentIdsByChannel(
    existing.filter((row) => !row.agentId).map((row) => row.channelId)
  )
  const taken = existing.some((row) =>
    body.agentId
      ? (row.agentId ?? firstAgents.get(row.channelId)?.[0]) === body.agentId
      : !row.agentId && row.channelId === body.channelId
  )
  if (taken) {
    return c.json(
      {
        success: false,
        message: body.agentId
          ? "That agent already listens to this event"
          : "This event is already posted in that chat",
      },
      HttpStatusCodes.CONFLICT
    )
  }

  const sessionMode = body.actSessionMode ?? "per_event"
  const actTarget = await checkActTarget({
    workspaceId: workspace.id,
    channelId: body.channelId,
    sessionMode,
    code: body.actCode ?? null,
    recheck: true,
  })
  if (!actTarget.ok) {
    return c.json(
      { success: false, message: actTarget.message },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const [created] = await db
    .insert(connectorTrigger)
    .values({
      connectionId: connection.id,
      event: body.event,
      channelId: body.channelId,
      agentId: body.agentId,
      filter: body.filter?.trim() || null,
      // A new listener wakes its agent, which decides what to say; with no
      // agent named, the event is only posted.
      post: body.post ?? !body.agentId,
      notify: body.notify ?? false,
      actInstructions:
        body.actInstructions !== undefined
          ? body.actInstructions
          : body.agentId
            ? ""
            : null,
      actSessionMode: sessionMode,
      configuredById: c.var.user.id,
      ...actTarget.columns,
      // Absent = keep the column default.
      ...(body.actWindowSeconds !== undefined
        ? { actWindowSeconds: body.actWindowSeconds }
        : {}),
    })
    .returning({ id: connectorTrigger.id })
  if (!created) {
    return c.json(
      { success: false, message: "Failed to add the listener" },
      HttpStatusCodes.INTERNAL_SERVER_ERROR
    )
  }
  return c.json({ success: true as const, id: created.id }, HttpStatusCodes.OK)
}

// The listener a route names, when the caller can see the chat it is
// anchored to: a manager can't move or remove a private chat's listener.
async function savedListener(
  workspaceId: string,
  connectionId: string,
  listenerId: string,
  userId: string
) {
  const connection = await listenerConnection(workspaceId, connectionId)
  if (!connection) return null
  const saved = await db
    .select({
      id: connectorTrigger.id,
      channelId: connectorTrigger.channelId,
      agentId: connectorTrigger.agentId,
      actSessionMode: connectorTrigger.actSessionMode,
      actRepoFullName: connectorTrigger.actRepoFullName,
      actBaseBranch: connectorTrigger.actBaseBranch,
    })
    .from(connectorTrigger)
    .where(
      and(
        eq(connectorTrigger.id, listenerId),
        eq(connectorTrigger.connectionId, connection.id)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!saved || !(await userCanAccessChannel(saved.channelId, userId))) {
    return null
  }
  return saved
}

export const updateListener: AppRouteHandler<UpdateListenerRoute> = async (
  c
) => {
  assertWorkspaceAuthority(c.var.authority, { connector: ["manage"] })
  const workspace = c.var.workspace
  const { connectionId, listenerId } = c.req.valid("param")
  const body = c.req.valid("json")

  const saved = await savedListener(
    workspace.id,
    connectionId,
    listenerId,
    c.var.user.id
  )
  if (!saved) {
    return c.json(
      { success: false, message: "Listener not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  const channelId = body.channelId ?? saved.channelId
  const moved = channelId !== saved.channelId
  if (moved) {
    if (!(await listenerChat(workspace.id, channelId, c.var.user.id))) {
      return c.json(
        { success: false, message: "Chat not found in this workspace" },
        HttpStatusCodes.BAD_REQUEST
      )
    }
    // Its agent reports in the chat, so it has to be in the new one.
    const inChat = (await agentIdsByChannel([channelId])).get(channelId) ?? []
    if (saved.agentId && !inChat.includes(saved.agentId)) {
      return c.json(
        { success: false, message: "That agent is not in this chat" },
        HttpStatusCodes.BAD_REQUEST
      )
    }
  }

  const savedCode = actCodeOf(saved)
  const actTarget = await checkActTarget({
    workspaceId: workspace.id,
    channelId,
    sessionMode: body.actSessionMode ?? saved.actSessionMode,
    code: body.actCode !== undefined ? body.actCode : savedCode,
    // A moved listener needs the repo checked against its new chat.
    recheck: moved || actCodeChanged(body.actCode, savedCode),
  })
  if (!actTarget.ok) {
    return c.json(
      { success: false, message: actTarget.message },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  await db
    .update(connectorTrigger)
    .set({
      channelId,
      configuredById: c.var.user.id,
      actSessionMode: body.actSessionMode ?? saved.actSessionMode,
      ...actTarget.columns,
      // An empty filter clears it.
      ...(body.filter !== undefined
        ? { filter: body.filter?.trim() || null }
        : {}),
      ...(body.post !== undefined ? { post: body.post } : {}),
      ...(body.notify !== undefined ? { notify: body.notify } : {}),
      ...(body.actInstructions !== undefined
        ? { actInstructions: body.actInstructions }
        : {}),
      ...(body.actWindowSeconds !== undefined
        ? { actWindowSeconds: body.actWindowSeconds }
        : {}),
    })
    .where(eq(connectorTrigger.id, saved.id))

  return c.json({ success: true as const }, HttpStatusCodes.OK)
}

export const deleteListener: AppRouteHandler<DeleteListenerRoute> = async (
  c
) => {
  assertWorkspaceAuthority(c.var.authority, { connector: ["manage"] })
  const { connectionId, listenerId } = c.req.valid("param")
  const saved = await savedListener(
    c.var.workspace.id,
    connectionId,
    listenerId,
    c.var.user.id
  )
  if (!saved) {
    return c.json(
      { success: false, message: "Listener not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  await db.delete(connectorTrigger).where(eq(connectorTrigger.id, saved.id))
  return c.json({ success: true as const }, HttpStatusCodes.OK)
}

// Which agent fits each event nobody listens to yet, so connecting a service
// needs no picking by hand (reference/agents-and-chats.md, decision 40). The
// chat is the first one the agent is in that the caller can see.
export const listenerSuggestions: AppRouteHandler<
  ListenerSuggestionsRoute
> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { connector: ["manage"] })
  const workspace = c.var.workspace
  const { connectionId } = c.req.valid("param")
  const connection = await db
    .select({
      id: integrationConnection.id,
      provider: integrationConnection.provider,
    })
    .from(integrationConnection)
    .where(
      and(
        eq(integrationConnection.id, connectionId),
        eq(integrationConnection.workspaceId, workspace.id)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  const descriptor = CONNECTOR_LIST.find(
    (item) => item.id === connection?.provider
  )
  if (!connection || !descriptor) {
    return c.json(
      { success: false, message: "Connection not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  const [listened, placed, accessible] = await Promise.all([
    db
      .select({ event: connectorTrigger.event })
      .from(connectorTrigger)
      .where(eq(connectorTrigger.connectionId, connection.id))
      .then((rows) => new Set(rows.map((row) => row.event))),
    db
      .select({
        id: schema.agent.id,
        name: schema.agent.name,
        role: schema.agent.role,
        brief: schema.agent.brief,
        channelId: schema.channelAgent.channelId,
      })
      .from(schema.channelAgent)
      .innerJoin(schema.agent, eq(schema.agent.id, schema.channelAgent.agentId))
      .innerJoin(channel, eq(channel.id, schema.channelAgent.channelId))
      .where(
        and(
          eq(schema.agent.workspaceId, workspace.id),
          eq(channel.type, "text"),
          sql`${channel.archivedAt} is null`
        )
      )
      .orderBy(asc(schema.channelAgent.createdAt)),
    listAccessibleChannelIds(c.var.user.id, workspace.id),
  ])
  // Each agent once, with the first chat it is in that the caller can see.
  const agents = new Map<string, (typeof placed)[number]>()
  for (const row of placed) {
    if (accessible.has(row.channelId) && !agents.has(row.id)) {
      agents.set(row.id, row)
    }
  }
  const events = CONNECTOR_EVENTS[descriptor.id].filter(
    (event) => !listened.has(event.key)
  )
  const picks = await suggestListeners(
    {
      workspaceId: workspace.id,
      connector: {
        name: descriptor.label,
        description: descriptor.description,
      },
      events: events.map((event) => ({ key: event.key, label: event.label })),
      agents: [...agents.values()],
    },
    (usage) => {
      void recordUsage(usage).catch((err) =>
        logger.warn({ err }, "Listener suggestion usage recording failed")
      )
    }
  )
  return c.json(
    {
      suggestions: Object.entries(picks).flatMap(([event, agentId]) => {
        const agent = agents.get(agentId)
        return agent ? [{ event, agentId, channelId: agent.channelId }] : []
      }),
    },
    HttpStatusCodes.OK
  )
}

// What arrived for one listener and what became of it. Kept out of the way
// in the app: a place to look when someone wonders what is going on.
export const listenerActivity: AppRouteHandler<ListenerActivityRoute> = async (
  c
) => {
  const workspace = c.var.workspace
  const { connectionId, listenerId } = c.req.valid("param")
  const [trigger] = await db
    .select({
      id: connectorTrigger.id,
      channelId: connectorTrigger.channelId,
    })
    .from(connectorTrigger)
    .innerJoin(
      integrationConnection,
      eq(integrationConnection.id, connectorTrigger.connectionId)
    )
    .where(
      and(
        eq(connectorTrigger.id, listenerId),
        eq(connectorTrigger.connectionId, connectionId),
        eq(integrationConnection.workspaceId, workspace.id)
      )
    )
    .limit(1)
  if (
    !trigger ||
    !(await userCanAccessChannel(trigger.channelId, c.var.user.id))
  ) {
    return c.json(
      { success: false, message: "Listener not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  const deliveries = await db
    .select({
      id: schema.triggerDelivery.id,
      createdAt: schema.triggerDelivery.createdAt,
      outcome: schema.triggerDelivery.outcome,
      posted: schema.triggerDelivery.posted,
      subject: schema.triggerDelivery.subject,
    })
    .from(schema.triggerDelivery)
    .where(eq(schema.triggerDelivery.triggerId, trigger.id))
    .orderBy(desc(schema.triggerDelivery.createdAt))
    .limit(30)
  return c.json(
    {
      deliveries: deliveries.map((row) => ({
        id: row.id,
        at: row.createdAt.toISOString(),
        outcome: row.outcome,
        posted: row.posted,
        subject: row.subject,
      })),
    },
    HttpStatusCodes.OK
  )
}

export const disconnectIntegration: AppRouteHandler<
  DisconnectIntegrationRoute
> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { connector: ["manage"] })
  const workspace = c.var.workspace
  const { connectionId } = c.req.valid("param")

  const connection = await db
    .select({
      provider: integrationConnection.provider,
      externalId: integrationConnection.externalId,
      webhookId: integrationConnection.webhookId,
    })
    .from(integrationConnection)
    .where(
      and(
        eq(integrationConnection.id, connectionId),
        eq(integrationConnection.workspaceId, workspace.id)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  // Channel webhooks are managed under webhook:manage, not connector:manage.
  if (!connection || connection.provider === "webhook") {
    return c.json(
      { success: false, message: "Connection not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  // The token is needed to clean up the provider-side webhook, and it's only
  // readable while the connection row still exists — grab it pre-delete.
  const attioToken =
    connection.provider === "attio" && connection.webhookId
      ? await getAttioAccessToken(connection.externalId).catch(() => null)
      : null
  const granolaKey =
    connection.provider === "granola" && connection.webhookId
      ? await getGranolaApiKey(connection.externalId).catch(() => null)
      : null

  const deleted = await db
    .delete(integrationConnection)
    .where(
      and(
        eq(integrationConnection.id, connectionId),
        eq(integrationConnection.workspaceId, workspace.id)
      )
    )
    .returning({
      id: integrationConnection.id,
      provider: integrationConnection.provider,
      externalId: integrationConnection.externalId,
    })
    .then((rows) => rows[0])

  if (!deleted) {
    return c.json(
      { success: false, message: "Connection not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  if (deleted.provider === "github") {
    await invalidateGithubRepoCache(deleted.externalId)
  }
  if (deleted.provider === "attio" && attioToken && connection.webhookId) {
    // Best effort — a leftover webhook just degrades on Attio's side.
    void deleteAttioWebhook(attioToken, connection.webhookId)
  }
  if (deleted.provider === "granola" && granolaKey && connection.webhookId) {
    // Best effort — Granola disables an endpoint that keeps failing.
    void deleteGranolaWebhook(granolaKey, connection.webhookId)
  }

  return c.json({ success: true as const }, HttpStatusCodes.OK)
}

export const updateIntegrationTools: AppRouteHandler<
  UpdateIntegrationToolsRoute
> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { connector: ["manage"] })
  const { connectionId } = c.req.valid("param")
  const { enabledTools } = c.req.valid("json")
  const scope = and(
    eq(integrationConnection.id, connectionId),
    eq(integrationConnection.workspaceId, c.var.workspace.id),
    eq(integrationConnection.status, "active")
  )
  const connection = await db
    .select({ provider: integrationConnection.provider })
    .from(integrationConnection)
    .where(scope)
    .limit(1)
    .then((rows) => rows[0])
  if (!connection)
    return c.json(
      { success: false, message: "Connection not found" },
      HttpStatusCodes.NOT_FOUND
    )
  const catalog = CONNECTOR_TOOLS[connection.provider]
  const allowed = new Set(catalog.map((tool) => tool.name))
  if (catalog.length === 0 || enabledTools.some((name) => !allowed.has(name))) {
    return c.json(
      { success: false, message: "Unknown tool for this connector" },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  const updated = await db
    .update(integrationConnection)
    .set({ enabledTools: [...new Set(enabledTools)] })
    .where(scope)
    .returning({ id: integrationConnection.id })
  if (updated.length === 0)
    return c.json(
      { success: false, message: "Connection not found" },
      HttpStatusCodes.NOT_FOUND
    )
  return c.json({ success: true as const }, HttpStatusCodes.OK)
}

export const connectBetterstack: AppRouteHandler<
  ConnectBetterstackRoute
> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { connector: ["manage"] })
  if (!env.INTEGRATION_ENCRYPTION_KEY)
    return c.json(
      {
        success: false,
        message: "Better Stack isn't available on this server",
      },
      HttpStatusCodes.BAD_REQUEST
    )
  const { apiToken } = c.req.valid("json")
  const result = await verifyBetterstackToken(apiToken).catch(() => null)
  if (!result)
    return c.json(
      {
        success: false,
        message:
          "Couldn't verify Better Stack access. Use an API token with access to the products you want to investigate, not an ingestion token or DSN.",
      },
      HttpStatusCodes.BAD_REQUEST
    )
  const ok = await replaceActiveConnection({
    workspaceId: c.var.workspace.id,
    provider: "betterstack",
    connectedById: c.var.user.id,
    externalId: result.externalId,
    reclaimRevoked: true,
    clearOnRevoke: { apiKey: null },
    values: { accountLogin: result.accountLabel, apiKey: result.apiKey },
  })
  if (!ok)
    return c.json(
      {
        success: false,
        message: "This Better Stack token is connected to another workspace",
      },
      HttpStatusCodes.CONFLICT
    )
  return c.json(
    { success: true as const, accountLogin: result.accountLabel },
    HttpStatusCodes.OK
  )
}

export const connectGranola: AppRouteHandler<ConnectGranolaRoute> = async (
  c
) => {
  assertWorkspaceAuthority(c.var.authority, { connector: ["manage"] })
  if (!env.INTEGRATION_ENCRYPTION_KEY)
    return c.json(
      { success: false, message: "Granola isn't available on this server" },
      HttpStatusCodes.BAD_REQUEST
    )
  const { apiKey } = c.req.valid("json")
  const targetUrlFor = granolaWebhookTargetUrl()
  const result = await connectGranolaKey(apiKey, targetUrlFor).catch((err) => {
    logger.error({ err }, "Granola connection failed")
    return "webhook_failed" as const
  })
  if (typeof result === "string")
    return c.json(
      { success: false, message: GRANOLA_CONNECT_ERRORS[result] },
      HttpStatusCodes.BAD_REQUEST
    )

  // The outgoing connection's webhook is removed once the new one is saved.
  const outgoing = await db
    .select({
      externalId: integrationConnection.externalId,
      webhookId: integrationConnection.webhookId,
    })
    .from(integrationConnection)
    .where(
      and(
        eq(integrationConnection.workspaceId, c.var.workspace.id),
        eq(integrationConnection.provider, "granola"),
        eq(integrationConnection.status, "active"),
        ne(integrationConnection.externalId, result.externalId)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  const outgoingKey = outgoing?.webhookId
    ? await getGranolaApiKey(outgoing.externalId).catch(() => null)
    : null

  const ok = await replaceActiveConnection({
    workspaceId: c.var.workspace.id,
    provider: "granola",
    connectedById: c.var.user.id,
    externalId: result.externalId,
    reclaimRevoked: true,
    clearOnRevoke: { apiKey: null, webhookId: null, webhookSecret: null },
    values: {
      accountLogin: result.accountLabel,
      apiKey: result.apiKey,
      webhookId: result.webhookId,
      webhookSecret: result.webhookSecret,
    },
  })
  if (!ok) {
    if (result.webhookId) void deleteGranolaWebhook(apiKey, result.webhookId)
    return c.json(
      {
        success: false,
        message: "This Granola key is connected to another workspace",
      },
      HttpStatusCodes.CONFLICT
    )
  }
  if (outgoing?.webhookId && outgoingKey) {
    void deleteGranolaWebhook(outgoingKey, outgoing.webhookId)
  }
  return c.json(
    {
      success: true as const,
      accountLogin: result.accountLabel,
      events: result.webhookId !== null,
    },
    HttpStatusCodes.OK
  )
}

export const connectCircleback: AppRouteHandler<
  ConnectCirclebackRoute
> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { connector: ["manage"] })
  if (!env.INTEGRATION_ENCRYPTION_KEY)
    return c.json(
      { success: false, message: "Circleback isn't available on this server" },
      HttpStatusCodes.BAD_REQUEST
    )
  const { apiKey } = c.req.valid("json")
  const result = await verifyCirclebackKey(apiKey).catch(() => null)
  if (!result)
    return c.json(
      {
        success: false,
        message:
          "Circleback didn't accept this API key. Check that it was copied whole and hasn't been revoked.",
      },
      HttpStatusCodes.BAD_REQUEST
    )
  // A new key keeps nothing of the old connection's webhook: its secret
  // belongs to an automation step that still points at the old URL.
  const ok = await replaceActiveConnection({
    workspaceId: c.var.workspace.id,
    provider: "circleback",
    connectedById: c.var.user.id,
    externalId: result.externalId,
    reclaimRevoked: true,
    clearOnRevoke: { apiKey: null, webhookSecret: null },
    values: { accountLogin: result.accountLabel, apiKey: result.apiKey },
  })
  if (!ok)
    return c.json(
      {
        success: false,
        message: "This Circleback key is connected to another workspace",
      },
      HttpStatusCodes.CONFLICT
    )
  return c.json(
    { success: true as const, accountLogin: result.accountLabel },
    HttpStatusCodes.OK
  )
}

export const setCirclebackWebhookSecret: AppRouteHandler<
  SetCirclebackWebhookSecretRoute
> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { connector: ["manage"] })
  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!key)
    return c.json(
      { success: false, message: "Circleback isn't available on this server" },
      HttpStatusCodes.BAD_REQUEST
    )
  const { secret } = c.req.valid("json")
  const updated = await db
    .update(integrationConnection)
    .set({ webhookSecret: encryptSecret(secret, key) })
    .where(
      and(
        eq(integrationConnection.workspaceId, c.var.workspace.id),
        eq(integrationConnection.provider, "circleback"),
        eq(integrationConnection.status, "active")
      )
    )
    .returning({ id: integrationConnection.id })
  if (updated.length === 0)
    return c.json(
      { success: false, message: "Circleback isn't connected" },
      HttpStatusCodes.NOT_FOUND
    )
  return c.json({ success: true as const }, HttpStatusCodes.OK)
}
