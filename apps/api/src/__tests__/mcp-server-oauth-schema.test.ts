import {
  agentProfileMcpServer,
  mcpServer,
  mcpServerOAuthAttempt,
} from "@repo/db/schema"
import { getTableConfig } from "drizzle-orm/pg-core"
import { describe, expect, it } from "vitest"
import {
  completeMcpServerOAuth,
  disconnectMcpServerOAuth,
  listMcpServers,
  mcpServerOAuthCallback,
  rediscoverMcpServer,
  startMcpServerOAuth,
} from "@/routes/v1/mcp-servers/routes"
import {
  completeMcpServerOAuthRequestSchema,
  createMcpServerRequestSchema,
  mcpServerSchema,
  startMcpServerOAuthRequestSchema,
} from "@/routes/v1/mcp-servers/schema"

describe("MCP server OAuth API contract", () => {
  it("uses the explicit MCP server resource path", () => {
    expect(listMcpServers.path).toBe("/workspaces/{workspaceSlug}/mcp-servers")
    expect(rediscoverMcpServer.path).toBe(
      "/workspaces/{workspaceSlug}/mcp-servers/{mcpServerId}/discover"
    )
    expect(startMcpServerOAuth.path).toBe(
      "/workspaces/{workspaceSlug}/mcp-servers/{mcpServerId}/oauth/start"
    )
    expect(mcpServerOAuthCallback.path).toBe(
      "/workspaces/{workspaceSlug}/mcp-servers/oauth/callback"
    )
    expect(completeMcpServerOAuth.path).toBe(
      "/workspaces/{workspaceSlug}/mcp-servers/{mcpServerId}/oauth/complete"
    )
    expect(disconnectMcpServerOAuth.path).toBe(
      "/workspaces/{workspaceSlug}/mcp-servers/{mcpServerId}/oauth/disconnect"
    )
  })

  it("requires explicit shared-channel confirmation before OAuth starts", () => {
    expect(
      startMcpServerOAuthRequestSchema.safeParse({
        disclosureConfirmed: false,
      }).success
    ).toBe(false)
    expect(
      startMcpServerOAuthRequestSchema.safeParse({
        disclosureConfirmed: true,
      }).success
    ).toBe(true)
  })

  it("bounds the reviewed OAuth tool allowlist", () => {
    expect(
      completeMcpServerOAuthRequestSchema.parse({
        enabledTools: ["find_record"],
      }).enabledTools
    ).toEqual(["find_record"])
    expect(
      completeMcpServerOAuthRequestSchema.safeParse({
        enabledTools: Array.from(
          { length: 201 },
          (_, index) => `tool_${index}`
        ),
      }).success
    ).toBe(false)
  })

  it("keeps existing creates on static authentication by default", () => {
    const result = createMcpServerRequestSchema.parse({
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
      createMcpServerRequestSchema.safeParse({
        name: "Operations",
        url: "https://mcp.example.com/api",
        authMode: "oauth",
      }).success
    ).toBe(true)
  })

  it("rejects manual authorization headers and enabled tools in OAuth mode", () => {
    const authorizationHeader = createMcpServerRequestSchema.safeParse({
      name: "Operations",
      url: "https://mcp.example.com/api",
      authMode: "oauth",
      headers: { aUtHoRiZaTiOn: "Bearer value" },
    })
    const enabledTools = createMcpServerRequestSchema.safeParse({
      name: "Operations",
      url: "https://mcp.example.com/api",
      authMode: "oauth",
      enabledTools: ["find_record"],
    })

    expect(authorizationHeader.success).toBe(false)
    expect(enabledTools.success).toBe(false)
  })

  it("exposes status and audit provenance without credential material", () => {
    const result = mcpServerSchema.parse({
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

describe("MCP server OAuth database constraints", () => {
  it("uses explicit MCP server table and foreign-key names", () => {
    const serverConfig = getTableConfig(mcpServer)
    const attemptConfig = getTableConfig(mcpServerOAuthAttempt)
    const grantConfig = getTableConfig(agentProfileMcpServer)

    expect(serverConfig.name).toBe("mcp_server")
    expect(attemptConfig.name).toBe("mcp_server_oauth_attempt")
    expect(grantConfig.name).toBe("agent_profile_mcp_server")
    expect(attemptConfig.columns.map((column) => column.name)).toContain(
      "mcp_server_id"
    )
    expect(grantConfig.columns.map((column) => column.name)).toContain(
      "mcp_server_id"
    )
  })

  it("defaults existing server rows to static mode and ties auth state together", () => {
    const config = getTableConfig(mcpServer)
    const authMode = config.columns.find(
      (column) => column.name === "auth_mode"
    )

    expect(authMode?.notNull).toBe(true)
    expect(authMode?.default).toBe("static")
    expect(config.checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        "mcp_server_auth_status_check",
        "mcp_server_oauth_connected_credentials_check",
      ])
    )
  })

  it("requires bounded, single-use attempt state with one live attempt per server", () => {
    const config = getTableConfig(mcpServerOAuthAttempt)
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
        "mcp_server_oauth_attempt_expiry_check",
        "mcp_server_oauth_attempt_consumed_check",
      ])
    )
    expect(
      indexes.get("mcp_server_oauth_attempt_state_hash_uidx")?.unique
    ).toBe(true)
    expect(
      indexes.get("mcp_server_oauth_attempt_live_server_uidx")?.unique
    ).toBe(true)
    expect(
      indexes.get("mcp_server_oauth_attempt_live_server_uidx")?.where
    ).toBeDefined()
  })
})
