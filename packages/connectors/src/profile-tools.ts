import type { ProfileToolSelection } from "@repo/db/schema"

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
