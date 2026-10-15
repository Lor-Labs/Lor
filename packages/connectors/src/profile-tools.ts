import type { ProfileToolAccess, ProfileToolSelection } from "@repo/db/schema"

export function profileSelectedTools(
  workspaceTools: readonly string[],
  selection: ProfileToolSelection | undefined
): string[] {
  if (selection?.mode === "off") return []
  if (!selection || selection.mode === "workspace")
    return [...new Set(workspaceTools)]
  const selected = new Set(selection.tools)
  return [...new Set(workspaceTools)].filter((name) => selected.has(name))
}

export type ProfileToolGroup = {
  kind: "connector" | "mcpServer"
  id: string
  name: string
  description: string
  tools: {
    name: string
    label: string
    description: string
    readOnlyHint?: boolean
  }[]
}

export const PROFILE_TOOL_MODES = [
  { value: "workspace", label: "Use workspace tools" },
  { value: "off", label: "Off" },
  { value: "custom", label: "Choose tools" },
] as const

export function profileGroupSelection(
  access: ProfileToolAccess,
  group: Pick<ProfileToolGroup, "kind" | "id">
): ProfileToolSelection | undefined {
  return group.kind === "connector"
    ? access.connectors[group.id as keyof ProfileToolAccess["connectors"]]
    : access.mcpServers[group.id]
}

export function setProfileGroupSelection(
  access: ProfileToolAccess,
  group: Pick<ProfileToolGroup, "kind" | "id">,
  selection: ProfileToolSelection
): ProfileToolAccess {
  const key = group.kind === "connector" ? "connectors" : "mcpServers"
  return { ...access, [key]: { ...access[key], [group.id]: selection } }
}

export function profileGroupSummary(
  group: ProfileToolGroup,
  selection: ProfileToolSelection | undefined
): string {
  if (selection?.mode === "off") return "Off"
  const count = profileSelectedTools(
    group.tools.map((tool) => tool.name),
    selection
  ).length
  if (selection?.mode === "custom")
    return `${count} of ${group.tools.length} tools selected`
  if (count === 0) return "No tools turned on"
  return count === 1 ? "1 tool" : `All ${count} tools`
}

// Used only after an explicit editor action; never silently drop saved restrictions.
export function removeUnavailableProfileSelections(
  access: ProfileToolAccess,
  groups: ProfileToolGroup[]
): ProfileToolAccess {
  const result: ProfileToolAccess = { connectors: {}, mcpServers: {} }
  for (const [key, kind] of [
    ["connectors", "connector"],
    ["mcpServers", "mcpServer"],
  ] as const) {
    for (const [id, selection] of Object.entries(access[key])) {
      const group = groups.find((item) => item.kind === kind && item.id === id)
      if (!group || !selection) continue
      Object.assign(result[key], {
        [id]:
          selection.mode === "custom"
            ? {
                mode: "custom",
                tools: profileSelectedTools(
                  group.tools.map((tool) => tool.name),
                  selection
                ),
              }
            : selection,
      })
    }
  }
  return result
}

export function hasUnavailableProfileSelections(
  access: ProfileToolAccess,
  groups: ProfileToolGroup[]
): boolean {
  return (
    [
      ["connectors", "connector"],
      ["mcpServers", "mcpServer"],
    ] as const
  ).some(([key, kind]) =>
    Object.entries(access[key]).some(([id, selection]) => {
      const group = groups.find((item) => item.kind === kind && item.id === id)
      return (
        !group ||
        (selection?.mode === "custom" &&
          selection.tools.some(
            (name) => !group.tools.some((tool) => tool.name === name)
          ))
      )
    })
  )
}
