import { db, eq, schema } from "@repo/db"
import { agentIdentityFor } from "@repo/utils/bestiary"
import { STILLS } from "@repo/utils/face-stills"
import { type DiscordButton, discordComponents } from "./discord"

// The cards agents post in Discord places (reference/agents-and-chats.md,
// decision 51), laid out with Components V2: a container whose stripe
// says what it is, a section with the agent's face, text and buttons.

type Component = Record<string, unknown>

const text = (content: string): Component => ({ type: 10, content })

// Up to three lines of text beside a thumbnail, or just the text with none.
function section(lines: string[], thumbnail: string | null): Component[] {
  const texts = lines.filter(Boolean).slice(0, 3).map(text)
  return thumbnail
    ? [
        {
          type: 9,
          components: texts,
          accessory: { type: 11, media: { url: thumbnail } },
        },
      ]
    : texts
}

const separator: Component = { type: 14, divider: true, spacing: 1 }

function container(accent: number, components: Component[]): Component {
  return { type: 17, accent_color: accent, components }
}

function buttons(list: DiscordButton[]): Component[] {
  return discordComponents(list) as Component[]
}

const hex = (color: string) => Number.parseInt(color.replace("#", ""), 16)

export const ACCENT = {
  working: 0x5865f2,
  approval: 0xf0b232,
  finished: 0x23a55a,
  failed: 0xda373c,
  stopped: 0x80848e,
} as const

// Markdown and mentions people typed stay text on a card.
export function plain(value: string) {
  return value.replace(/([*_`~|>#\\])/g, "\\$1").replace(/@/g, "@\u200b")
}

export async function agentCardIdentity(agentId: string) {
  const [agent] = await db
    .select({
      id: schema.agent.id,
      name: schema.agent.name,
      creature: schema.agent.creature,
      role: schema.agent.role,
    })
    .from(schema.agent)
    .where(eq(schema.agent.id, agentId))
  if (!agent) return null
  const identity = agentIdentityFor(agent.id, agent)
  return {
    name: identity.name,
    role: agent.role?.trim() || null,
    accent: hex(STILLS[identity.creature].color),
  }
}

// The agent's hello in a channel it was put in.
export function helloCard(input: {
  name: string
  role: string | null
  accent: number
  face: string | null
  // Its @role, mentionable by name; null when the server didn't allow one.
  roleId: string | null
}): Component[] {
  const mention = input.roleId ? `<@&${input.roleId}>` : "Lor"
  return [
    container(input.accent, [
      ...section(
        [
          `### Hi, I'm ${plain(input.name)}${input.role ? `, the ${plain(input.role)} agent` : ""} from Lor`,
          `Mention ${mention} or reply to me, and I'll answer here.`,
          "-# Code sessions need your Lor account: `/lor connect-account`",
        ],
        input.face
      ),
    ]),
  ]
}

export type SessionCardView = {
  title: string
  repo: string | null
  branch: string | null
  state: keyof typeof ACCENT
  latest: string | null
  owner: string | null
  harness: string | null
  face: string | null
  lorUrl: string
  branchUrl: string | null
  pullRequestUrl: string | null
  sessionId: string
}

const STATE_TITLE: Record<SessionCardView["state"], string> = {
  working: "Working",
  approval: "Waiting for an approval",
  finished: "Finished its turn",
  failed: "Failed",
  stopped: "Stopped",
}

const STATE_HINT: Record<SessionCardView["state"], string> = {
  working: "Replies in this thread go to it through the agent.",
  approval: "It goes on once someone decides below.",
  finished: "Follow up, or reply here, to keep it going.",
  failed: "Open it in Lor to see what went wrong.",
  stopped: "Follow up to start it again.",
}

// A code session's card: what it works on, how it is doing, whose it is.
export function sessionCard(view: SessionCardView): Component[] {
  const links: DiscordButton[] = [{ label: "Open in Lor", url: view.lorUrl }]
  if (view.pullRequestUrl) {
    links.push({ label: "Pull request", url: view.pullRequestUrl })
  } else if (view.branchUrl) {
    links.push({ label: "View branch", url: view.branchUrl })
  }
  links.push({
    customId: `lor-send:${view.sessionId}`,
    label: "Follow up",
    style: "secondary",
  })
  const where = [
    view.repo ? plain(view.repo) : null,
    view.branch ? `branch \`${view.branch}\`` : null,
  ]
    .filter(Boolean)
    .join(" · ")
  const whose =
    view.owner && view.harness
      ? `-# ${plain(view.owner)}'s session, on their ${view.harness} plan`
      : view.owner
        ? `-# ${plain(view.owner)}'s session`
        : ""
  return [
    container(ACCENT[view.state], [
      ...section(
        ["-# Code session", `### ${plain(view.title)}`, where],
        view.face
      ),
      separator,
      text(
        [
          `**${STATE_TITLE[view.state]}**`,
          view.latest ? plain(view.latest) : STATE_HINT[view.state],
          whose,
        ]
          .filter(Boolean)
          .join("\n")
      ),
      ...buttons(links),
    ]),
  ]
}

// An approval asked in Discord: what is asked, who can decide, and the
// buttons, or a link to Lor when it needs more than a yes or no.
export function approvalCard(input: {
  approvalId: string
  what: string
  description: string
  decider: string | null
  lorUrl: string | null
  inLor: boolean
}): Component[] {
  return [
    container(ACCENT.approval, [
      text(
        [
          "**Approval needed**",
          plain(input.what),
          `\`\`\`\n${input.description.replace(/```/g, "'''").slice(0, 1500)}\n\`\`\``,
          input.decider
            ? `-# Only ${plain(input.decider)} can decide.`
            : "-# Someone who can approve this in Lor decides.",
        ].join("\n")
      ),
      ...buttons(
        input.inLor
          ? input.lorUrl
            ? [{ label: "Answer in Lor", url: input.lorUrl }]
            : []
          : [
              {
                customId: `lor-approval:${input.approvalId}:approved`,
                label: "Approve",
                style: "success",
              },
              {
                customId: `lor-approval:${input.approvalId}:rejected`,
                label: "Reject",
                style: "danger",
              },
            ]
      ),
    ]),
  ]
}

// The same approval once decided: its buttons go, and it says by whom.
export function decidedApprovalCard(input: {
  description: string
  resolution: "approved" | "rejected"
  by: string
}): Component[] {
  return [
    container(
      input.resolution === "approved" ? ACCENT.finished : ACCENT.stopped,
      [
        text(
          [
            `**${input.resolution === "approved" ? "Approved" : "Rejected"}** by ${plain(input.by)}`,
            `\`\`\`\n${input.description.replace(/```/g, "'''").slice(0, 1500)}\n\`\`\``,
          ].join("\n")
        ),
      ]
    ),
  ]
}
