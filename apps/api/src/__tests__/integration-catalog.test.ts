import { CONNECTOR_LIST, CONNECTOR_TOOLS } from "@repo/connectors"
import { describe, expect, it } from "vitest"
import { integrationStatusSchema } from "@/routes/v1/integrations/schema"

describe("integration catalog", () => {
  it("exposes valid descriptions and capabilities for every connector", () => {
    for (const connector of CONNECTOR_LIST) {
      const tools = CONNECTOR_TOOLS[connector.id]

      expect(connector.description).not.toHaveLength(0)
      expect(tools.length).toBeGreaterThan(0)
      expect(
        integrationStatusSchema.safeParse({
          id: connector.id,
          name: connector.label,
          description: connector.description,
          tools,
          enabledTools: [],
          connected: false,
          accountLogin: null,
          connectionId: null,
          authType: connector.authType,
          canManage: true,
          available: true,
          connectUrl: null,
          repos: null,
          repoCount: null,
          manageUrl: null,
          events: [],
        }).success
      ).toBe(true)
    }
  })
})
