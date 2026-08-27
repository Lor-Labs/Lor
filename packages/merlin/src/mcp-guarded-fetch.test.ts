import { describe, expect, it, vi } from "vitest"
import {
  createGuardedMcpFetch,
  isBlockedMcpAddress,
  McpNetworkPolicyError,
} from "./mcp-guarded-fetch"

const publicResolver = async () => [{ address: "93.184.216.34" }]

function guarded(
  overrides: Partial<Parameters<typeof createGuardedMcpFetch>[0]> = {}
) {
  return createGuardedMcpFetch({
    resourceUrl: "https://mcp.example.com/api/mcp",
    production: true,
    resolveAddresses: publicResolver,
    fetchImpl: async () => new Response("ok"),
    ...overrides,
  })
}

describe("MCP guarded fetch URL policy", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "100.64.0.1",
    "169.254.1.1",
    "172.31.0.1",
    "192.168.1.1",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])("blocks non-public address %s", (address) => {
    expect(isBlockedMcpAddress(address)).toBe(true)
  })

  it.each([
    "http://mcp.example.com/api/mcp",
    "https://user:pass@mcp.example.com/api/mcp",
    "https://localhost/api/mcp",
    "https://service/api/mcp",
    "https://127.0.0.1/api/mcp",
  ])("rejects unsafe endpoint %s", async (url) => {
    await expect(guarded().validateUrl(url)).rejects.toBeInstanceOf(
      McpNetworkPolicyError
    )
  })

  it("rejects public names that resolve privately", async () => {
    const fetch = guarded({
      resolveAddresses: async () => [{ address: "10.1.2.3" }],
    })
    await expect(fetch("https://mcp.example.com/api/mcp")).rejects.toThrow(
      "does not resolve to a public address"
    )
  })

  it("allows HTTP only outside production while retaining hostname checks", async () => {
    const fetch = guarded({
      resourceUrl: "http://mcp.example.com/api/mcp",
      production: false,
    })
    await expect(
      fetch("http://mcp.example.com/api/mcp")
    ).resolves.toBeInstanceOf(Response)
    await expect(fetch.validateUrl("http://localhost/api/mcp")).rejects.toThrow(
      "not publicly routable"
    )
  })
})

describe("MCP guarded fetch credential and response policy", () => {
  it("never follows redirects", async () => {
    const fetch = guarded({
      fetchImpl: async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://other.example.com/next" },
        }),
    })
    await expect(fetch("https://mcp.example.com/api/mcp")).rejects.toThrow(
      "redirects are not allowed"
    )
  })

  it("rejects bearer credentials outside the MCP resource origin", async () => {
    await expect(
      guarded()("https://auth.example.com/token", {
        headers: { authorization: "Bearer secret" },
      })
    ).rejects.toThrow("bearer credentials cannot cross origins")
  })

  it("rejects configured MCP headers outside the resource origin", async () => {
    await expect(
      guarded({ sensitiveHeaderNames: ["X-Workspace-Key"] })(
        "https://auth.example.com/metadata",
        { headers: { "X-Workspace-Key": "secret" } }
      )
    ).rejects.toThrow("MCP server headers cannot cross origins")
  })

  it("caps declared and streamed response sizes", async () => {
    await expect(
      guarded({
        maxResponseBytes: 3,
        fetchImpl: async () =>
          new Response("large", { headers: { "content-length": "5" } }),
      })("https://mcp.example.com/api/mcp")
    ).rejects.toThrow("response is too large")

    const streamed = guarded({
      maxResponseBytes: 3,
      fetchImpl: async () => new Response("large"),
    })
    const response = await streamed("https://mcp.example.com/api/mcp")
    await expect(response.text()).rejects.toThrow("response is too large")
  })

  it("revalidates DNS for every request", async () => {
    const resolveAddresses = vi
      .fn()
      .mockResolvedValue([{ address: "93.184.216.34" }])
    const fetch = guarded({ resolveAddresses })
    await fetch("https://mcp.example.com/api/mcp")
    await fetch("https://mcp.example.com/api/mcp")
    expect(resolveAddresses).toHaveBeenCalledTimes(2)
  })
})
