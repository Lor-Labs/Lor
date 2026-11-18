import { me, type Person, people } from "../prototype-data"

// Made-up data for the team-agents prototype (reference/planned/team-agents.md).
// A channel is an agent. A thread is a conversation with that agent: it has
// no repo, branch or mode of its own, and the agent starts code sessions
// under it as the work needs them. The team's own chat is a room attached to
// the agent.

// How far the agent may go on its own for one watch. Access grows with trust.
export type TrustLevel = "observes" | "prepares" | "acts" | "owns"

export const trustLevels: Record<TrustLevel, { label: string; text: string }> =
  {
    observes: {
      label: "Observes",
      text: "Reports what it sees. Changes nothing.",
    },
    prepares: {
      label: "Prepares",
      text: "Does the work, then asks before anything leaves.",
    },
    acts: {
      label: "Acts",
      text: "Does narrow, reversible things without asking.",
    },
    owns: {
      label: "Owns",
      text: "Watches a queue and proposes what to do next.",
    },
  }

export type Watch = {
  id: string
  label: string
  kind: "event" | "schedule"
  lastFired: string
  // The person who answers for what this watch starts.
  owner: Person
  level: TrustLevel
}

// Where the team talks. One room per agent at a time.
export type Room =
  | { kind: "slack"; channel: string }
  | { kind: "discord"; channel: string }
  | { kind: "lor" }

export function roomName(room: Room, agent: Agent) {
  if (room.kind === "lor") return `#${agent.id} in Lor`
  return `${room.channel} in ${room.kind === "slack" ? "Slack" : "Discord"}`
}

// How far the agent goes in the room.
export type RoomLevel = "listens" | "mentioned" | "speaks"

export const roomLevels: { id: RoomLevel; label: string; text: string }[] = [
  {
    id: "listens",
    label: "Listens",
    text: "Reads the room and remembers what was decided. Never writes.",
  },
  {
    id: "mentioned",
    label: "Answers when mentioned",
    text: "Replies in a thread under the message. The same thread shows here.",
  },
  {
    id: "speaks",
    label: "Speaks up",
    text: "Also replies, in a thread, when it can help and nobody asked.",
  },
]

export type Agent = {
  id: string
  name: string
  job: string
  brief: string
  watching: Watch[]
  tools: string[]
  repos: string[]
  prompts: { name: string; text: string }[]
  handoffs: string[]
  room?: Room
  suggestions: string[]
}

export const agents: Agent[] = [
  {
    id: "eng",
    name: "Eng",
    job: "Errors to fixes, reviews, the weekly digest",
    brief:
      "You look after production for Northstar. Investigate every error alert that lasts more than 10 minutes or hits more than 10 times. Find the pull request that caused it and fix it on a branch. Never touch billing code without asking Eli. Open draft pull requests only. A person merges.",
    watching: [
      {
        id: "errors",
        owner: people.mara,
        level: "prepares",
        label: "Better Stack errors",
        kind: "event",
        lastFired: "12 min ago",
      },
      {
        id: "reviews",
        owner: people.owen,
        level: "observes",
        label: "GitHub reviews",
        kind: "event",
        lastFired: "1 h ago",
      },
      {
        id: "digest",
        owner: people.mara,
        level: "acts",
        label: "Weekly digest, Mondays 9:00",
        kind: "schedule",
        lastFired: "Monday",
      },
    ],
    tools: ["GitHub", "Better Stack", "Linear", "Sandbox", "Web"],
    repos: ["web", "api", "realtime"],
    prompts: [
      {
        name: "triage-error",
        text: "Find the cause of this error and say how many customers it hits.",
      },
      {
        name: "release-notes",
        text: "Write release notes for everything merged since the last tag.",
      },
    ],
    handoffs: ["Support may hand work to Eng"],
    room: { kind: "slack", channel: "#eng" },
    suggestions: [
      "Look at my Linear issues and let's get started on them",
      "How are errors trending?",
      "Look into the flaky deploy",
    ],
  },
  {
    id: "support",
    name: "Support",
    job: "Drafts replies, hands bugs to Eng",
    brief:
      "You answer customers of Northstar. Draft every reply for approval and never send without it. Use the policy pages in Notion. When a customer reports a bug, hand it to Eng and wait for the answer before replying.",
    watching: [
      {
        id: "inbox",
        owner: people.samira,
        level: "prepares",
        label: "Support inbox",
        kind: "event",
        lastFired: "40 min ago",
      },
      {
        id: "bugs",
        owner: people.samira,
        level: "observes",
        label: "Linear bugs",
        kind: "event",
        lastFired: "Yesterday",
      },
    ],
    tools: ["Attio", "Notion", "Linear", "Web"],
    repos: [],
    prompts: [
      {
        name: "reply",
        text: "Draft a reply in our voice. Two short paragraphs at most.",
      },
    ],
    handoffs: ["Support may hand work to Eng"],
    room: { kind: "slack", channel: "#support" },
    suggestions: ["Summarize this week's tickets"],
  },
  {
    id: "gtm",
    name: "GTM",
    job: "Signups, the CRM, outreach drafts",
    brief:
      "You help Northstar find and talk to customers. Every Monday, check new signups against Attio and list the ones worth a call. Draft outreach for approval. Never send from a personal account.",
    watching: [
      {
        id: "signups",
        owner: people.samira,
        level: "prepares",
        label: "New signups, Mondays 8:00",
        kind: "schedule",
        lastFired: "Monday",
      },
      {
        id: "deals",
        owner: people.mara,
        level: "observes",
        label: "Attio deals",
        kind: "event",
        lastFired: "3 h ago",
      },
    ],
    tools: ["Attio", "Web"],
    repos: [],
    prompts: [],
    handoffs: [],
    suggestions: ["Who signed up this week?", "Which deals went quiet?"],
  },
  {
    id: "design",
    name: "Design",
    job: "Not set up yet",
    brief: "",
    watching: [],
    tools: [],
    repos: [],
    prompts: [],
    handoffs: [],
    suggestions: [],
  },
]

export type WorkState = "running" | "needs_you" | "done"

// A message inside one thread. A null author is Lor.
export type Reply = { id: string; author: Person | null; text: string }

// One piece of work with its own computer. In code mode it is a code session:
// one repo, one branch, one dev box. Otherwise it runs on the agent's own
// computer. With a parent it was started by the agent from that thread;
// without one a person started it directly.
export type Work = {
  id: string
  agentId: string
  parentId?: string
  repo?: string
  branch?: string
  diff?: boolean
  app?: boolean
  // What the person asked for, when they started the code session directly.
  prompt?: string
  // Whose call it is: the person who asked, or the owner of the watch that
  // started it. Everyone can write in the thread; the owner settles it.
  owner: Person
  title: string
  mode: "code" | "chat"
  state: WorkState
  steps: string[]
  // A one-off action in progress, like opening the pull request.
  doing?: string
  facts?: string
  ask?: string
  result?: string
  summary?: string
  replies: Reply[]
}

export const initialWorks: Work[] = [
  {
    id: "export-retry",
    agentId: "eng",
    parentId: "export-timeouts",
    repo: "api",
    branch: "lor/export-retry",
    diff: true,
    app: true,
    owner: people.mara,
    title: "Fix export retry",
    mode: "code",
    state: "needs_you",
    steps: [
      "Read export-job.ts and 10 other files",
      "Reproduced the timeout with Paygrove's export",
      "Changed retries to resume from the last written row",
      "Ran the app: the export finishes in 38 seconds",
    ],
    facts: "3 files · +101 −15 · app runs",
    ask: "Open a draft pull request",
    summary:
      "The timeouts started after #398 raised the export batch to 5,000 rows. A retry restarted the whole batch, so a slow export never finished. Retries now resume from the last written row and wait between attempts.",
    replies: [
      {
        id: "r1",
        author: people.eli,
        text: "@Owen does this keep the retry cap? We agreed on 5 with Paygrove",
      },
      {
        id: "r2",
        author: people.owen,
        text: "@Eli the cap is unchanged. Only where a retry starts from",
      },
    ],
  },
  {
    id: "checkout-500",
    agentId: "eng",
    parentId: "checkout-500s",
    repo: "web",
    branch: "lor/checkout-500",
    owner: people.mara,
    title: "Investigate checkout 500s",
    mode: "code",
    state: "running",
    steps: [
      "Read checkout/route.ts",
      "Reproduced the 500 with a saved card",
      "Checking the payment client's timeout",
      "Comparing with Friday's deploy",
    ],
    replies: [],
  },
  {
    id: "hono-api",
    agentId: "eng",
    parentId: "hono-5",
    repo: "api",
    branch: "lor/hono-5-api",
    owner: people.owen,
    title: "api",
    mode: "code",
    state: "done",
    steps: ["Upgraded Hono", "Ran the app"],
    facts: "2 files · +15 −18",
    result: "Ready for review",
    replies: [],
  },
  {
    id: "hono-realtime",
    agentId: "eng",
    parentId: "hono-5",
    repo: "realtime",
    branch: "lor/hono-5-realtime",
    owner: people.owen,
    title: "realtime",
    mode: "code",
    state: "running",
    steps: ["Upgrading Hono", "Fixing the socket middleware types"],
    replies: [],
  },
  {
    id: "hono-worker",
    agentId: "eng",
    parentId: "hono-5",
    repo: "worker",
    branch: "lor/hono-5-worker",
    owner: people.owen,
    title: "worker",
    mode: "code",
    state: "running",
    steps: ["Upgrading Hono", "Running the queue locally"],
    replies: [],
  },
  {
    id: "idle-export",
    agentId: "eng",
    repo: "web",
    branch: "lor/export-button",
    app: true,
    owner: people.eli,
    title: "Export button looks idle",
    mode: "code",
    state: "done",
    steps: [
      "Read export-button.tsx",
      "Moved the loading state ahead of the request",
      "Ran the app and clicked Export twice",
    ],
    facts: "1 file · +21 −6",
    result: "Merged in #412",
    summary:
      "The request was queued before the click handler returned, so the button never entered its loading state. It now shows progress and blocks a second click.",
    replies: [],
  },
  {
    id: "invoice-dark",
    agentId: "eng",
    repo: "web",
    branch: "lor/invoice-dark",
    owner: people.mara,
    title: "Dark mode for the invoice page",
    mode: "code",
    state: "done",
    steps: [
      "Read invoice-page.tsx and its styles",
      "Moved the hard-coded colors to theme tokens",
      "Ran the app in both themes",
    ],
    facts: "4 files · +63 −22",
    result: "Ready for review",
    summary:
      "The invoice page used fixed grays, so it stayed light in dark mode. It now reads the theme tokens, and the totals table keeps its contrast in both themes.",
    replies: [],
  },
]

export type Draft = {
  id: string
  agentId: string
  threadId: string
  title: string
  to: string
  subject: string
  body: string
  sent: boolean
}

export const initialDrafts: Draft[] = [
  {
    id: "paygrove-reply",
    agentId: "support",
    threadId: "paygrove-export",
    title: "Reply to Paygrove",
    to: "Dana Whitfield, Paygrove",
    subject: "Re: Export does nothing",
    body: "Hi Dana,\n\nThanks for flagging this. Your exports were running, but the button gave no sign of it, so each extra click started another one.\n\nWe shipped a fix today: the button now shows progress, and your last export is ready under Downloads.\n\nMara",
    sent: false,
  },
]

export type Chart = {
  id: string
  title: string
  total: string
  delta: string
  note: string
  bars: { label: string; value: number; mark?: boolean }[]
  rows: { label: string; value: number; status: string }[]
}

export const charts: Chart[] = [
  {
    id: "errors-week",
    title: "Errors, last 7 days",
    total: "144",
    delta: "34% fewer than the week before",
    note: "Thursday's spike is the checkout bug I'm on now. The export timeouts stopped after last night's fix.",
    bars: [
      { label: "Fri", value: 31 },
      { label: "Sat", value: 12 },
      { label: "Sun", value: 9 },
      { label: "Mon", value: 28 },
      { label: "Tue", value: 22 },
      { label: "Wed", value: 14 },
      { label: "Thu", value: 28, mark: true },
    ],
    rows: [
      {
        label: "ExportJob timeout",
        value: 58,
        status: "Fixed, waiting on you",
      },
      { label: "500 on /checkout", value: 41, status: "Working on it" },
      { label: "Slow search", value: 27, status: "Fixed in #407" },
      { label: "Everything else", value: 18, status: "Below the bar" },
    ],
  },
]

export type Lead = { id: string; company: string; size: string; why: string }

export const leads: Lead[] = [
  {
    id: "lumen",
    company: "Lumen Health",
    size: "120 people",
    why: "Trialing two competitors",
  },
  {
    id: "kestrel",
    company: "Kestrel Labs",
    size: "45 people",
    why: "Founder opened pricing 6 times",
  },
  {
    id: "paygrove",
    company: "Paygrove",
    size: "300 people",
    why: "Asked about SSO",
  },
  {
    id: "orbit",
    company: "Orbit Freight",
    size: "80 people",
    why: "Connected GitHub on day one",
  },
  {
    id: "tally",
    company: "Tallyhouse",
    size: "22 people",
    why: "Invited 9 teammates",
  },
]

export type Block =
  | { kind: "work"; workId: string }
  | { kind: "group"; title: string; workIds: string[] }
  | { kind: "stats"; items: { label: string; value: string }[] }
  | { kind: "chart"; chartId: string }
  | { kind: "leads" }
  | { kind: "draft"; draftId: string }
  | {
      kind: "handoff"
      toAgentId: string
      ask: string
      answer: string
      workId: string
    }
  | { kind: "templates" }
  | { kind: "proposal" }

export type ThreadItem =
  | { id: string; kind: "person"; author: Person; time: string; text: string }
  | {
      id: string
      kind: "agent"
      time: string
      // What woke it when nobody asked: an alert, a schedule, another agent.
      woke?: string
      text?: string
      blocks?: Block[]
      pending?: boolean
    }

// Who or what started a thread with the agent.
export type Starter =
  | { kind: "person"; person: Person }
  | { kind: "room"; person: Person; room: string }
  | { kind: "event"; source: string }
  | { kind: "timer"; label: string }

// A thread with a channel's agent: one piece of work, the people on it,
// and the code sessions the agent starts for it. In Slack it is a thread.
export type Thread = {
  id: string
  agentId: string
  title: string
  starter: Starter
  // Whose call it is. Everyone in the channel can open and write in it.
  owner: Person
  people: Person[]
  time: string
}

export function starterLine(starter: Starter) {
  const first = (person: Person) =>
    person.id === me.id ? "You" : person.name.split(" ")[0]
  switch (starter.kind) {
    case "person":
      return `${first(starter.person)} asked`
    case "room":
      return `${first(starter.person)} asked in ${starter.room}`
    case "event":
      return `Started by ${starter.source}`
    case "timer":
      return `On a schedule, ${starter.label}`
  }
}

// Newest first.
export const initialThreads: Thread[] = [
  {
    id: "design-setup",
    agentId: "design",
    title: "Set up Design",
    starter: { kind: "person", person: people.mara },
    owner: people.mara,
    people: [people.mara],
    time: "now",
  },
  {
    id: "hono-5",
    agentId: "eng",
    title: "Upgrade Hono to 5",
    starter: { kind: "room", person: people.owen, room: "#eng in Slack" },
    owner: people.owen,
    people: [people.owen],
    time: "9:20",
  },
  {
    id: "paygrove-export",
    agentId: "support",
    title: "Paygrove: Export does nothing",
    starter: { kind: "event", source: "the support inbox" },
    owner: people.mara,
    people: [people.mara, people.samira],
    time: "9:05",
  },
  {
    id: "checkout-500s",
    agentId: "eng",
    title: "Checkout 500s",
    starter: { kind: "event", source: "a Better Stack alert" },
    owner: people.mara,
    people: [people.mara],
    time: "8:30",
  },
  {
    id: "export-timeouts",
    agentId: "eng",
    title: "ExportJob timeouts",
    starter: { kind: "event", source: "a Better Stack alert" },
    owner: people.mara,
    people: [people.mara, people.eli, people.owen],
    time: "2:10",
  },
  {
    id: "digest-w46",
    agentId: "eng",
    title: "Weekly digest",
    starter: { kind: "timer", label: "Mondays 9:00" },
    owner: people.mara,
    people: [people.mara, people.eli, people.owen],
    time: "Mon",
  },
  {
    id: "signups-w46",
    agentId: "gtm",
    title: "New signups, week 46",
    starter: { kind: "timer", label: "Mondays 8:00" },
    owner: people.samira,
    people: [people.samira, people.mara],
    time: "Mon",
  },
]

// Keyed by thread.
export const initialTranscripts: Record<string, ThreadItem[]> = {
  "digest-w46": [
    {
      id: "t1",
      kind: "agent",
      time: "9:00",
      woke: "on its Monday schedule",
      text: "Last week went well. Six fixes merged, two are still waiting on review, and errors are down by a third.",
      blocks: [
        {
          kind: "stats",
          items: [
            { label: "Fixes merged", value: "6" },
            { label: "Waiting on review", value: "2" },
            { label: "Errors", value: "−34%" },
          ],
        },
      ],
    },
  ],
  "export-timeouts": [
    {
      id: "t2",
      kind: "agent",
      time: "2:10",
      woke: "from a Better Stack alert",
      text: "ExportJob started timing out overnight. A retry restarts the whole batch, so large exports never finish. I started a session in api, fixed it on a branch and checked it against Paygrove's export.",
      blocks: [{ kind: "work", workId: "export-retry" }],
    },
  ],
  "checkout-500s": [
    {
      id: "t3",
      kind: "agent",
      time: "8:30",
      woke: "from a Better Stack alert",
      text: "Checkout is returning 500s, 22 in the last ten minutes. I started a session in web to find the cause.",
      blocks: [{ kind: "work", workId: "checkout-500" }],
    },
  ],
  "hono-5": [
    {
      id: "t4",
      kind: "person",
      author: people.owen,
      time: "9:20",
      text: "@Lor upgrade Hono to 5 before the release. api, realtime and worker",
    },
    {
      id: "t5",
      kind: "agent",
      time: "9:20",
      text: "Started three sessions, one per package. I'll report here as each one is ready.",
      blocks: [
        {
          kind: "group",
          title: "Upgrade Hono to 5",
          workIds: ["hono-api", "hono-realtime", "hono-worker"],
        },
      ],
    },
  ],
  "paygrove-export": [
    {
      id: "s1",
      kind: "agent",
      time: "9:05",
      woke: "from the support inbox",
      text: "Paygrove wrote: “We click Export and nothing happens. Is it broken?” Their exports are running, but the button shows no progress, so they click again. I asked Eng before replying.",
      blocks: [
        {
          kind: "handoff",
          toAgentId: "eng",
          ask: "The export button gives no feedback while an export runs. Paygrove, 41,000 rows. Can you confirm and fix it?",
          answer:
            "Confirmed. Fixed and merged in #412: it now shows progress and blocks a second click.",
          workId: "idle-export",
        },
      ],
    },
    {
      id: "s2",
      kind: "agent",
      time: "9:48",
      text: "With that fixed, here is the reply I would send.",
      blocks: [{ kind: "draft", draftId: "paygrove-reply" }],
    },
  ],
  "signups-w46": [
    {
      id: "g1",
      kind: "agent",
      time: "8:00",
      woke: "on its Monday schedule",
      text: "14 teams signed up last week. Five look worth a call. Pick the ones you want and I'll draft the outreach.",
      blocks: [{ kind: "leads" }],
    },
  ],
  "design-setup": [
    {
      id: "x1",
      kind: "agent",
      time: "now",
      text: "I'm not set up for Design yet. Tell me what you want me to look after, or start from one of these. I'll propose what to watch, which tools to use and what needs approval, and you approve it once.",
      blocks: [{ kind: "templates" }],
    },
  ],
}

// What the agent took from the room, so people can see what it hears.
export type Pickup = {
  id: string
  author: Person
  time: string
  text: string
  outcome: "thread" | "noted" | "passed"
  note: string
  threadId?: string
}

export const pickups: Record<string, Pickup[]> = {
  eng: [
    {
      id: "p1",
      author: people.owen,
      time: "9:20",
      text: "@Lor upgrade Hono to 5 before the release. api, realtime and worker",
      outcome: "thread",
      note: "Mentioned. Answered in a thread",
      threadId: "hono-5",
    },
    {
      id: "p2",
      author: people.eli,
      time: "8:52",
      text: "Paygrove's retry cap stays at 5, we agreed that on the call",
      outcome: "noted",
      note: "Saved to Eng's memory",
    },
    {
      id: "p3",
      author: people.samira,
      time: "8:40",
      text: "anyone up for lunch at 12:30?",
      outcome: "passed",
      note: "Not about Eng's work",
    },
  ],
  support: [
    {
      id: "p4",
      author: people.samira,
      time: "Yesterday",
      text: "Refunds over $500 need my sign-off from now on",
      outcome: "noted",
      note: "Proposed as a change to the brief. Waiting for Samira",
    },
  ],
}

// Issues the Eng agent finds for the person asking, and what it starts.
export const linearIssues = [
  {
    key: "LOR-173",
    title: "CSV export drops the header row",
    repo: "api",
    branch: "lor/lor-173-csv-header",
    steps: [
      "Read export/csv.ts and its fixture",
      "Reproduced it: the header is written after the first flush",
      "Moved the header ahead of the stream",
      "Ran the app: the export matches the fixture",
    ],
  },
  {
    key: "LOR-171",
    title: "Empty state for invoices",
    repo: "web",
    branch: "lor/lor-171-invoice-empty",
    steps: [
      "Read invoice-list.tsx",
      "Added the empty state from the design system",
      "Ran the app with a workspace that has no invoices",
    ],
  },
  {
    key: "LOR-175",
    title: "Retry failed webhooks",
    repo: "api",
    branch: "lor/lor-175-webhook-retry",
    steps: [
      "Read webhooks/deliver.ts",
      "Writing a retry queue with backoff",
      "Adding a migration for the attempts table",
      "Running the queue locally",
    ],
  },
]

export const templates = [
  "Review every new Figma file against the design system",
  "Keep a shared board of open design questions",
  "Turn feedback from Support into design tickets",
]

export type DiffLine = { kind: "ctx" | "add" | "del"; text: string }

export const diffFiles: {
  path: string
  added: number
  removed: number
  lines: DiffLine[]
}[] = [
  {
    path: "apps/api/src/jobs/export-job.ts",
    added: 38,
    removed: 12,
    lines: [
      {
        kind: "ctx",
        text: "export async function runExport(job: ExportJob) {",
      },
      {
        kind: "del",
        text: "  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {",
      },
      { kind: "del", text: "    try {" },
      { kind: "del", text: "      return await writeBatch(job, 0)" },
      { kind: "add", text: "  let cursor = await loadCursor(job.id)" },
      {
        kind: "add",
        text: "  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {",
      },
      { kind: "add", text: "    try {" },
      { kind: "add", text: "      return await writeBatch(job, cursor)" },
      { kind: "ctx", text: "    } catch (error) {" },
      { kind: "ctx", text: "      if (!isRetryable(error)) throw error" },
      { kind: "add", text: "      cursor = await loadCursor(job.id)" },
      { kind: "add", text: "      await wait(backoff(attempt))" },
      { kind: "ctx", text: "    }" },
      { kind: "ctx", text: "  }" },
      { kind: "ctx", text: "  throw new ExportTimeoutError(job.id)" },
      { kind: "ctx", text: "}" },
    ],
  },
  {
    path: "apps/api/src/jobs/export-cursor.ts",
    added: 54,
    removed: 0,
    lines: [
      {
        kind: "add",
        text: "// Where an export resumes after a failed attempt.",
      },
      {
        kind: "add",
        text: "export async function loadCursor(jobId: string) {",
      },
      {
        kind: "add",
        text: "  const row = await db.query.exportCursor.findFirst({",
      },
      { kind: "add", text: "    where: eq(exportCursor.jobId, jobId)," },
      { kind: "add", text: "  })" },
      { kind: "add", text: "  return row?.lastWrittenRow ?? 0" },
      { kind: "add", text: "}" },
    ],
  },
  {
    path: "apps/api/src/lib/retry.ts",
    added: 9,
    removed: 3,
    lines: [
      { kind: "ctx", text: "export const MAX_RETRIES = 5" },
      { kind: "del", text: "export const wait = () => Promise.resolve()" },
      { kind: "add", text: "export const backoff = (attempt: number) =>" },
      { kind: "add", text: "  Math.min(30_000, 500 * 2 ** attempt)" },
    ],
  },
]

export type LogOutcome = "passed" | "noted" | "worked" | "asked"

export type LogEvent = {
  id: string
  agentId: string
  time: string
  source: string
  text: string
  outcome: LogOutcome
  reason: string
}

export const logEvents: LogEvent[] = [
  {
    id: "l1",
    agentId: "eng",
    time: "09:12",
    source: "Support",
    text: "The export button gives no feedback",
    outcome: "worked",
    reason: "A bug report from a linked agent.",
  },
  {
    id: "l3",
    agentId: "eng",
    time: "08:30",
    source: "Better Stack",
    text: "500s on /checkout, 22 in 10 minutes",
    outcome: "worked",
    reason: "Over the threshold in the brief.",
  },
  {
    id: "l4",
    agentId: "eng",
    time: "07:55",
    source: "GitHub",
    text: "Review requested on #415 from Owen",
    outcome: "passed",
    reason: "Asked of a person, not of Lor.",
  },
  {
    id: "l5",
    agentId: "eng",
    time: "06:20",
    source: "GitHub",
    text: "CI failed on main",
    outcome: "passed",
    reason: "A known flaky check. It passed on the retry.",
  },
  {
    id: "l6",
    agentId: "eng",
    time: "03:40",
    source: "Better Stack",
    text: "p95 latency 1.2 s on /search",
    outcome: "passed",
    reason: "Under the threshold in the brief (2 s for 10 minutes).",
  },
  {
    id: "l7",
    agentId: "eng",
    time: "02:14",
    source: "Better Stack",
    text: "ExportJob timed out 3 more times",
    outcome: "noted",
    reason: "Same error as Fix export retry. Added to it.",
  },
  {
    id: "l8",
    agentId: "eng",
    time: "02:10",
    source: "Better Stack",
    text: "ExportJob timed out 14 times in 10 minutes",
    outcome: "asked",
    reason: "Fixed on a branch. The pull request needs approval.",
  },
  {
    id: "l9",
    agentId: "support",
    time: "09:05",
    source: "Support inbox",
    text: "Paygrove: Export does nothing",
    outcome: "asked",
    reason: "A reply is drafted. Sending it needs approval.",
  },
  {
    id: "l10",
    agentId: "support",
    time: "08:41",
    source: "Support inbox",
    text: "Your weekly product update",
    outcome: "passed",
    reason: "A newsletter, not a customer.",
  },
  {
    id: "l11",
    agentId: "gtm",
    time: "08:00",
    source: "Schedule",
    text: "New signups",
    outcome: "worked",
    reason: "Runs every Monday.",
  },
]

export function agentById(agentId: string) {
  return agents.find((agent) => agent.id === agentId)
}
