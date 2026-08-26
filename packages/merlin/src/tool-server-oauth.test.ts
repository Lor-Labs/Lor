import { encryptSecret } from "@repo/utils/crypto"
import { describe, expect, it } from "vitest"
import {
  canTransitionToolServerOAuthStatus,
  createMcpOAuthState,
  decryptMcpOAuthCredentials,
  encryptMcpOAuthCredentials,
  hashMcpOAuthState,
  initialToolServerOAuthStatus,
  MCP_OAUTH_ATTEMPT_TTL_MS,
  mcpOAuthAttemptExpiresAt,
  validateMcpOAuthAttempt,
} from "./tool-server-oauth"

const KEY = "11".repeat(32)

describe("MCP OAuth credential envelope", () => {
  it("encrypts and decrypts the versioned credential set", () => {
    const credentials = {
      version: 1 as const,
      tokens: {
        access_token: "access-value",
        token_type: "Bearer",
        refresh_token: "refresh-value",
        expires_in: 3600,
      },
      clientInformation: {
        client_id: "client-id",
        client_secret: "client-secret",
      },
      authorizationServerInformation: {
        authorizationServerUrl: "https://auth.example.com",
        tokenEndpoint: "https://auth.example.com/token",
      },
    }

    const encrypted = encryptMcpOAuthCredentials(credentials, KEY)

    expect(encrypted).not.toContain("access-value")
    expect(encrypted).not.toContain("refresh-value")
    expect(encrypted).not.toContain("client-secret")
    expect(decryptMcpOAuthCredentials(encrypted, KEY)).toEqual(credentials)
  })

  it("rejects malformed or unsupported decrypted envelopes", () => {
    const unsupported = encryptSecret(
      JSON.stringify({ version: 2, tokens: { access_token: "x" } }),
      KEY
    )
    const empty = encryptSecret(JSON.stringify({ version: 1 }), KEY)

    expect(() => decryptMcpOAuthCredentials("not-ciphertext", KEY)).toThrow(
      "Malformed MCP OAuth credential envelope"
    )
    expect(() => decryptMcpOAuthCredentials(unsupported, KEY)).toThrow(
      "Malformed MCP OAuth credential envelope"
    )
    expect(() => decryptMcpOAuthCredentials(empty, KEY)).toThrow(
      "Malformed MCP OAuth credential envelope"
    )
  })
})

describe("MCP OAuth attempts", () => {
  it("creates unpredictable state and a stable lookup hash", () => {
    const first = createMcpOAuthState()
    const second = createMcpOAuthState()

    expect(first).not.toBe(second)
    expect(Buffer.from(first, "base64url")).toHaveLength(32)
    expect(hashMcpOAuthState(first)).toBe(hashMcpOAuthState(first))
    expect(hashMcpOAuthState(first)).not.toBe(hashMcpOAuthState(second))
  })

  it("uses the bounded attempt lifetime", () => {
    const now = new Date("2026-01-01T00:00:00.000Z")
    expect(mcpOAuthAttemptExpiresAt(now).getTime() - now.getTime()).toBe(
      MCP_OAUTH_ATTEMPT_TTL_MS
    )
  })

  it("accepts a matching live attempt", () => {
    const state = "callback-state"
    expect(
      validateMcpOAuthAttempt(
        {
          stateHash: hashMcpOAuthState(state),
          expiresAt: new Date("2026-01-01T00:10:00.000Z"),
          consumedAt: null,
        },
        state,
        new Date("2026-01-01T00:09:59.999Z")
      )
    ).toEqual({ ok: true })
  })

  it("rejects state mismatch, expiry, and replay", () => {
    const now = new Date("2026-01-01T00:10:00.000Z")
    const liveAttempt = {
      stateHash: hashMcpOAuthState("expected-state"),
      expiresAt: new Date("2026-01-01T00:11:00.000Z"),
      consumedAt: null,
    }

    expect(validateMcpOAuthAttempt(liveAttempt, "wrong-state", now)).toEqual({
      ok: false,
      reason: "state_mismatch",
    })
    expect(
      validateMcpOAuthAttempt(
        { ...liveAttempt, expiresAt: now },
        "expected-state",
        now
      )
    ).toEqual({ ok: false, reason: "expired" })
    expect(
      validateMcpOAuthAttempt(
        {
          ...liveAttempt,
          consumedAt: new Date("2026-01-01T00:09:00.000Z"),
        },
        "expected-state",
        now
      )
    ).toEqual({ ok: false, reason: "consumed" })
  })
})

describe("MCP OAuth lifecycle", () => {
  it("sets an initial status only for OAuth servers", () => {
    expect(initialToolServerOAuthStatus("static")).toBeNull()
    expect(initialToolServerOAuthStatus("oauth")).toBe("pending")
  })

  it("allows only explicit lifecycle transitions", () => {
    expect(canTransitionToolServerOAuthStatus(null, "pending")).toBe(true)
    expect(
      canTransitionToolServerOAuthStatus("pending", "needs_tool_review")
    ).toBe(true)
    expect(canTransitionToolServerOAuthStatus("pending", "connected")).toBe(
      false
    )
    expect(
      canTransitionToolServerOAuthStatus("needs_tool_review", "connected")
    ).toBe(true)
    expect(
      canTransitionToolServerOAuthStatus(
        "connected",
        "reauthorization_required"
      )
    ).toBe(true)
    expect(
      canTransitionToolServerOAuthStatus(
        "reauthorization_required",
        "connected"
      )
    ).toBe(false)
    expect(
      canTransitionToolServerOAuthStatus("reauthorization_required", "pending")
    ).toBe(true)
  })
})
