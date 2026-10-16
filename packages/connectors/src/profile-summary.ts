import type { BuiltinToolGroup, ProfileToolAccess } from "@repo/db/schema"
import {
  CUSTOM_TOOLS_GROUP_ID,
  type ProfileToolGroup,
  profileOverrides,
} from "./profile-tools"
import { CONNECTORS } from "./registry"
import { BUILTIN_GROUPS, CONNECTOR_TOOLS, STANDALONE_TOOLS } from "./tools"

type ResourceRef = { kind: string; id?: string; opPosition?: number }

// Plain-language lines for a proposed profile (configuration proposal cards).
export function describeProfilePermissions(
  profile: {
    toolAccess: ProfileToolAccess
    customTools?: readonly ResourceRef[]
  },
  groups: readonly ProfileToolGroup[] = [],
  createdToolNames: ReadonlyMap<number, string> = new Map()
): string[] {
  const apiTools =
    groups.find(
      (group) =>
        group.kind === "customTools" && group.id === CUSTOM_TOOLS_GROUP_ID
    )?.tools ?? []
  const lines = [
    "Anything not listed uses all its tools, including tools added later.",
  ]
  for (const { kind, id, selection } of profileOverrides(profile.toolAccess)) {
    const group = groups.find((item) => item.kind === kind && item.id === id)
    const provider =
      kind === "connector" && Object.hasOwn(CONNECTORS, id)
        ? (id as keyof typeof CONNECTORS)
        : null
    const builtin =
      kind === "builtin" && Object.hasOwn(BUILTIN_GROUPS, id)
        ? (id as BuiltinToolGroup)
        : null
    const label =
      group?.name ??
      (provider
        ? CONNECTORS[provider].label
        : builtin
          ? BUILTIN_GROUPS[builtin].label
          : kind === "customTools"
            ? "API tools"
            : `MCP server ${id}`)
    const tools: readonly { name: string; label: string }[] = provider
      ? CONNECTOR_TOOLS[provider]
      : builtin
        ? STANDALONE_TOOLS.filter((tool) => tool.group === builtin)
        : (group?.tools ?? [])
    const choice =
      selection.mode === "off"
        ? "Off"
        : selection.mode === "workspace"
          ? "All tools (follows changes)"
          : selection.tools.length === 0
            ? "No tools selected"
            : `Only ${selection.tools.map((name) => tools.find((tool) => tool.name === name)?.label ?? name).join(", ")}`
    lines.push(`${label}: ${choice}`)
  }
  if (profile.customTools && profile.customTools.length > 0)
    lines.push(
      `API tools: Only ${profile.customTools
        .map((ref) =>
          ref.kind === "created"
            ? (createdToolNames.get(ref.opPosition ?? -1) ??
              `tool from step ${(ref.opPosition ?? 0) + 1}`)
            : (apiTools.find((tool) => tool.name === ref.id)?.label ??
              ref.id ??
              "Unknown tool")
        )
        .join(", ")}`
    )
  return lines
}
