import {
  type ChangeOperation,
  changeOperationSchema,
  type ProposalEvidence,
  proposalEvidenceSchema,
} from "@repo/db/schema"
import { tool } from "ai"
import { z } from "zod"

// Workspace change proposals (pillar 3, reference/change-proposals.md): the
// ONE sanctioned way Lor changes workspace configuration. The tool files a
// reviewable card; nothing exists until a human whose permissions cover every
// operation approves it, and apply is one atomic transaction server-side.

export type ProposeChangeExecutor = (input: {
  rationale: string
  evidence: ProposalEvidence[]
  operations: ChangeOperation[]
}) => Promise<{ proposalId: string }>

const proposeChangeContext = z.object({
  createProposalCard: z.custom<ProposeChangeExecutor>(),
})

const MAX_OPERATIONS = 15

// `created` refs must point backward at an earlier op of the right kind —
// checked here so the model gets a fixable error instead of a dead card.
function refIssue(operations: ChangeOperation[]): string | null {
  const check = (
    at: number,
    ref: { kind: string; opPosition?: number },
    kinds: ChangeOperation["op"][]
  ): string | null => {
    if (ref.kind !== "created") return null
    const position = ref.opPosition ?? -1
    if (position >= at) {
      return `operation ${at}: a created reference must point at an EARLIER operation (got ${position})`
    }
    const target = operations[position]
    if (!target || !kinds.includes(target.op)) {
      return `operation ${at}: referenced operation ${position} is not one of ${kinds.join("/")}`
    }
    return null
  }
  for (const [index, operation] of operations.entries()) {
    let issue: string | null = null
    switch (operation.op) {
      case "create_webhook":
      case "set_trigger":
      case "create_loop":
        issue = check(index, operation.channel, ["create_channel"])
        break
      case "assign_channel_profile":
        issue = `operation ${index}: tool profiles are set per agent now; use assign_agent_profile with the agent's id`
        break
      case "assign_agent_profile":
        issue = operation.profile
          ? check(index, operation.profile, ["create_agent_profile"])
          : null
        break
      case "create_agent_profile":
        for (const ref of operation.customTools) {
          issue ??= check(index, ref, ["create_custom_tool"])
        }
        break
      case "set_approval_policy":
        issue = check(index, operation.target, ["create_custom_tool"])
        break
      default:
        break
    }
    if (issue) return issue
  }
  return null
}

const PROPOSALS_PROMPT_HEAD = `- Workspace changes: propose_workspace_change is the ONLY way you change this workspace's configuration (channels, webhooks, loops, connector event routing, agent profiles, custom tools, MCP servers, approval gates, LOR.md). It files one reviewable card; a teammate with the right permissions approves it and everything applies together. Research before proposing: verify a custom tool's API (endpoint, method, body shape) with web search first. Never include secret VALUES — declare secret names and the approver types the values on the card. Treat LOR.md operations as a last resort; they shape every channel.`
const PROPOSALS_PROMPT_TAIL = `Webhook URLs contain a secret and are never sent to you: a teammate copies one from the channel's Webhooks settings.`

export const PROPOSALS_PROMPT_LINE = `${PROPOSALS_PROMPT_HEAD} After a proposal is approved, the results (created ids, setup notes) arrive as a message in the same conversation — finish any codebase integration from there using your code tools. ${PROPOSALS_PROMPT_TAIL}`

// The channel agent's card posts in the chat, and the decision wakes it in
// the card's thread.
export const AGENT_PROPOSALS_PROMPT_LINE = `${PROPOSALS_PROMPT_HEAD} When a teammate decides, the decision and the results (created ids, setup notes) wake you in the card's thread; hand any codebase integration to a code session. ${PROPOSALS_PROMPT_TAIL}`

// A refusal the model should read as written.
export class ProposalRefusedError extends Error {}

// Bound only on conversational runs, like propose_loop — unattended runs must
// not reshape the workspace.
export const proposeChangeTool = {
  propose_workspace_change: tool({
    description:
      'Propose a set of workspace configuration changes as ONE reviewable card: create channels, webhooks, loops (or edit one), connector event routing, agent profiles, custom API tools, MCP servers, approval gates, or update the workspace instructions. Nothing is created until a teammate with the required permissions approves the card, so end your answer by pointing them at it. Operations apply in order and later ones may reference earlier ones with {kind: "created", opPosition: N} (e.g. create a channel at 0, then a webhook inside it at 1). For custom tools: verify the target API with web search FIRST, and never include secret values — list the secret NAMES in requiredSecrets; the approver types the values when approving. Propose an approval gate (set_approval_policy) alongside a tool whose action the user wants a human to sign off on. update_instructions rewrites LOR.md for the whole workspace — use it rarely and only when asked. Tool profiles belong to agents: assign_agent_profile sets the profile of one agent (by its id), and a session a person starts uses the workspace default. Keep the set minimal: only what the ask actually needs.',
    inputSchema: z.object({
      rationale: z
        .string()
        .min(1)
        .max(2000)
        .describe(
          "plain-words why: what outcome this configuration makes true, for the reviewer"
        ),
      evidence: z
        .array(proposalEvidenceSchema)
        .max(10)
        .nullable()
        .describe(
          "links that motivated this: message/plan/run ids from this workspace, or URLs (API docs you verified). Null when none"
        ),
      operations: z
        .array(changeOperationSchema)
        .min(1)
        .max(MAX_OPERATIONS)
        .describe("the typed operations, in apply order"),
    }),
    contextSchema: proposeChangeContext,
    execute: async ({ rationale, evidence, operations }, { context }) => {
      const issue = refIssue(operations)
      if (issue) return { ok: false as const, error: issue }
      try {
        const { proposalId } = await context.createProposalCard({
          rationale,
          evidence: evidence ?? [],
          operations,
        })
        return {
          ok: true as const,
          proposalId,
          note: "proposal card created — a teammate with the required permissions must approve it; point them at the card. You'll get the results (created ids, setup notes) once it's decided.",
        }
      } catch (err) {
        return {
          ok: false as const,
          error:
            err instanceof ProposalRefusedError
              ? err.message
              : "Failed to file the proposal",
        }
      }
    },
  }),
}
