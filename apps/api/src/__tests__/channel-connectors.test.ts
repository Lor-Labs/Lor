import { CONNECTOR_TOOLS } from "@repo/connectors"
import { describe, expect, it } from "vitest"
import { attachableConnectors } from "@/lib/channel-connectors"

const allTools = Object.values(CONNECTOR_TOOLS).flatMap((tools) =>
  tools.map((tool) => tool.name)
)

const ids = (connectors: { id: string }[]) => connectors.map((c) => c.id)

describe("attachableConnectors", () => {
  it("returns nothing when the workspace has no connections", () => {
    expect(attachableConnectors(new Set(), allTools)).toEqual([])
  })

  it("excludes connectors the channel's profile doesn't grant", () => {
    const connected = new Set(["github", "linear"] as const)
    expect(ids(attachableConnectors(connected, ["search_linear"]))).toEqual([
      "linear",
    ])
  })

  it("grants file browsing through its clone tool", () => {
    const connected = new Set(["github"] as const)
    expect(ids(attachableConnectors(connected, ["clone_repo"]))).toEqual([
      "github",
    ])
  })

  it("flags only connectors whose files can be browsed", () => {
    const connected = new Set(["github", "linear"] as const)
    const byId = new Map(
      attachableConnectors(connected, allTools).map((c) => [
        c.id,
        c.supportsFiles,
      ])
    )
    expect(byId.get("github")).toBe(true)
    expect(byId.get("linear")).toBe(false)
  })

  it("excludes connectors with no attachable records", () => {
    const connected = new Set(["datadog"] as const)
    expect(attachableConnectors(connected, ["search_datadog_logs"])).toEqual([])
  })

  it("returns every connected, granted, searchable connector", () => {
    const connected = new Set([
      "github",
      "linear",
      "notion",
      "attio",
      "datadog",
    ] as const)
    expect(ids(attachableConnectors(connected, allTools))).toEqual([
      "github",
      "linear",
      "attio",
      "notion",
    ])
  })
})
