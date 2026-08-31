export const workspaceStatements = {
  channel: ["create", "update", "delete"],
  message: ["delete", "pin"], // delete/pin others' messages (own messages are always deletable)
  workspaceMember: ["kick", "role:update"],
  instructions: ["update", "approve"],
  connector: ["manage"], // third-party integrations (GitHub, Linear, …) — "connectors" in the UI
  webhook: ["manage"], // create/manage channel webhooks, on any channel (no per-channel scoping in v1)
  agentProfile: ["manage"], // create/edit Merlin capability profiles AND assign channels to them
  customTool: ["manage"], // user-added tools — both custom API tools and MCP servers
  billing: ["manage"],
  approval: ["resolve"], // reserved for approval policies (LOR-81); not enforced yet
} as const

// better-auth's newRole() requires mutable arrays; createAccessControl accepts readonly
export const workspaceGrants = Object.fromEntries(
  Object.entries(workspaceStatements).map(([resource, actions]) => [
    resource,
    [...actions],
  ])
) as {
  -readonly [K in keyof typeof workspaceStatements]: [
    ...(typeof workspaceStatements)[K],
  ]
}
