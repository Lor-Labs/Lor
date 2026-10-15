import { judge } from "./judge"
import { changedPagesText, has, type LongTask, NODE_22, NOV_4 } from "./tasks"

// Multi-turn tasks: follow-ups arrive through the same continuation path the
// worker uses, so context accumulates across turns like a real session.
export const sessionTasks: LongTask[] = [
  {
    name: "billing-follow-ups",
    channel: "eng",
    prompt:
      "Write a short status page for the billing migration at /projects/billing-migration from chat and the PRs.",
    followUps: [
      "Correction: the cutover moved to Nov 4, finance needs an extra week. Update the page.",
      "Also add Raj as backup owner, and add a risks section that covers the proration rework.",
      "Quick check: what's the cutover date now, and who do I ping if Dana is out?",
    ],
    writes: ["/projects/", "/people/"],
    check: async (o) => {
      const page = o.after.get("/projects/billing-migration")
      return [
        { label: "page has the Nov 4 cutover", pass: has(page, NOV_4) },
        {
          label: "Raj listed as backup owner",
          pass: has(page, /raj/i, /backup/i),
        },
        {
          label: "risks section covers proration",
          pass: has(page, /risk/i, /proration/i),
        },
        {
          label: "final answer: Nov 4 and Raj",
          pass: has(o.answer, NOV_4, /raj/i),
        },
        ...(await judge(
          [
            "The cutover target is Nov 4; Oct 28 appears, if at all, only as the earlier date",
          ],
          page ?? ""
        )),
      ]
    },
  },
  {
    name: "q4-hiring-interview",
    channel: "eng",
    prompt:
      "Draft our Q4 hiring plan at /plans/q4-hiring. Ask me for anything you don't know before you write it.",
    simulatedUser: {
      persona: "Bucky, the cofounder",
      facts: [
        "Budget is 3 hires this quarter.",
        "Roles: 2 backend engineers (one payments, one infrastructure) and 1 product designer.",
        "Job posts go out Nov 1.",
        "Target start date is Jan 15.",
        "Alice runs the interviews.",
      ],
      maxTurns: 4,
    },
    writes: ["/plans/", "/hiring/", "/people/", "/projects/"],
    check: async (o) => {
      const page = o.after.get("/plans/q4-hiring")
      return [
        {
          label: "asked before writing",
          pass: (o.answers[0] ?? "").includes("?"),
        },
        { label: "plan page exists", pass: page !== undefined },
        ...(await judge(
          [
            "Plans exactly 3 hires",
            "Roles are two backend engineers (payments and infrastructure) and one product designer",
            "Job posts go out Nov 1 and the target start date is Jan 15",
            "Alice runs the interviews",
            "Invents no hiring decisions: headcount, roles, levels, salaries, dates and recruiters match what Bucky gave (3 hires: 2 backend for payments and infrastructure, 1 product designer; posts Nov 1; start Jan 15; Alice interviews) or are clearly marked as proposals or open questions",
          ],
          `${page ?? ""}\n\n(Workspace context the plan may also draw on: Alice is the engineering lead and runs hiring; Raj runs infrastructure and is the on-call buddy for new backend hires; Dana works on payments and billing; Sam joins Monday as a backend engineer.)`
        )),
      ]
    },
  },
  {
    name: "long-session",
    channel: "eng",
    prompt:
      "Let's do a cleanup session. First: update /projects/billing-migration to reflect where things stand, from chat and the PRs.",
    followUps: [
      "Next: write a postmortem for last week's API outage at /incidents/api-outage with a timeline, root cause, fix and follow-ups.",
      "Next: our memory on background jobs is stale. Fix /decisions/job-queue.",
      "Next: write an onboarding doc for Sam at /onboarding/sam covering setup, access and their buddy.",
      "Next: check /decisions/feature-flags and /handbook/vpn against chat and fix them if needed.",
      "Last one: summarize everything you changed this session, page by page.",
    ],
    writes: ["/"],
    check: async (o) => [
      {
        label: "billing owner is Dana",
        pass: has(o.after.get("/projects/billing-migration"), /dana/i),
      },
      {
        label: "postmortem names #110 and #111",
        pass: has(o.after.get("/incidents/api-outage"), /110/, /111/),
      },
      {
        label: "job queue fixed to Postgres",
        pass: has(o.after.get("/decisions/job-queue"), /(postgres|pg-boss)/i),
      },
      {
        label: "onboarding: Node 22 and Raj",
        pass: has(o.after.get("/onboarding/sam"), NODE_22, /raj/i),
      },
      {
        label: "feature flags fixed to Statsig",
        pass: has(o.after.get("/decisions/feature-flags"), /statsig/i),
      },
      {
        label: "VPN page fixed to Tailscale",
        pass: has(o.after.get("/handbook/vpn"), /tailscale/i),
      },
      ...(await judge(
        [
          "Summarizes changes to all six pages: /projects/billing-migration, /incidents/api-outage, /decisions/job-queue, /onboarding/sam, /decisions/feature-flags and /handbook/vpn",
          "The summary matches the pages below and claims no change that isn't there",
        ],
        `Final answer:\n${o.answer}\n\nChanged pages:\n${await changedPagesText(o)}`
      )),
    ],
  },
]
