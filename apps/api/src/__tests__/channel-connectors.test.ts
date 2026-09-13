import { ALL_LOR_CAPABILITIES } from "@repo/db/schema"
import { describe, expect, it } from "vitest"
import { attachableConnectors } from "@/lib/channel-connectors"

const ids = (connectors: { id: string }[]) => connectors.map((c) => c.id)

describe("attachableConnectors", () => {
  it("returns nothing when the workspace has no connections", () => {
    expect(attachableConnectors(ALL_LOR_CAPABILITIES, new Set())).toEqual([])
  })

  it("excludes connectors the channel's profile doesn't grant", () => {
    const connected = new Set(["github", "linear"] as const)
    expect(ids(attachableConnectors(["linear"], connected))).toEqual(["linear"])
  })

  it("grants a connector from any one of its capabilities", () => {
    const connected = new Set(["github"] as const)
    expect(ids(attachableConnectors(["code_intelligence"], connected))).toEqual(
      ["github"]
    )
  })

  it("flags only connectors whose files can be browsed", () => {
    const connected = new Set(["github", "linear"] as const)
    const byId = new Map(
      attachableConnectors(ALL_LOR_CAPABILITIES, connected).map((c) => [
        c.id,
        c.supportsFiles,
      ])
    )
    expect(byId.get("github")).toBe(true)
    expect(byId.get("linear")).toBe(false)
  })

  it("excludes connectors with no attachable records", () => {
    const connected = new Set(["datadog"] as const)
    expect(attachableConnectors(["datadog"], connected)).toEqual([])
  })

  it("returns every connected, granted, searchable connector", () => {
    const connected = new Set([
      "github",
      "linear",
      "notion",
      "attio",
      "datadog",
    ] as const)
    expect(ids(attachableConnectors(ALL_LOR_CAPABILITIES, connected))).toEqual([
      "github",
      "linear",
      "attio",
      "notion",
    ])
  })
})
