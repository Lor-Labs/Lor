import type {
  OAuthAuthorizationServerInformation,
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthTokens,
} from "@ai-sdk/mcp"
import { auth, createMCPClient } from "@ai-sdk/mcp"
import type { McpServer, McpServerOAuthAttempt } from "@repo/db/schema"
import { decryptSecret, encryptSecret } from "@repo/utils/crypto"
import type { GuardedMcpFetch } from "./mcp-guarded-fetch"
import {
  decryptMcpOAuthCredentials,
  encryptMcpOAuthCredentials,
  hashMcpOAuthState,
  type McpOAuthCredentialEnvelope,
} from "./mcp-server-oauth"

export class McpOAuthInteractionRequiredError extends Error {
  constructor() {
    super("MCP OAuth interaction is required")
    this.name = "McpOAuthInteractionRequiredError"
  }
}

export class McpOAuthTransientError extends Error {
  constructor() {
    super("MCP OAuth token refresh failed temporarily")
    this.name = "McpOAuthTransientError"
  }
}

type ServerSnapshot = Pick<
  McpServer,
  "id" | "workspaceId" | "url" | "oauthCredentials"
>

type AttemptSnapshot = Pick<
  McpServerOAuthAttempt,
  "id" | "stateHash" | "encryptedState" | "encryptedCodeVerifier"
>

type ProviderMode = "start" | "callback" | "noninteractive"

type CredentialScope = "all" | "client" | "tokens" | "verifier"

export type McpOAuthProviderOptions = {
  mode: ProviderMode
  server: ServerSnapshot
  attempt?: AttemptSnapshot
  encryptionKey: string
  redirectUrl: string
  guardedFetch: GuardedMcpFetch
  saveCredentials: (encryptedCredentials: string | null) => void | Promise<void>
  saveAttemptState?: (input: {
    stateHash: string
    encryptedState: string
  }) => void | Promise<void>
  saveAttemptCodeVerifier?: (
    encryptedCodeVerifier: string
  ) => void | Promise<void>
  onInteractionRequired?: () => void | Promise<void>
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T
}

function hasCredentialMaterial(
  credentials: McpOAuthCredentialEnvelope | undefined
): credentials is McpOAuthCredentialEnvelope {
  return Boolean(
    credentials?.tokens ||
      credentials?.clientInformation ||
      credentials?.authorizationServerInformation
  )
}

export class DurableMcpOAuthProvider implements OAuthClientProvider {
  readonly #mode: ProviderMode
  readonly #encryptionKey: string
  readonly #redirectUrl: string
  readonly #guardedFetch: GuardedMcpFetch
  readonly #saveCredentials: McpOAuthProviderOptions["saveCredentials"]
  readonly #saveAttemptState?: McpOAuthProviderOptions["saveAttemptState"]
  readonly #saveAttemptCodeVerifier?: McpOAuthProviderOptions["saveAttemptCodeVerifier"]
  readonly #onInteractionRequired?: McpOAuthProviderOptions["onInteractionRequired"]
  #credentials?: McpOAuthCredentialEnvelope
  #state?: string
  #codeVerifier?: string
  #authorizationUrl?: URL

  constructor(options: McpOAuthProviderOptions) {
    this.#mode = options.mode
    this.#encryptionKey = options.encryptionKey
    this.#redirectUrl = options.redirectUrl
    this.#guardedFetch = options.guardedFetch
    this.#saveCredentials = options.saveCredentials
    this.#saveAttemptState = options.saveAttemptState
    this.#saveAttemptCodeVerifier = options.saveAttemptCodeVerifier
    this.#onInteractionRequired = options.onInteractionRequired
    this.#credentials = options.server.oauthCredentials
      ? decryptMcpOAuthCredentials(
          options.server.oauthCredentials,
          options.encryptionKey
        )
      : undefined
    if (options.attempt) {
      this.#state = decryptSecret(
        options.attempt.encryptedState,
        options.encryptionKey
      )
      const verifier = decryptSecret(
        options.attempt.encryptedCodeVerifier,
        options.encryptionKey
      )
      this.#codeVerifier = verifier === "pending" ? undefined : verifier
    }
  }

  get redirectUrl(): string {
    return this.#redirectUrl
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.#redirectUrl],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "Lor",
    }
  }

  get authorizationUrl(): URL | undefined {
    return this.#authorizationUrl
  }

  async #persistCredentials(): Promise<void> {
    const encrypted = hasCredentialMaterial(this.#credentials)
      ? encryptMcpOAuthCredentials(this.#credentials, this.#encryptionKey)
      : null
    await this.#saveCredentials(encrypted)
  }

  tokens(): OAuthTokens | undefined {
    if (this.#mode === "start") return undefined
    return this.#credentials?.tokens
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    this.#credentials = {
      version: 1,
      ...this.#credentials,
      tokens: withoutUndefined(tokens),
    }
    await this.#persistCredentials()
  }

  clientInformation(): OAuthClientInformation | undefined {
    return this.#credentials?.clientInformation
  }

  async saveClientInformation(
    clientInformation: OAuthClientInformation
  ): Promise<void> {
    if (
      this.#mode === "noninteractive" &&
      !this.#credentials?.clientInformation
    ) {
      await this.#onInteractionRequired?.()
      throw new McpOAuthInteractionRequiredError()
    }
    this.#credentials = {
      version: 1,
      ...this.#credentials,
      clientInformation: withoutUndefined(clientInformation),
    }
    await this.#persistCredentials()
  }

  authorizationServerInformation():
    | OAuthAuthorizationServerInformation
    | undefined {
    return this.#credentials?.authorizationServerInformation
  }

  async saveAuthorizationServerInformation(
    authorizationServerInformation: OAuthAuthorizationServerInformation
  ): Promise<void> {
    await Promise.all([
      this.#guardedFetch.validateUrl(
        authorizationServerInformation.authorizationServerUrl
      ),
      this.#guardedFetch.validateUrl(
        authorizationServerInformation.tokenEndpoint
      ),
    ])
    this.#credentials = {
      version: 1,
      ...this.#credentials,
      authorizationServerInformation,
    }
    await this.#persistCredentials()
  }

  async validateAuthorizationServerURL(
    _serverUrl: string | URL,
    authorizationServerUrl: string | URL
  ): Promise<void> {
    await this.#guardedFetch.validateUrl(authorizationServerUrl)
  }

  async validateResourceURL(
    serverUrl: string | URL,
    resource?: string
  ): Promise<URL> {
    const configured = new URL(serverUrl)
    const requested = resource ? new URL(resource) : configured
    await this.#guardedFetch.validateUrl(requested)
    const configuredPath = configured.pathname.endsWith("/")
      ? configured.pathname
      : `${configured.pathname}/`
    const requestedPath = requested.pathname.endsWith("/")
      ? requested.pathname
      : `${requested.pathname}/`
    if (
      requested.origin !== configured.origin ||
      !configuredPath.startsWith(requestedPath)
    ) {
      throw new Error("OAuth resource does not match the configured MCP server")
    }
    return requested
  }

  state(): string {
    if (!this.#state) throw new Error("OAuth state is unavailable")
    return this.#state
  }

  async saveState(state: string): Promise<void> {
    if (this.#state && this.#state !== state) {
      throw new Error("OAuth state changed during authorization")
    }
    this.#state = state
    await this.#saveAttemptState?.({
      stateHash: hashMcpOAuthState(state),
      encryptedState: encryptSecret(state, this.#encryptionKey),
    })
  }

  storedState(): string | undefined {
    return this.#state
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    this.#codeVerifier = codeVerifier
    await this.#saveAttemptCodeVerifier?.(
      encryptSecret(codeVerifier, this.#encryptionKey)
    )
  }

  codeVerifier(): string {
    if (!this.#codeVerifier)
      throw new Error("OAuth PKCE verifier is unavailable")
    return this.#codeVerifier
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (this.#mode !== "start") {
      if (this.#credentials?.tokens?.refresh_token) {
        throw new McpOAuthTransientError()
      }
      await this.#onInteractionRequired?.()
      throw new McpOAuthInteractionRequiredError()
    }
    await this.#guardedFetch.validateUrl(authorizationUrl)
    this.#authorizationUrl = authorizationUrl
  }

  async invalidateCredentials(scope: CredentialScope): Promise<void> {
    if (scope === "verifier") {
      this.#codeVerifier = undefined
      return
    }
    if (scope === "all") {
      this.#credentials = undefined
    } else if (scope === "tokens" && this.#credentials) {
      const { tokens: _tokens, ...remaining } = this.#credentials
      this.#credentials = remaining
    } else if (scope === "client" && this.#credentials) {
      const { clientInformation: _client, ...remaining } = this.#credentials
      this.#credentials = remaining
    }
    await this.#persistCredentials()
  }
}

export async function startMcpOAuthAuthorization(input: {
  provider: DurableMcpOAuthProvider
  serverUrl: string
  guardedFetch: GuardedMcpFetch
}): Promise<string> {
  const result = await auth(input.provider, {
    serverUrl: input.serverUrl,
    fetchFn: input.guardedFetch,
  })
  const authorizationUrl = input.provider.authorizationUrl
  if (result !== "REDIRECT" || !authorizationUrl) {
    throw new Error("OAuth server did not begin interactive authorization")
  }
  return authorizationUrl.href
}

export async function exchangeMcpOAuthAuthorization(input: {
  provider: DurableMcpOAuthProvider
  serverUrl: string
  authorizationCode: string
  callbackState: string
  guardedFetch: GuardedMcpFetch
}): Promise<void> {
  const result = await auth(input.provider, {
    serverUrl: input.serverUrl,
    authorizationCode: input.authorizationCode,
    callbackState: input.callbackState,
    fetchFn: input.guardedFetch,
  })
  if (result !== "AUTHORIZED") {
    throw new Error("OAuth authorization did not complete")
  }
}

export async function discoverAuthorizedMcpTools(input: {
  provider: DurableMcpOAuthProvider
  serverUrl: string
  headers: Record<string, string>
  guardedFetch: GuardedMcpFetch
}): Promise<{ name: string; description: string; readOnlyHint?: boolean }[]> {
  const client = await createMCPClient({
    transport: {
      type: "http",
      url: input.serverUrl,
      headers: input.headers,
      authProvider: input.provider,
      fetch: input.guardedFetch,
      redirect: "error",
    },
  })
  try {
    const definitions = await client.listTools()
    return definitions.tools
      .map((tool) => ({
        name: tool.name,
        description: tool.description?.slice(0, 1000) ?? "",
        readOnlyHint:
          typeof tool.annotations?.readOnlyHint === "boolean"
            ? tool.annotations.readOnlyHint
            : undefined,
      }))
      .sort((left, right) => left.name.localeCompare(right.name))
  } finally {
    await client.close().catch(() => {})
  }
}
