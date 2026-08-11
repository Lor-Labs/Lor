import { CONNECTOR_LIST, connectorCapabilities } from "@repo/connectors"
import { describe, expect, it } from "vitest"
import { integrationStatusSchema } from "@/routes/v1/integrations/schema"

describe("integration catalog", () => {
  it("exposes valid descriptions and capabilities for every connector", () => {
    for (const connector of CONNECTOR_LIST) {
      const capabilities = connectorCapabilities(connector.id).map(
        (capability) => ({
          key: capability.key,
          label: capability.label,
          description: capability.description,
        })
      )

      expect(connector.description).not.toHaveLength(0)
      expect(capabilities.length).toBeGreaterThan(0)
      expect(
        integrationStatusSchema.safeParse({
          id: connector.id,
          name: connector.label,
          description: connector.description,
          capabilities,
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
