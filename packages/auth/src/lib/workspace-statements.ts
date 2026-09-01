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
    actions: { manage: "Manage Merlin profiles" },
  },
  customTool: {
    label: "Custom tools",
    actions: { manage: "Manage custom tools & MCP servers" },
  },
  billing: {
    label: "Billing",
    actions: { manage: "Manage billing" },
  },
  approval: {
    label: "Agent approvals",
    actions: { resolve: "Resolve agent approval requests" },
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
