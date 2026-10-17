import type { ApprovalCardData } from "@/components/chat/approval-card"
import type { ChannelProposal, ProposalOperation } from "@/lib/api-types"

// Sample data for the /design page. Ids only need to be unique here.
const ENG_CHANNEL = "c0000000-0000-4000-8000-00000000e001"
const DEPLOY_LOOP = "c0000000-0000-4000-8000-00000000f001"
const GITHUB_CONNECTION = "c0000000-0000-4000-8000-00000000a001"

export const SAMPLE_CHANNEL_NAMES = new Map([[ENG_CHANNEL, "eng"]])

function op(
  position: number,
  spec: ProposalOperation["spec"],
  extra: Partial<Pick<ProposalOperation, "result" | "error">> = {}
): ProposalOperation {
  return {
    id: `op-${position}`,
    position,
    kind: spec.op,
    spec,
    result: null,
    error: null,
    ...extra,
  }
}

function proposal(
  id: string,
  fields: Partial<ChannelProposal> & Pick<ChannelProposal, "operations">
): ChannelProposal {
  return {
    id,
    channelId: ENG_CHANNEL,
    cardMessageId: `card-${id}`,
    authorType: "agent",
    authorUserId: null,
    rationale:
      "The team asked for a dedicated place for support requests. This creates it with a topic so people know what goes there; nothing changes until someone approves.",
    evidence: [],
    status: "pending",
    resolvedByUserId: null,
    resolvedAt: null,
    appliedAt: null,
    resolutionNote: null,
    createdAt: "2026-10-09T15:04:00.000Z",
    requiredPermissions: {},
    ...fields,
  }
}

const supportChannel = op(0, {
  op: "create_channel",
  name: "support",
  topic: "Customer and internal support requests",
})

export type ProposalSample = {
  label: string
  lorSays: string
  proposal: ChannelProposal
  canResolve: boolean
  resolverName?: string
}

export const PROPOSAL_SAMPLES: ProposalSample[] = [
  {
    label: "Needs your approval, one change",
    lorSays:
      "I've filed a proposal to create #support. Approve it and I'll confirm here.",
    proposal: proposal("p1", { operations: [supportChannel] }),
    canResolve: true,
  },
  {
    label: "Several changes, a secret to fill in, sources behind Why",
    lorSays:
      "Here's the docs search tool with an approval gate, plus a webhook for deploy notices.",
    proposal: proposal("p2", {
      rationale:
        "You want Lor to answer questions from the product docs. The docs API needs a key, so the tool asks for it at approval. Admins approve each search because results can include unreleased pages.",
      evidence: [
        {
          kind: "url",
          ref: "https://developers.notion.com/reference/post-search",
        },
        { kind: "url", ref: "https://docs.github.com/en/webhooks" },
      ],
      operations: [
        op(0, {
          op: "create_custom_tool",
          name: "search_docs",
          description: "Search the product docs and return matching pages",
          argsSchema: { type: "object" },
          method: "POST",
          urlTemplate: "https://api.docs.lor.chat/v1/search",
          headers: {},
          bodyTemplate: null,
          requiredSecrets: ["DOCS_API_KEY"],
        }),
        op(1, {
          op: "set_approval_policy",
          target: { kind: "created", opPosition: 0 },
          resolverKind: "role",
          resolverRole: "admin",
        }),
        op(2, {
          op: "create_webhook",
          channel: { kind: "existing", id: ENG_CHANNEL },
          name: "deploys",
        }),
      ],
    }),
    canResolve: true,
  },
  {
    label: "Pending, but you can't approve it",
    lorSays: "I've proposed #support. An admin needs to approve it.",
    proposal: proposal("p3", { operations: [supportChannel] }),
    canResolve: false,
  },
  {
    label: "Applying",
    lorSays: "Approved, applying now.",
    proposal: proposal("p4", {
      status: "approved",
      operations: [
        op(0, {
          op: "create_loop",
          channel: { kind: "existing", id: ENG_CHANNEL },
          name: "Morning digest",
          instructions:
            "Summarize yesterday's merged PRs and open incidents for the team.",
          schedule: "0 9 * * 1-5",
          timezone: null,
          endCondition: null,
          endAfter: null,
        }),
      ],
    }),
    canResolve: true,
  },
  {
    label: "Applied, with results to copy and a setup step",
    lorSays: "Done. The webhook URL is on the card; Linear needs one sign-in.",
    proposal: proposal("p5", {
      status: "applied",
      resolvedByUserId: "u-maya",
      operations: [
        op(0, supportChannel.spec, { result: { resourceId: ENG_CHANNEL } }),
        op(
          1,
          {
            op: "create_webhook",
            channel: { kind: "created", opPosition: 0 },
            name: "intake-form",
          },
          {
            result: {
              url: "https://api.lor.chat/v1/hooks/wh_8f3k2m9q1x7c4b6n",
            },
          }
        ),
        op(
          2,
          {
            op: "create_mcp_server",
            name: "Linear",
            description: "",
            url: "https://mcp.linear.app/sse",
            authMode: "oauth",
          },
          {
            result: {
              setupNote:
                "Sign in to Linear in Settings, Integrations to finish setup.",
            },
          }
        ),
      ],
    }),
    canResolve: true,
    resolverName: "Maya Okafor",
  },
  {
    label: "Rejected with a note",
    lorSays: "Got it, I'll revise.",
    proposal: proposal("p6", {
      status: "rejected",
      resolvedByUserId: "u-dev",
      resolutionNote: "Let's call it #help and keep it to the support team.",
      operations: [supportChannel],
    }),
    canResolve: true,
    resolverName: "Dev Patel",
  },
  {
    label: "Couldn't apply",
    lorSays: "That didn't go through.",
    proposal: proposal("p7", {
      status: "failed",
      resolutionNote: "Stopped at the first change. Nothing was applied.",
      operations: [
        op(0, supportChannel.spec, {
          error: "A channel named #support already exists.",
        }),
      ],
    }),
    canResolve: true,
  },
  {
    label: "Rewrites the workspace instructions",
    lorSays: "Proposed an update to LOR.md with the new release rules.",
    proposal: proposal("p8", {
      operations: [
        op(0, {
          op: "update_instructions",
          content:
            "# How we work\n\n- Releases go out Tuesdays and Thursdays.\n- Hotfixes need a second reviewer.\n- Post release notes in #eng after each deploy.",
        }),
      ],
    }),
    canResolve: true,
  },
  {
    label: "Every other kind of change",
    lorSays: "A few configuration changes for #eng.",
    proposal: proposal("p9", {
      operations: [
        op(0, {
          op: "update_loop",
          loopId: DEPLOY_LOOP,
          schedule: "0 8 * * 1-5",
          name: "Deploy watch",
        }),
        op(1, {
          op: "set_trigger",
          connectionId: GITHUB_CONNECTION,
          event: "pull_request.merged",
          channel: { kind: "existing", id: ENG_CHANNEL },
          post: true,
          actInstructions: null,
        }),
        op(2, {
          op: "create_agent_profile",
          name: "Release captain",
          toolAccess: {
            connectors: {
              github: { mode: "workspace" },
              linear: { mode: "workspace" },
            },
            mcpServers: {},
            builtins: { artifacts: { mode: "off" } },
          },
          customTools: [],
        }),
        op(3, {
          op: "assign_channel_profile",
          channel: { kind: "existing", id: ENG_CHANNEL },
          profile: { kind: "created", opPosition: 2 },
        }),
      ],
    }),
    canResolve: true,
  },
]

export type ApprovalSample = {
  label: string
  lorSays: string
  approval: ApprovalCardData
  canResolve: boolean
  resolvedByName?: string
}

export const APPROVAL_SAMPLES: ApprovalSample[] = [
  {
    label: "Needs your approval",
    lorSays: "Waiting for approval before I continue.",
    approval: {
      id: "a1",
      description: "Searching GitHub for “tester”",
      planId: null,
      target: "tool:search_github",
      toolName: "search_github",
      resolver: { kind: "any_member" },
      resolverUserName: null,
      status: "pending",
      resolvedBy: null,
    },
    canResolve: true,
  },
  {
    label: "Someone else approves",
    lorSays: "Waiting for approval before I continue.",
    approval: {
      id: "a2",
      description:
        "Sending the release notes to the 42 people on the beta list",
      planId: null,
      target: "custom_tool:send_email",
      toolName: "send_email",
      resolver: { kind: "role", role: "admin" },
      resolverUserName: null,
      status: "pending",
      resolvedBy: null,
    },
    canResolve: false,
  },
  {
    label: "Approved",
    lorSays: "Waiting for approval before I continue.",
    approval: {
      id: "a3",
      description: "Searching GitHub for “bug report”",
      planId: null,
      target: "tool:search_github",
      toolName: "search_github",
      resolver: { kind: "any_member" },
      resolverUserName: null,
      status: "approved",
      resolvedBy: "u1",
    },
    canResolve: true,
    resolvedByName: "Maren Okafor",
  },
  {
    label: "Rejected",
    lorSays: "Waiting for approval before I continue.",
    approval: {
      id: "a4",
      description:
        "Sending the release notes to the 42 people on the beta list",
      planId: null,
      target: "custom_tool:send_email",
      toolName: "send_email",
      resolver: { kind: "role", role: "admin" },
      resolverUserName: null,
      status: "rejected",
      resolvedBy: "u2",
    },
    canResolve: false,
    resolvedByName: "you",
  },
]
