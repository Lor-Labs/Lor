import type {
  BuiltinToolGroup,
  ProfileToolAccess,
  ProfileToolSelection,
} from "@repo/db/schema"

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

export type ProfileToolGroupKind =
  | "builtin"
  | "connector"
  | "mcpServer"
  | "customTools"

export type ProfileToolGroup = {
  kind: ProfileToolGroupKind
  id: string
  name: string
  description: string
  // For customTools, `name` is the custom_tool id and `label` its tool name.
  tools: {
    name: string
    label: string
    description: string
    readOnlyHint?: boolean
  }[]
}

// The one API tools group; its selection is toolAccess.customTools.
export const CUSTOM_TOOLS_GROUP_ID = "api"

type GroupRef = Pick<ProfileToolGroup, "kind" | "id">

export function profileGroupSelection(
  access: ProfileToolAccess,
  group: GroupRef
): ProfileToolSelection | undefined {
  switch (group.kind) {
    case "connector":
      return access.connectors[
        group.id as keyof ProfileToolAccess["connectors"]
      ]
    case "mcpServer":
      return access.mcpServers[group.id]
    case "builtin":
      return access.builtins[group.id as BuiltinToolGroup]
    case "customTools":
      return access.customTools
  }
}

export function setProfileGroupSelection(
  access: ProfileToolAccess,
  group: GroupRef,
  selection: ProfileToolSelection
): ProfileToolAccess {
  switch (group.kind) {
    case "connector":
      return {
        ...access,
        connectors: { ...access.connectors, [group.id]: selection },
      }
    case "mcpServer":
      return {
        ...access,
        mcpServers: { ...access.mcpServers, [group.id]: selection },
      }
    case "builtin":
      return {
        ...access,
        builtins: { ...access.builtins, [group.id]: selection },
      }
    case "customTools":
      return { ...access, customTools: selection }
  }
}

// Every stored override, whatever its source.
export function profileOverrides(
  access: ProfileToolAccess
): (GroupRef & { selection: ProfileToolSelection })[] {
  const entries = (
    kind: ProfileToolGroupKind,
    record: Partial<Record<string, ProfileToolSelection>>
  ) =>
    Object.entries(record).flatMap(([id, selection]) =>
      selection ? [{ kind, id, selection }] : []
    )
  return [
    ...entries("builtin", access.builtins),
    ...entries("connector", access.connectors),
    ...entries("mcpServer", access.mcpServers),
    ...(access.customTools
      ? [
          {
            kind: "customTools" as const,
            id: CUSTOM_TOOLS_GROUP_ID,
            selection: access.customTools,
          },
        ]
      : []),
  ]
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
  if (group.tools.length === 0)
    return group.kind === "customTools"
      ? "No API tools yet"
      : "No tools turned on"
  return count === 1 ? "1 tool" : `All ${count} tools`
}

export function profileGroupNote(
  group: Pick<ProfileToolGroup, "kind" | "name">,
  selection: ProfileToolSelection | undefined
): string {
  if (selection?.mode === "custom")
    return "Only the checked tools. New tools stay off for this profile."
  const limit = "Uncheck a tool to limit this profile."
  switch (group.kind) {
    case "connector":
      return `Matches your ${group.name} connector settings. ${limit}`
    case "mcpServer":
      return `Matches your ${group.name} server settings. ${limit}`
    case "builtin":
      return `Uses every ${group.name} tool. ${limit}`
    case "customTools":
      return `Uses every API tool, including ones added later. ${limit}`
  }
}

const findGroup = (groups: readonly ProfileToolGroup[], ref: GroupRef) =>
  groups.find((group) => group.kind === ref.kind && group.id === ref.id)

// Used only after an explicit editor action; never silently drop saved restrictions.
export function removeUnavailableProfileSelections(
  access: ProfileToolAccess,
  groups: ProfileToolGroup[]
): ProfileToolAccess {
  let result: ProfileToolAccess = {
    connectors: {},
    mcpServers: {},
    builtins: {},
  }
  for (const override of profileOverrides(access)) {
    const group = findGroup(groups, override)
    if (!group) continue
    const { selection } = override
    result = setProfileGroupSelection(
      result,
      override,
      selection.mode === "custom"
        ? {
            mode: "custom",
            tools: profileSelectedTools(
              group.tools.map((tool) => tool.name),
              selection
            ),
          }
        : selection
    )
  }
  return result
}

export function hasUnavailableProfileSelections(
  access: ProfileToolAccess,
  groups: ProfileToolGroup[]
): boolean {
  return profileOverrides(access).some((override) => {
    const group = findGroup(groups, override)
    return (
      !group ||
      (override.selection.mode === "custom" &&
        override.selection.tools.some(
          (name) => !group.tools.some((tool) => tool.name === name)
        ))
    )
  })
}
