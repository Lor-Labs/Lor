export const workspaceStatements = {
  channel: ["create", "update", "delete"],
  message: ["delete", "pin"], // delete/pin others' messages (own messages are always deletable)
  workspaceMember: ["kick", "role:update"],
  instructions: ["update", "approve"],
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
