import {
  CONNECTOR_EVENTS,
  CONNECTOR_LIST,
  type ConnectorDescriptor,
  connectorCapabilities,
  isConnectorEvent,
} from "@repo/connectors"
import { db } from "@repo/db"
import {
  channel,
  connectorTrigger,
  integrationConnection,
} from "@repo/db/schema"
import { env } from "@repo/env/server"
import {
  connectAttio as exchangeAttioCode,
  connectLinear as exchangeLinearCode,
  connectNotion as exchangeNotionCode,
  getInstallationOverview,
  getSourceProvider,
  connectCloudwatch as verifyCloudwatchKeys,
  connectDatadog as verifyDatadogKeys,
} from "@repo/merlin/providers"
import { and, eq, inArray, ne, sql } from "drizzle-orm"
import { invalidateGithubRepoCache } from "@/lib/github-repo-cache"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { logger } from "@/lib/logger"
import { signOAuthState, verifyOAuthState } from "@/lib/oauth-state"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  ConnectAttioRoute,
  ConnectCloudwatchRoute,
  ConnectDatadogRoute,
  ConnectGithubRoute,
  ConnectLinearRoute,
  ConnectNotionRoute,
  DisconnectIntegrationRoute,
  ListIntegrationsRoute,
  UpdateIntegrationRoute,
} from "@/routes/v1/integrations/routes"

// Used for both the authorize URL and the token exchange — they must match.
const linearRedirectUri = () =>
  `${env.APP_BASE_URL}/integrations/linear/callback`

const attioRedirectUri = () => `${env.APP_BASE_URL}/integrations/attio/callback`

const notionRedirectUri = () =>
  `${env.APP_BASE_URL}/integrations/notion/callback`

// actor=app: actions are attributed to the Merlin app (and its app user costs
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
  // not requested on this URL. It must include all eleven scopes in
  // ATTIO_REQUIRED_READ_SCOPES (packages/merlin/src/providers/attio.ts) and no
  // read-write scopes; connectAttio enforces that exact policy after exchange.
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
  // on this URL. Configure only Read content, Read comments, and User
  // information without email addresses; the connector exposes no write tools.
  const params = new URLSearchParams({
    owner: "user",
    client_id: env.NOTION_CLIENT_ID,
    redirect_uri: notionRedirectUri(),
    response_type: "code",
    state,
  })
  return `https://api.notion.com/v1/oauth/authorize?${params.toString()}`
}

// The connect entry point per auth type. The `state` round-trips back to the
// callback/setup redirect: OAuth uses a short-lived signed state (CSRF-bound to
// the user + workspace); the GitHub App install carries the raw slug. null → the
// connector shows as Unavailable.
function connectUrlFor(
  descriptor: ConnectorDescriptor,
  ctx: { slug: string; userId: string }
): string | null {
  switch (descriptor.authType) {
    case "github-app":
      return env.GITHUB_APP_SLUG
        ? `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new?state=${ctx.slug}`
        : null
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
  }
}

export const listIntegrations: AppRouteHandler<ListIntegrationsRoute> = async (
  c
) => {
  const workspace = c.var.workspace
  const canManageNotion =
    workspace.ownerId === c.var.user.id || c.var.member.role === "admin"

  const connections = await db
    .select({
      id: integrationConnection.id,
      provider: integrationConnection.provider,
      accountLogin: integrationConnection.accountLogin,
      externalId: integrationConnection.externalId,
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
            connectionId: connectorTrigger.connectionId,
            event: connectorTrigger.event,
            channelId: connectorTrigger.channelId,
            post: connectorTrigger.post,
            remember: connectorTrigger.remember,
            rememberHint: connectorTrigger.rememberHint,
          })
          .from(connectorTrigger)
          .where(
            inArray(
              connectorTrigger.connectionId,
              connections.map((r) => r.id)
            )
          )
      : []
  const triggerByEvent = new Map(
    triggers.map((t) => [`${t.connectionId}:${t.event}`, t])
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
      let repos: { fullName: string; private: boolean }[] | null = null
      let repoCount: number | null = null
      let manageUrl: string | null = null
      if (descriptor.id === "github" && conn) {
        const overview = await getInstallationOverview(conn.externalId).catch(
          () => null
        )
        if (overview) {
          repoCount = overview.repos.length
          repos = overview.repos
            .slice(0, MAX_REPOS)
            .map((r) => ({ fullName: r.fullName, private: r.private }))
          manageUrl = overview.manageUrl
        }
      }
      const canManage = descriptor.id !== "notion" || canManageNotion
      const configuredUrl = connectUrlFor(descriptor, {
        slug: workspace.slug,
        userId: c.var.user.id,
      })
      return {
        id: descriptor.id,
        name: descriptor.label,
        description: descriptor.description,
        capabilities: connectorCapabilities(descriptor.id).map(
          (capability) => ({
            key: capability.key,
            label: capability.label,
            description: capability.description,
          })
        ),
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
        events: CONNECTOR_EVENTS[descriptor.id].map((e) => {
          const trigger = conn
            ? triggerByEvent.get(`${conn.id}:${e.key}`)
            : undefined
          return {
            key: e.key,
            label: e.label,
            channelId: trigger?.channelId ?? null,
            post: trigger?.post ?? true,
            remember: trigger?.remember ?? false,
            rememberHint: trigger?.rememberHint ?? null,
          }
        }),
      }
    })
  )

  return c.json({ providers }, HttpStatusCodes.OK)
}

export const connectGithub: AppRouteHandler<ConnectGithubRoute> = async (c) => {
  const workspace = c.var.workspace
  const { installationId } = c.req.valid("json")

  // Require a verifiable installation — don't persist fabricated ids or ones
  // the server can't actually reach (App not configured / invalid).
  const verified = await getSourceProvider("github")
    ?.verifyConnection({ externalId: installationId })
    .catch(() => null)
  if (!verified) {
    return c.json(
      { success: false, message: "Couldn't verify the GitHub installation" },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  const accountLogin = verified.accountLabel ?? null

  const ok = await db.transaction(async (tx) => {
    // Serialize concurrent connects for this workspace+provider so the
    // revoke-then-insert below can't interleave into multiple active rows.
    // The lock is held for the transaction and released on commit/rollback.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${workspace.id}:github`}, 0))`
    )

    // The installation is globally unique; don't let one workspace hijack an
    // installation already linked to another.
    const existing = await tx
      .select({ workspaceId: integrationConnection.workspaceId })
      .from(integrationConnection)
      .where(
        and(
          eq(integrationConnection.provider, "github"),
          eq(integrationConnection.externalId, installationId)
        )
      )
      .limit(1)
      .then((rows) => rows[0])
    if (existing && existing.workspaceId !== workspace.id) return false

    // One active GitHub connection per workspace: retire any others.
    await tx
      .update(integrationConnection)
      .set({ status: "revoked" })
      .where(
        and(
          eq(integrationConnection.workspaceId, workspace.id),
          eq(integrationConnection.provider, "github"),
          eq(integrationConnection.status, "active"),
          ne(integrationConnection.externalId, installationId)
        )
      )

    const written = await tx
      .insert(integrationConnection)
      .values({
        workspaceId: workspace.id,
        provider: "github",
        externalId: installationId,
        accountLogin,
        status: "active",
      })
      .onConflictDoUpdate({
        target: [
          integrationConnection.provider,
          integrationConnection.externalId,
        ],
        set: { workspaceId: workspace.id, accountLogin, status: "active" },
        // Guards the reassignment race the pre-check can't: only update a row
        // this workspace already owns.
        setWhere: eq(integrationConnection.workspaceId, workspace.id),
      })
      .returning({ id: integrationConnection.id })

    // setWhere blocked the update → the installation is owned elsewhere.
    return written.length > 0
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

  return c.json({ success: true as const, accountLogin }, HttpStatusCodes.OK)
}

type ConnectionWrite = Partial<typeof integrationConnection.$inferInsert>

// Shared connect transaction: serialize concurrent connects for this
// workspace+provider (advisory lock, held until commit/rollback), refuse an
// externalId owned by another workspace, retire this workspace's other active
// rows (wiping their secrets via clearOnRevoke), and upsert the new connection.
// Returns false when the externalId is connected elsewhere.
async function replaceActiveConnection(opts: {
  workspaceId: string
  provider: ConnectorDescriptor["id"]
  externalId: string
  clearOnRevoke: ConnectionWrite
  values: ConnectionWrite
  // Upsert set when it differs from the insert values (defaults to values).
  set?: ConnectionWrite
}): Promise<boolean> {
  const { workspaceId, provider, externalId } = opts
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${workspaceId}:${provider}`}, 0))`
    )

    const existing = await tx
      .select({ workspaceId: integrationConnection.workspaceId })
      .from(integrationConnection)
      .where(
        and(
          eq(integrationConnection.provider, provider),
          eq(integrationConnection.externalId, externalId)
        )
      )
      .limit(1)
      .then((rows) => rows[0])
    if (existing && existing.workspaceId !== workspaceId) return false

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
        ...opts.values,
      })
      .onConflictDoUpdate({
        target: [
          integrationConnection.provider,
          integrationConnection.externalId,
        ],
        // Guards the reassignment race the pre-check can't: only update a row
        // this workspace already owns.
        set: { workspaceId, status: "active", ...(opts.set ?? opts.values) },
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
} satisfies ConnectionWrite

export const connectLinear: AppRouteHandler<ConnectLinearRoute> = async (c) => {
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
    externalId: result.externalId,
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
    externalId: result.externalId,
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
    externalId: result.externalId,
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
  const workspace = c.var.workspace
  const { code, state } = c.req.valid("json")

  if (verifyOAuthState(state, c.var.user.id) !== workspace.slug) {
    return c.json(
      { success: false, message: "Invalid or expired connection request" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const result = await exchangeAttioCode(code, attioRedirectUri()).catch(
    () => null
  )
  if (!result) {
    return c.json(
      {
        success: false,
        message:
          "Couldn't connect Attio — verify the app has every required read scope and no read-write scopes",
      },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const ok = await replaceActiveConnection({
    workspaceId: workspace.id,
    provider: "attio",
    externalId: result.externalId,
    clearOnRevoke: OAUTH_TOKEN_WIPE,
    values: {
      accountLogin: result.accountLabel,
      accessToken: result.accessToken,
      tokenExpiresAt: result.tokenExpiresAt,
      scope: result.scope,
    },
    // Attio issues no refresh token; a reused row must not keep a stale one.
    set: {
      accountLogin: result.accountLabel,
      accessToken: result.accessToken,
      refreshToken: null,
      tokenExpiresAt: result.tokenExpiresAt,
      scope: result.scope,
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

  return c.json(
    { success: true as const, accountLogin: result.accountLabel },
    HttpStatusCodes.OK
  )
}

export const connectNotion: AppRouteHandler<ConnectNotionRoute> = async (c) => {
  const workspace = c.var.workspace
  const { code, state } = c.req.valid("json")

  if (!(workspace.ownerId === c.var.user.id || c.var.member.role === "admin")) {
    return c.json(
      { success: false, message: "Only workspace admins can connect Notion" },
      HttpStatusCodes.FORBIDDEN
    )
  }
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
    externalId: result.externalId,
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

export const updateIntegration: AppRouteHandler<
  UpdateIntegrationRoute
> = async (c) => {
  const workspace = c.var.workspace
  const { connectionId } = c.req.valid("param")
  const { event, channelId, post, remember, rememberHint } = c.req.valid("json")

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
  if (!connection) {
    return c.json(
      { success: false, message: "Connection not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  if (!isConnectorEvent(connection.provider, event)) {
    return c.json(
      { success: false, message: "Unknown event for this connector" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  if (channelId === null) {
    await db
      .delete(connectorTrigger)
      .where(
        and(
          eq(connectorTrigger.connectionId, connection.id),
          eq(connectorTrigger.event, event)
        )
      )
    return c.json({ success: true as const }, HttpStatusCodes.OK)
  }

  const target = await db
    .select({ id: channel.id })
    .from(channel)
    .where(
      and(
        eq(channel.id, channelId),
        eq(channel.workspaceId, workspace.id),
        eq(channel.type, "text")
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!target) {
    return c.json(
      { success: false, message: "Channel not found in this workspace" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  await db
    .insert(connectorTrigger)
    .values({
      connectionId: connection.id,
      event,
      channelId,
      post,
      remember,
      rememberHint,
    })
    .onConflictDoUpdate({
      target: [connectorTrigger.connectionId, connectorTrigger.event],
      set: { channelId, post, remember, rememberHint },
    })

  return c.json({ success: true as const }, HttpStatusCodes.OK)
}

export const disconnectIntegration: AppRouteHandler<
  DisconnectIntegrationRoute
> = async (c) => {
  const workspace = c.var.workspace
  const { connectionId } = c.req.valid("param")

  const connection = await db
    .select({ provider: integrationConnection.provider })
    .from(integrationConnection)
    .where(
      and(
        eq(integrationConnection.id, connectionId),
        eq(integrationConnection.workspaceId, workspace.id)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!connection) {
    return c.json(
      { success: false, message: "Connection not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  if (
    connection.provider === "notion" &&
    !(workspace.ownerId === c.var.user.id || c.var.member.role === "admin")
  ) {
    return c.json(
      {
        success: false,
        message: "Only workspace admins can disconnect Notion",
      },
      HttpStatusCodes.FORBIDDEN
    )
  }

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

  return c.json({ success: true as const }, HttpStatusCodes.OK)
}
