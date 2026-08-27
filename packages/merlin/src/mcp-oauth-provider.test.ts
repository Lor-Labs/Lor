import type { OAuthTokens } from "@ai-sdk/mcp"
import { encryptSecret } from "@repo/utils/crypto"
import { describe, expect, it, vi } from "vitest"
import { createGuardedMcpFetch } from "./mcp-guarded-fetch"
import {
  DurableMcpOAuthProvider,
  McpOAuthInteractionRequiredError,
  McpOAuthTransientError,
} from "./mcp-oauth-provider"
import {
  decryptMcpOAuthCredentials,
  encryptMcpOAuthCredentials,
  hashMcpOAuthState,
} from "./mcp-server-oauth"

const KEY = "1".repeat(64)
const STATE = "state-value"
const SERVER = {
  id: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000002",
  url: "https://mcp.example.com/api/mcp",
  oauthCredentials: null,
}
const ATTEMPT = {
  id: "00000000-0000-4000-8000-000000000003",
  stateHash: hashMcpOAuthState(STATE),
  encryptedState: encryptSecret(STATE, KEY),
  encryptedCodeVerifier: encryptSecret("pending", KEY),
}

function guard() {
  return createGuardedMcpFetch({
    resourceUrl: SERVER.url,
    production: true,
    resolveAddresses: async () => [{ address: "93.184.216.34" }],
    fetchImpl: async () => new Response("ok"),
  })
}

function provider(
  overrides: Partial<
    ConstructorParameters<typeof DurableMcpOAuthProvider>[0]
  > = {}
) {
  const saved: Array<string | null> = []
  const interaction = vi.fn()
  const instance = new DurableMcpOAuthProvider({
    mode: "start",
    server: SERVER,
    attempt: ATTEMPT,
    encryptionKey: KEY,
    redirectUrl:
      "https://api.lor.test/v1/workspaces/acme/mcp-servers/oauth/callback",
    guardedFetch: guard(),
    saveCredentials: (value) => {
      saved.push(value)
    },
    onInteractionRequired: interaction,
    ...overrides,
  })
  return { instance, saved, interaction }
}

describe("durable MCP OAuth provider", () => {
  it("persists client and token material only as an encrypted envelope", async () => {
    const { instance, saved } = provider()
    await instance.saveClientInformation({
      client_id: "client-id",
      client_secret: "client-secret",
    })
    await instance.saveTokens({
      access_token: "access-token",
      refresh_token: "refresh-token",
      token_type: "Bearer",
    })

    expect(saved).toHaveLength(2)
    expect(saved.at(-1)).not.toContain("access-token")
    expect(saved.at(-1)).not.toContain("client-secret")
    const encrypted = saved.at(-1)
    expect(encrypted).toBeTypeOf("string")
    expect(decryptMcpOAuthCredentials(encrypted as string, KEY)).toMatchObject({
      clientInformation: { client_id: "client-id" },
      tokens: { access_token: "access-token" },
    })
  })

  it("persists and validates state and PKCE verifier", async () => {
    const saveAttemptState = vi.fn()
    const saveAttemptCodeVerifier = vi.fn()
    const { instance } = provider({
      saveAttemptState,
      saveAttemptCodeVerifier,
    })
    expect(instance.state()).toBe(STATE)
    await instance.saveState(STATE)
    await instance.saveCodeVerifier("verifier-value")
    expect(instance.codeVerifier()).toBe("verifier-value")
    expect(saveAttemptState).toHaveBeenCalledWith(
      expect.objectContaining({ stateHash: hashMcpOAuthState(STATE) })
    )
    expect(saveAttemptCodeVerifier).toHaveBeenCalledOnce()
    await expect(instance.saveState("changed-state")).rejects.toThrow(
      "state changed"
    )
  })

  it("captures a validated authorization URL only in interactive mode", async () => {
    const { instance } = provider()
    const url = new URL("https://login.example.com/authorize?state=value")
    await instance.redirectToAuthorization(url)
    expect(instance.authorizationUrl).toEqual(url)
  })

  it("accepts only protected resources that contain the configured MCP path", async () => {
    const { instance } = provider()
    await expect(
      instance.validateResourceURL(SERVER.url, "https://mcp.example.com/")
    ).resolves.toEqual(new URL("https://mcp.example.com/"))
    await expect(
      instance.validateResourceURL(
        SERVER.url,
        "https://mcp.example.com/different"
      )
    ).rejects.toThrow("does not match")
    await expect(
      instance.validateResourceURL(
        SERVER.url,
        "https://other.example.com/api/mcp"
      )
    ).rejects.toThrow("does not match")
  })

  it("keeps credentials on a transient refresh failure", async () => {
    const tokens: OAuthTokens = {
      access_token: "expired",
      refresh_token: "refresh-token",
      token_type: "Bearer",
    }
    const encrypted = encryptMcpOAuthCredentials({ version: 1, tokens }, KEY)
    const { instance, interaction } = provider({
      mode: "noninteractive",
      server: { ...SERVER, oauthCredentials: encrypted },
    })
    await expect(
      instance.redirectToAuthorization(
        new URL("https://login.example.com/authorize")
      )
    ).rejects.toBeInstanceOf(McpOAuthTransientError)
    expect(interaction).not.toHaveBeenCalled()
  })

  it("fails closed and requests reauthorization after terminal invalidation", async () => {
    const encrypted = encryptMcpOAuthCredentials(
      {
        version: 1,
        tokens: {
          access_token: "expired",
          refresh_token: "revoked",
          token_type: "Bearer",
        },
      },
      KEY
    )
    const { instance, interaction, saved } = provider({
      mode: "noninteractive",
      server: { ...SERVER, oauthCredentials: encrypted },
    })
    await instance.invalidateCredentials("tokens")
    await expect(
      instance.redirectToAuthorization(
        new URL("https://login.example.com/authorize")
      )
    ).rejects.toBeInstanceOf(McpOAuthInteractionRequiredError)
    expect(saved.at(-1)).toBeNull()
    expect(interaction).toHaveBeenCalledOnce()
  })

  it("never performs dynamic client registration in a background flow", async () => {
    const { instance, interaction } = provider({ mode: "noninteractive" })
    await expect(
      instance.saveClientInformation({ client_id: "replacement-client" })
    ).rejects.toBeInstanceOf(McpOAuthInteractionRequiredError)
    expect(interaction).toHaveBeenCalledOnce()
  })
})
