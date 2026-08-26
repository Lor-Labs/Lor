import { toolServer, toolServerOAuthAttempt } from "@repo/db/schema"
import { getTableConfig } from "drizzle-orm/pg-core"
import { describe, expect, it } from "vitest"
import {
  createToolServerRequestSchema,
  toolServerSchema,
} from "@/routes/v1/tool-servers/schema"

describe("tool server OAuth API contract", () => {
  it("keeps existing creates on static authentication by default", () => {
    const result = createToolServerRequestSchema.parse({
      name: "Operations",
      url: "https://mcp.example.com/api",
      headers: { Authorization: "Bearer {{secrets.API_KEY}}" },
      secrets: { API_KEY: "secret" },
      enabledTools: ["find_record"],
    })

    expect(result.authMode).toBe("static")
    expect(result.enabledTools).toEqual(["find_record"])
  })

  it("accepts OAuth creates before tools are selected", () => {
    expect(
      createToolServerRequestSchema.safeParse({
        name: "Operations",
        url: "https://mcp.example.com/api",
        authMode: "oauth",
      }).success
    ).toBe(true)
  })

  it("rejects manual authorization headers and enabled tools in OAuth mode", () => {
    const authorizationHeader = createToolServerRequestSchema.safeParse({
      name: "Operations",
      url: "https://mcp.example.com/api",
      authMode: "oauth",
      headers: { aUtHoRiZaTiOn: "Bearer value" },
    })
    const enabledTools = createToolServerRequestSchema.safeParse({
      name: "Operations",
      url: "https://mcp.example.com/api",
      authMode: "oauth",
      enabledTools: ["find_record"],
    })

    expect(authorizationHeader.success).toBe(false)
    expect(enabledTools.success).toBe(false)
  })

  it("exposes status and audit provenance without credential material", () => {
    const result = toolServerSchema.parse({
      id: "server-id",
      name: "Operations",
      description: "Shared operational data",
      url: "https://mcp.example.com/api",
      authMode: "oauth",
      oauthStatus: "connected",
      oauthAuthorizedBy: { id: "user-id", name: "Ada" },
      oauthAuthorizedAt: "2026-01-01T00:00:00.000Z",
      oauthCredentials: "must-not-be-returned",
      headers: {},
      secretNames: [],
      enabledTools: ["find_record"],
      usedByProfiles: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    })

    expect(result.oauthStatus).toBe("connected")
    expect(result).not.toHaveProperty("oauthCredentials")
  })
})

describe("tool server OAuth database constraints", () => {
  it("defaults existing server rows to static mode and ties auth state together", () => {
    const config = getTableConfig(toolServer)
    const authMode = config.columns.find(
      (column) => column.name === "auth_mode"
    )

    expect(authMode?.notNull).toBe(true)
    expect(authMode?.default).toBe("static")
    expect(config.checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        "tool_server_auth_status_check",
        "tool_server_oauth_connected_credentials_check",
      ])
    )
  })

  it("requires bounded, single-use attempt state with one live attempt per server", () => {
    const config = getTableConfig(toolServerOAuthAttempt)
    const columns = new Map(
      config.columns.map((column) => [column.name, column.notNull])
    )
    const indexes = new Map(
      config.indexes.map((index) => [index.config.name, index.config])
    )

    expect(columns.get("expires_at")).toBe(true)
    expect(columns.get("state_hash")).toBe(true)
    expect(columns.get("encrypted_state")).toBe(true)
    expect(columns.get("encrypted_code_verifier")).toBe(true)
    expect(columns.get("consumed_at")).toBe(false)
    expect(config.checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        "tool_server_oauth_attempt_expiry_check",
        "tool_server_oauth_attempt_consumed_check",
      ])
    )
    expect(
      indexes.get("tool_server_oauth_attempt_state_hash_uidx")?.unique
    ).toBe(true)
    expect(
      indexes.get("tool_server_oauth_attempt_live_server_uidx")?.unique
    ).toBe(true)
    expect(
      indexes.get("tool_server_oauth_attempt_live_server_uidx")?.where
    ).toBeDefined()
  })
})
