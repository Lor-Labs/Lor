import { readPage } from "../../brain"
import type { World } from "./world"

export type Check = { label: string; pass: boolean }

export type TaskOutcome = {
  // Raw answer text, citation tokens intact.
  answer: string
  before: Map<string, string>
  after: Map<string, string>
  world: World
}

export type LongTask = {
  name: string
  channel: keyof World["channels"]
  prompt: string
  // Brain path prefixes the task may write under; any other page change
  // fails the out-of-scope guardrail.
  writes: string[]
  check: (o: TaskOutcome) => Promise<Check[]>
}

function has(text: string | undefined, ...patterns: RegExp[]): boolean {
  return text !== undefined && patterns.every((p) => p.test(text))
}

function changed(o: TaskOutcome, path: string): boolean {
  return o.before.get(path) !== o.after.get(path)
}

function changedUnder(o: TaskOutcome, prefix: string): string[] {
  return [...o.after.entries()]
    .filter(([path]) => path.startsWith(prefix) && changed(o, path))
    .map(([, body]) => body)
}

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
]
