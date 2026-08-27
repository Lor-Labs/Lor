import { describe, expect, it } from "vitest"
import { mcpServerGranted, mcpServerRuntimeEligible } from "./mcp-servers"

describe("MCP runtime eligibility", () => {
  it("allows configured static servers", () => {
    expect(
      mcpServerRuntimeEligible({
        authMode: "static",
        oauthStatus: null,
        oauthCredentials: null,
        enabledTools: ["search"],
      })
    ).toBe(true)
  })

  it("allows OAuth servers only after review with stored credentials", () => {
    expect(
      mcpServerRuntimeEligible({
        authMode: "oauth",
        oauthStatus: "connected",
        oauthCredentials: "encrypted-credentials",
        enabledTools: ["search"],
      })
    ).toBe(true)

    for (const oauthStatus of [
      "pending",
      "needs_tool_review",
      "reauthorization_required",
    ] as const) {
      expect(
        mcpServerRuntimeEligible({
          authMode: "oauth",
          oauthStatus,
          oauthCredentials: "encrypted-credentials",
          enabledTools: ["search"],
        })
      ).toBe(false)
    }
  })

  it("rejects servers without enabled tools or OAuth credentials", () => {
    expect(
      mcpServerRuntimeEligible({
        authMode: "static",
        oauthStatus: null,
        oauthCredentials: null,
        enabledTools: [],
      })
    ).toBe(false)
    expect(
      mcpServerRuntimeEligible({
        authMode: "oauth",
        oauthStatus: "connected",
        oauthCredentials: null,
        enabledTools: ["search"],
      })
    ).toBe(false)
  })
})

describe("MCP profile grants", () => {
  it("allows every server only for the explicit all grant", () => {
    expect(mcpServerGranted("server-a", "all")).toBe(true)
    expect(mcpServerGranted("server-b", "all")).toBe(true)
  })

  it("allows only IDs named by an explicit grant", () => {
    expect(mcpServerGranted("server-a", ["server-a"])).toBe(true)
    expect(mcpServerGranted("server-b", ["server-a"])).toBe(false)
  })
})
