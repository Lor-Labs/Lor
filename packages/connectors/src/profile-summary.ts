import type { ProfileToolAccess } from "@repo/db/schema"
import type { ProfileToolGroup } from "./profile-tools"
import { CAPABILITIES, CONNECTORS } from "./registry"
import { CONNECTOR_TOOLS } from "./tools"

export function describeProfilePermissions(
  profile: {
    toolAccess: ProfileToolAccess
    capabilities: readonly string[]
    customTools: readonly { kind: string; id?: string; opPosition?: number }[]
  },
  groups: ProfileToolGroup[] = [],
  customTools: { id: string; name: string }[] = [],
  createdToolNames: ReadonlyMap<number, string> = new Map()
): string[] {
  const lines = [
    "Services without an override use workspace tools, including tools and services enabled later.",
  ]
  for (const [kind, selections] of [
    ["connector", profile.toolAccess.connectors],
    ["mcpServer", profile.toolAccess.mcpServers],
  ] as const) {
    for (const [id, selection] of Object.entries(selections)) {
      if (!selection) continue
      const group = groups.find((item) => item.kind === kind && item.id === id)
      const provider =
        kind === "connector" && Object.hasOwn(CONNECTORS, id)
          ? (id as keyof typeof CONNECTORS)
          : null
      const label =
        group?.name ??
        (provider ? CONNECTORS[provider].label : `MCP server ${id}`)
      const tools = provider ? CONNECTOR_TOOLS[provider] : (group?.tools ?? [])
      lines.push(
        `${label}: ${selection.mode === "off" ? "Off" : selection.mode === "workspace" ? "Use workspace tools (follows changes)" : selection.tools.length === 0 ? "No tools selected" : `Only ${selection.tools.map((name) => tools.find((tool) => tool.name === name)?.label ?? name).join(", ")}`}`
      )
    }
  }
  if (profile.capabilities.length > 0)
    lines.push(
      `Built-in and API tools: ${profile.capabilities.map((key) => (Object.hasOwn(CAPABILITIES, key) ? CAPABILITIES[key as keyof typeof CAPABILITIES].label : key)).join(", ")}`
    )
  if (
    profile.customTools.length > 0 &&
    !profile.capabilities.includes("custom_tools")
  )
    lines.push(
      `API tools: ${profile.customTools.map((ref) => (ref.kind === "created" ? (createdToolNames.get(ref.opPosition ?? -1) ?? `tool from step ${(ref.opPosition ?? 0) + 1}`) : (customTools.find((tool) => tool.id === ref.id)?.name ?? ref.id ?? "Unknown tool"))).join(", ")}`
    )
  return lines
}
