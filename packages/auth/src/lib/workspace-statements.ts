export const workspaceStatements = {
  channel: ["create", "update", "delete"],
  message: ["delete", "pin"], // delete/pin others' messages (own messages are always deletable)
  workspaceMember: ["kick", "role:update"],
  instructions: ["update", "approve"],
  connector: ["manage"], // third-party integrations (GitHub, Linear, …) — "connectors" in the UI
  webhook: ["manage"], // create/manage channel webhooks, on any channel (no per-channel scoping in v1)
  agentProfile: ["manage"], // create/edit Lor capability profiles AND assign channels to them
  customTool: ["manage"], // user-added tools — both custom API tools and MCP servers
  // Code session env files per repo (reference/dev-environment-runbook.md):
  // edit and reveal. People in a session can still read the written file.
  environment: ["manage"],
  billing: ["manage"],
  // Resolving approvals is NOT a permission — resolvers are named per gate
  // (role/person/any member, teams later). This only gates the settings page.
  approval: ["manage"],
  // Channel access already governs joining, speaking, camera, and screen
  // sharing; this covers removing someone from a call, and deleting an ended
  // call with everything derived from it.
  voice: ["moderate", "delete"],
} as const

// Shared human-readable vocabulary for the statements — the roles UI and the
// future approval-policy UI (LOR-81) both read this so labels never drift.
export const workspaceStatementMeta: {
  [K in keyof typeof workspaceStatements]: {
    label: string
    actions: Record<(typeof workspaceStatements)[K][number], string>
  }
} = {
  channel: {
    label: "Channels",
    actions: {
      create: "Create channels",
      update: "Edit channels & channel settings",
      delete: "Delete channels",
    },
  },
  message: {
    label: "Messages",
    actions: {
      delete: "Delete others' messages",
      pin: "Pin messages",
    },
  },
  workspaceMember: {
    label: "Members",
    actions: {
      kick: "Kick members",
      "role:update": "Change member roles",
    },
  },
  instructions: {
    label: "Workspace instructions",
    actions: {
      update: "Edit LOR.md",
      approve: "Approve LOR.md proposals",
    },
  },
  connector: {
    label: "Connectors",
    actions: { manage: "Manage connectors" },
  },
  webhook: {
    label: "Webhooks",
    actions: { manage: "Manage webhooks" },
  },
  agentProfile: {
    label: "Agent profiles",
    actions: { manage: "Manage agent profiles" },
  },
  customTool: {
    label: "Custom tools",
    actions: { manage: "Manage custom tools & MCP servers" },
  },
  environment: {
    label: "Environments",
    actions: { manage: "Manage environment variables" },
  },
  billing: {
    label: "Billing",
    actions: { manage: "Manage billing" },
  },
  approval: {
    label: "Agent approvals",
    actions: {
      manage: "Configure approval policies",
    },
  },
  voice: {
    label: "Voice",
    actions: {
      moderate: "Remove people from calls",
      delete: "Delete calls",
    },
  },
}

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
