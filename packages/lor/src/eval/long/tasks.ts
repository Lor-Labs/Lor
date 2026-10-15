import type { Plan } from "@repo/db/schema"
import { readPage } from "../../brain"
import type { ProposeLoopExecutor } from "../../loops"
import type { ProposeChangeExecutor } from "../../proposals"
import { judge, type SimulatedUser } from "./judge"
import type { World } from "./world"

export type Check = { label: string; pass: boolean; reason?: string }

export type TaskOutcome = {
  // Final answer, raw (citation tokens intact).
  answer: string
  // Every turn's answer, in order.
  answers: string[]
  before: Map<string, string>
  after: Map<string, string>
  world: World
  plan: Plan | null
  proposals: Parameters<ProposeChangeExecutor>[0][]
  loops: Parameters<ProposeLoopExecutor>[0][]
}

export type LongTask = {
  name: string
  channel: keyof World["channels"]
  prompt: string
  // Later turns in the same session: scripted, or a simulated teammate.
  followUps?: string[]
  simulatedUser?: SimulatedUser
  // Brain path prefixes the task may write under; any other page change
  // fails the out-of-scope guardrail.
  writes: string[]
  check: (o: TaskOutcome) => Promise<Check[]>
}

export function has(text: string | undefined, ...patterns: RegExp[]): boolean {
  return text !== undefined && patterns.every((p) => p.test(text))
}

export function changed(o: TaskOutcome, path: string): boolean {
  return o.before.get(path) !== o.after.get(path)
}

function changedUnder(o: TaskOutcome, prefix: string): string[] {
  return [...o.after.entries()]
    .filter(([path]) => path.startsWith(prefix) && changed(o, path))
    .map(([, body]) => body)
}

// Changed pages with their links, so a judge can verify claims about both.
export async function changedPagesText(o: TaskOutcome): Promise<string> {
  const pages = [...o.after.entries()].filter(([path]) => changed(o, path))
  if (!pages.length) return "(no memory pages changed)"
  const blocks = await Promise.all(
    pages.map(async ([path, body]) => {
      const page = await readPage(o.world.workspaceId, path)
      const links =
        "links" in page && page.links?.length
          ? `\nLinks: ${page.links.map((l) => `${l.direction === "out" ? "→" : "←"} ${l.path} (${l.type})`).join(", ")}`
          : ""
      return `## ${path}\n${body}${links}`
    })
  )
  return blocks.join("\n\n")
}

export const NODE_22 = /node\.?js?\s*22|node\s*22/i
export const NOV_4 = /(nov(ember)?\.?\s*4(st|nd|rd|th)?\b|11\/0?4\b|11-04\b)/i

export const longTasks: LongTask[] = [
  {
    name: "billing-status-page",
    channel: "eng",
    prompt:
      "Can you write an up-to-date status page for the billing migration at /projects/billing-migration? Who owns it now, what shipped this week, what got reverted, what's blocked, and what's next. Pull it from chat and the PRs.",
    writes: ["/projects/", "/people/"],
    check: async (o) => {
      const page = o.after.get("/projects/billing-migration")
      return [
        {
          label: "updates the stale page",
          pass: changed(o, "/projects/billing-migration"),
        },
        {
          label: "owner is Dana, not Alice",
          pass: has(page, /dana/i) && !/owner\W{0,6}alice/i.test(page ?? ""),
        },
        {
          label: "shipped: invoices and webhook retries",
          pass: has(page, /invoic/i, /webhook/i),
        },
        {
          label: "records the proration revert",
          pass: has(page, /proration/i, /revert/i),
        },
        {
          label: "blocker: Stripe keys from finance",
          pass: has(page, /stripe/i, /(key|finance)/i),
        },
        {
          label: "next: dual-write, then the Oct 28 cutover",
          pass: has(
            page,
            /dual[- ]?write/i,
            /(oct(ober)?\.?\s*28|10\/28|10-28)/i
          ),
        },
      ]
    },
  },
  {
    name: "job-queue-memory-update",
    channel: "eng",
    prompt:
      "What are we using for background jobs going forward? Is what's in memory about that still right? If it isn't, fix it.",
    writes: ["/decisions/"],
    check: async (o) => [
      {
        label: "answer: Postgres with pg-boss",
        pass: has(o.answer, /(postgres|pg-boss)/i),
      },
      {
        label: "answer: Redis stays for caching",
        pass: has(o.answer, /cach/i),
      },
      {
        label: "answer cites the decision message",
        pass: /\[\[msg:/.test(o.answer),
      },
      {
        label: "memory records the Postgres decision",
        pass: changedUnder(o, "/decisions/").some((b) =>
          /(postgres|pg-boss)/i.test(b)
        ),
      },
      {
        label: "stale Redis page corrected or retired",
        pass: changed(o, "/decisions/job-queue"),
      },
    ],
  },
  {
    name: "incident-postmortem",
    channel: "incidents",
    prompt:
      "Please write a postmortem for last week's API outage at /incidents/api-outage: a timeline with times, the root cause, the fix, and follow-ups with owners. Then link the database runbook to it.",
    writes: ["/incidents/", "/runbooks/"],
    check: async (o) => {
      const page = o.after.get("/incidents/api-outage")
      const runbook = await readPage(o.world.workspaceId, "/runbooks/database")
      const times = new Set(page?.match(/\b\d{1,2}:\d{2}\b/g) ?? [])
      return [
        { label: "postmortem page exists", pass: page !== undefined },
        { label: "timeline has 4+ distinct times", pass: times.size >= 4 },
        {
          label: "root cause: #110 dropped the pool cap",
          pass: has(page, /110/, /pool/i),
        },
        { label: "fix: #111", pass: has(page, /111/) },
        {
          label: "follow-up: Raj updates the runbook",
          pass: has(page, /raj/i, /runbook/i),
        },
        {
          label: "follow-up: Alice adds a CI check",
          pass: has(page, /alice/i, /(\bCI\b|check)/i),
        },
        {
          label: "runbook links to the postmortem",
          pass: Boolean(
            "links" in runbook &&
              runbook.links?.some((l) => l.path.startsWith("/incidents"))
          ),
        },
      ]
    },
  },
  {
    name: "onboarding-plan",
    channel: "eng",
    prompt:
      "Sam starts Monday as a backend engineer. Start a plan for getting their onboarding doc ready, work through it, and write the doc to /onboarding/sam: setup steps, how to get access, who their buddy is, and anything outdated they should ignore.",
    writes: ["/onboarding/", "/people/", "/handbook/"],
    check: async (o) => {
      const page = o.after.get("/onboarding/sam")
      return [
        {
          label: "started a plan with 3+ steps",
          pass: (o.plan?.steps.length ?? 0) >= 3,
        },
        { label: "completed the plan", pass: o.plan?.status === "completed" },
        { label: "onboarding page exists", pass: page !== undefined },
        {
          label: "setup: Node 22 (chat), not Node 18 (stale page)",
          pass: has(page, NODE_22),
        },
        {
          label: "access: requests go through #it",
          pass: has(page, /#it\b|\bIT channel/i),
        },
        { label: "buddy: Raj", pass: has(page, /raj/i) },
        ...(await judge(
          [
            "Tells Sam to use Tailscale for network access; OpenVPN appears, if at all, only as outdated",
            "Never tells Sam to install or use Node 18",
          ],
          page ?? ""
        )),
      ]
    },
  },
  {
    name: "incident-alerts-proposal",
    channel: "incidents",
    prompt:
      "We keep missing pager alerts. Set up an #incidents-alerts channel, a webhook into it for our pager, and a loop in that channel that posts a summary of open incidents every Monday at 9am.",
    writes: ["/"],
    check: async (o) => {
      const ops = o.proposals.flatMap((p) => p.operations)
      const loopSchedules = [
        ...ops.flatMap((op) => (op.op === "create_loop" ? [op.schedule] : [])),
        ...o.loops.map((l) => l.schedule),
      ]
      return [
        {
          label: "files exactly one proposal card",
          pass: o.proposals.length === 1,
        },
        {
          label: "creates #incidents-alerts",
          pass: ops.some(
            (op) =>
              op.op === "create_channel" && /incidents-alerts/.test(op.name)
          ),
        },
        {
          label: "adds a webhook",
          pass: ops.some((op) => op.op === "create_webhook"),
        },
        {
          label: "loop every Monday at 9",
          pass: loopSchedules.some((s) =>
            /^0 9 \* \* (1|mon)$/i.test(s.trim())
          ),
        },
      ]
    },
  },
  {
    name: "soc2-undecided",
    channel: "eng",
    prompt:
      "Which SOC 2 auditor did we go with? Save the decision to memory so we don't lose it.",
    writes: ["/"],
    check: async (o) => [
      { label: "answer cites chat", pass: /\[\[msg:/.test(o.answer) },
      ...(await judge(
        [
          "Says no SOC 2 auditor has been chosen yet; the team is still deciding between Prescient and Johanson",
        ],
        o.answer
      )),
      ...([...o.after.keys()].some((p) => changed(o, p))
        ? await judge(
            ["No page states or implies that an auditor was chosen"],
            await changedPagesText(o)
          )
        : [{ label: "no page claims an auditor was chosen", pass: true }]),
    ],
  },
  {
    name: "memory-audit",
    channel: "eng",
    prompt:
      "Audit our memory against the last two weeks of chat and PRs. Fix every page that's out of date, leave correct pages alone, and tell me what you changed.",
    writes: ["/"],
    check: async (o) => {
      const billing = o.after.get("/projects/billing-migration")
      return [
        {
          label: "billing owner fixed to Dana",
          pass:
            has(billing, /dana/i) && !/owner\W{0,6}alice/i.test(billing ?? ""),
        },
        {
          label: "job queue fixed to Postgres",
          pass: changedUnder(o, "/decisions/").some((b) =>
            /(postgres|pg-boss)/i.test(b)
          ),
        },
        {
          label: "dev setup fixed to Node 22",
          pass: has(o.after.get("/handbook/dev-setup"), NODE_22),
        },
        {
          label: "feature flags fixed to Statsig",
          pass: has(o.after.get("/decisions/feature-flags"), /statsig/i),
        },
        {
          label: "VPN page fixed to Tailscale",
          pass: has(o.after.get("/handbook/vpn"), /tailscale/i),
        },
        {
          label: "correct pages left intact",
          pass:
            has(o.after.get("/people/alice"), /engineering lead/i) &&
            has(o.after.get("/runbooks/database"), /\b20\b/),
        },
        ...(await judge(
          ["Lists the pages it changed and what changed on each"],
          o.answer
        )),
      ]
    },
  },
]
