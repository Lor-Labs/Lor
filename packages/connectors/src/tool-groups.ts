export type GroupableTool = {
  name: string
  label?: string
  description: string
  readOnlyHint?: boolean
}

export type ToolGroup<T extends GroupableTool = GroupableTool> = {
  key: "read" | "other"
  label: string
  tools: T[]
}

// MCP read-only labels are provider declarations, so unlabeled MCP tools are
// "Other tools", never reads. Built-in connector tools always declare one.
export function toolGroups<T extends GroupableTool>(
  tools: readonly T[],
  providerHints: boolean
): ToolGroup<T>[] {
  const reads = tools.filter((tool) => tool.readOnlyHint === true)
  const others = tools.filter((tool) => tool.readOnlyHint !== true)
  const otherLabel = !providerHints
    ? "Write"
    : reads.length > 0
      ? "Other tools"
      : "All tools"
  const groups: ToolGroup<T>[] = [
    { key: "read", label: providerHints ? "Read only" : "Read", tools: reads },
    { key: "other", label: otherLabel, tools: others },
  ]
  return groups.filter((group) => group.tools.length > 0)
}

// MCP tool descriptions arrive as raw markdown with code fences and XML tags.
export function cleanToolDescription(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<\/?[a-z_]+>/gi, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
}
