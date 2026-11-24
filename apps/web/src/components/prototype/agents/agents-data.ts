import type { CreatureId } from "@repo/utils/bestiary"
import { me, type Person, people } from "../prototype-data"

// Made-up data for the agents-and-chats prototype
// (reference/planned/agents-and-chats.md). An agent is a teammate for a role
// and is added to channels. A channel is only a place where people talk. A
// chat is one piece of work between some people and one agent, and the agent
// starts code sessions under it.

// Something that wakes the agent with nobody asking. It names the channel
// the agent reports in.
export type Watch = {
  id: string
  label: string
  kind: "event" | "schedule"
  lastFired: string
  reportsIn: string
}

export type ChannelPlace = "lor" | "slack" | "discord"

// A long-lasting place where people talk, in Lor or in a chat app. It has
// one agent or none.
export type Channel = {
  id: string
  name: string
  place: ChannelPlace
  topic: string
  agentId?: string
}

export const channels: Channel[] = [
  {
    id: "general",
    name: "general",
    place: "lor",
    topic: "Team-wide updates.",
  },
  {
    id: "eng",
    name: "eng",
    place: "lor",
    topic: "Code, pull requests and technical decisions.",
    agentId: "eng",
  },
  {
    id: "incidents",
    name: "incidents",
    place: "lor",
    topic: "Alerts and what was done about them.",
    agentId: "eng",
  },
  {
    id: "gtm",
    name: "gtm",
    place: "lor",
    topic: "Signups, deals and outreach.",
    agentId: "gtm",
  },
  {
    id: "support",
    name: "support",
    place: "slack",
    topic: "Customer questions. The team talks in Slack.",
    agentId: "support",
  },
]

export function channelById(channelId: string) {
  return channels.find((channel) => channel.id === channelId)
}

export const placeNames: Record<ChannelPlace, string> = {
  lor: "Lor",
  slack: "Slack",
  discord: "Discord",
}

// A Claude Code or ChatGPT login the agent uses for code sessions when the
// person who asked has no plan of their own, and for work nobody asked for.
export type CodingAccount = {
  id: string
  provider: "Claude Code" | "Codex"
  label: string
  note: string
}

export type Fact = { id: string; text: string; source: string }

export type Agent = {
  id: string
  // What the team calls it.
  name: string
  role: string
  creature: CreatureId
  job: string
  brief: string
  facts: Fact[]
  model: string
  accounts: CodingAccount[]
  watching: Watch[]
  tools: string[]
  repos: string[]
  prompts: { name: string; text: string }[]
  suggestions: string[]
}

export const agents: Agent[] = [
  {
    id: "eng",
    name: "Inky",
    role: "Eng",
    creature: "kraken",
    job: "Errors to fixes, reviews, the weekly digest",
    brief:
      "You look after production for Northstar. Investigate every error alert that lasts more than 10 minutes or hits more than 10 times. Find the pull request that caused it and fix it on a branch. Never touch billing code without asking Eli. A person reviews and merges.",
    facts: [
      {
        id: "f1",
        text: "Paygrove's retry cap stays at 5.",
        source: "Eli in #eng, today",
      },
      {
        id: "f2",
        text: "Releases go out on Thursdays.",
        source: "Mara in a chat, Monday",
      },
      {
        id: "f3",
        text: "The worker's queue needs Redis 7 locally.",
        source: "A code session in worker, last week",
      },
    ],
    model: "Opus 5.5",
    accounts: [
      {
        id: "a1",
        provider: "Claude Code",
        label: "Northstar Max",
        note: "First",
      },
      { id: "a2", provider: "Codex", label: "Northstar Team", note: "Backup" },
    ],
    watching: [
      {
        id: "errors",
        label: "Better Stack errors",
        kind: "event",
        lastFired: "12 min ago",
        reportsIn: "incidents",
      },
      {
        id: "reviews",
        label: "GitHub reviews",
        kind: "event",
        lastFired: "1 h ago",
        reportsIn: "eng",
      },
      {
        id: "digest",
        label: "Weekly digest, Mondays 9:00",
        kind: "schedule",
        lastFired: "Monday",
        reportsIn: "eng",
      },
    ],
    tools: ["GitHub", "Better Stack", "Linear", "Web"],
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
    suggestions: [
      "Look at my Linear issues and let's get started on them",
      "How are errors trending?",
      "Look into the flaky deploy",
    ],
  },
  {
    id: "support",
    name: "Fennel",
    role: "Support",
    creature: "fox",
    job: "Drafts replies, finds the fix behind a ticket",
    brief:
      "You answer customers of Northstar. Draft every reply for approval and never send without it. Use the policy pages in Notion. When a customer reports a bug, check whether it is already fixed before replying.",
    facts: [
      {
        id: "f4",
        text: "Refunds over $500 need Samira's sign-off.",
        source: "Samira in #support, yesterday",
      },
    ],
    model: "Opus 5.5",
    accounts: [],
    watching: [
      {
        id: "inbox",
        label: "Support inbox",
        kind: "event",
        lastFired: "40 min ago",
        reportsIn: "support",
      },
      {
        id: "bugs",
        label: "Linear bugs",
        kind: "event",
        lastFired: "Yesterday",
        reportsIn: "support",
      },
    ],
    tools: ["Attio", "Notion", "Linear", "GitHub", "Web"],
    repos: [],
    prompts: [
      {
        name: "reply",
        text: "Draft a reply in our voice. Two short paragraphs at most.",
      },
    ],
    suggestions: ["Summarize this week's tickets"],
  },
  {
    id: "gtm",
    name: "Quill",
    role: "GTM",
    creature: "owl",
    job: "Signups, the CRM, outreach drafts",
    brief:
      "You help Northstar find and talk to customers. Every Monday, check new signups against Attio and list the ones worth a call. Draft outreach for approval. Never send from a personal account.",
    facts: [],
    model: "Opus 5.5",
    accounts: [],
    watching: [
      {
        id: "signups",
        label: "New signups, Mondays 8:00",
        kind: "schedule",
        lastFired: "Monday",
        reportsIn: "gtm",
      },
      {
        id: "deals",
        label: "Attio deals",
        kind: "event",
        lastFired: "3 h ago",
        reportsIn: "gtm",
      },
    ],
    tools: ["Attio", "Web"],
    repos: [],
    prompts: [],
    suggestions: ["Who signed up this week?", "Which deals went quiet?"],
  },
  {
    id: "design",
    name: "Morel",
    role: "Design",
    creature: "myconid",
    job: "Not set up yet",
    brief: "",
    facts: [],
    model: "Opus 5.5",
    accounts: [],
    watching: [],
    tools: [],
    repos: [],
    prompts: [],
    suggestions: [],
  },
]

export type WorkState = "running" | "needs_you" | "done"

// A message inside one session. A null author is the coding agent.
export type Reply = { id: string; author: Person | null; text: string }

// One piece of work with its own computer. In code mode it is a code session:
// one repo, one branch, one dev box. Otherwise it runs on the agent's own
// computer. With a parent it was started by the agent from that chat;
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
  // Who asked for it. Their own plan pays for the session before the
  // agent's does.
  asker: Person
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
    asker: people.mara,
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
    asker: people.mara,
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
    asker: people.owen,
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
    asker: people.owen,
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
    asker: people.owen,
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
    asker: people.eli,
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
    asker: people.mara,
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
  chatId: string
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
    chatId: "paygrove-export",
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
  | { kind: "templates" }
  | { kind: "proposal" }

export type ChatItem =
  | { id: string; kind: "person"; author: Person; time: string; text: string }
  | {
      id: string
      kind: "agent"
      time: string
      text?: string
      blocks?: Block[]
      pending?: boolean
    }

// Who or what started a chat with the agent. A chat that began in a channel
// also shows there, as a chat under the message.
export type Starter =
  | { kind: "person"; person: Person }
  | { kind: "channel"; person: Person; channelId: string }
  | { kind: "event"; source: string; channelId: string }
  | { kind: "timer"; label: string; channelId: string }

// One piece of work between some people and one agent, with the code
// sessions the agent starts for it. Anyone who can see the agent can open
// it; only the people in it have it in their sidebar.
export type Chat = {
  id: string
  agentId: string
  title: string
  starter: Starter
  people: Person[]
  time: string
}

export function chatChannel(chat: Chat) {
  return chat.starter.kind === "person"
    ? undefined
    : channelById(chat.starter.channelId)
}

export function starterLine(starter: Starter) {
  const first = (person: Person) =>
    person.id === me.id ? "You" : person.name.split(" ")[0]
  switch (starter.kind) {
    case "person":
      return `${first(starter.person)} asked`
    case "channel":
      return `${first(starter.person)} asked in #${channelById(starter.channelId)?.name}`
    // The chat never says what woke the agent (always-on-agents decision 30).
    case "event":
    case "timer":
      return "Started on its own"
  }
}

// Newest first.
export const initialChats: Chat[] = [
  {
    id: "design-setup",
    agentId: "design",
    title: "Set up Morel",
    starter: { kind: "person", person: people.mara },
    people: [people.mara],
    time: "now",
  },
  {
    id: "hono-5",
    agentId: "eng",
    title: "Upgrade Hono to 5",
    starter: { kind: "channel", person: people.owen, channelId: "eng" },
    people: [people.owen],
    time: "9:20",
  },
  {
    id: "paygrove-export",
    agentId: "support",
    title: "Paygrove: Export does nothing",
    starter: {
      kind: "event",
      source: "the support inbox",
      channelId: "support",
    },
    people: [people.mara, people.samira],
    time: "9:05",
  },
  {
    id: "checkout-500s",
    agentId: "eng",
    title: "Checkout 500s",
    starter: {
      kind: "event",
      source: "a Better Stack alert",
      channelId: "incidents",
    },
    people: [people.mara],
    time: "8:30",
  },
  {
    id: "export-timeouts",
    agentId: "eng",
    title: "ExportJob timeouts",
    starter: {
      kind: "event",
      source: "a Better Stack alert",
      channelId: "incidents",
    },
    people: [people.mara, people.eli, people.owen],
    time: "2:10",
  },
  {
    id: "digest-w46",
    agentId: "eng",
    title: "Weekly digest",
    starter: { kind: "timer", label: "Mondays 9:00", channelId: "eng" },
    people: [people.mara, people.eli, people.owen],
    time: "Mon",
  },
  {
    id: "signups-w46",
    agentId: "gtm",
    title: "New signups, week 46",
    starter: { kind: "timer", label: "Mondays 8:00", channelId: "gtm" },
    people: [people.samira, people.mara],
    time: "Mon",
  },
]

// Keyed by chat.
export const initialTranscripts: Record<string, ChatItem[]> = {
  "digest-w46": [
    {
      id: "t1",
      kind: "agent",
      time: "9:00",
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
      text: "ExportJob started timing out overnight. A retry restarts the whole batch, so large exports never finish. I started a session in api, fixed it on a branch and checked it against Paygrove's export.",
      blocks: [{ kind: "work", workId: "export-retry" }],
    },
  ],
  "checkout-500s": [
    {
      id: "t3",
      kind: "agent",
      time: "8:30",
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
      text: "@Inky upgrade Hono to 5 before the release. api, realtime and worker",
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
      text: "Paygrove wrote: “We click Export and nothing happens. Is it broken?” Their exports are running, but the button shows no progress, so they click again. I checked GitHub: that was fixed and merged in #412 this morning.",
    },
    {
      id: "s2",
      kind: "agent",
      time: "9:48",
      text: "Here is the reply I would send.",
      blocks: [{ kind: "draft", draftId: "paygrove-reply" }],
    },
  ],
  "signups-w46": [
    {
      id: "g1",
      kind: "agent",
      time: "8:00",
      text: "14 teams signed up last week. Five look worth a call. Pick the ones you want and I'll draft the outreach.",
      blocks: [{ kind: "leads" }],
    },
  ],
  "design-setup": [
    {
      id: "x1",
      kind: "agent",
      time: "now",
      text: "I'm not set up yet. Tell me what you want me to look after, or start from one of these. I'll propose what to watch, which tools to use and what needs approval, and you approve it once.",
      blocks: [{ kind: "templates" }],
    },
  ],
}

// A message in a channel. People talk to people there. A mention of the
// channel's agent gets a plain reply, or a chat once it turns into work.
export type ChannelMessage = {
  id: string
  // A person, or the channel's agent when it posts with nobody asking.
  author: Person | null
  time: string
  text: string
  // The agent's plain answer to a quick question: no chat.
  reply?: string
  // The chat this message started. It shows here as a chat.
  chatId?: string
}

export const initialChannelChat: Record<string, ChannelMessage[]> = {
  general: [
    {
      id: "c1",
      author: people.samira,
      time: "8:40",
      text: "anyone up for lunch at 12:30?",
    },
    {
      id: "c2",
      author: people.owen,
      time: "8:44",
      text: "yes, the ramen place",
    },
    {
      id: "c3",
      author: people.eli,
      time: "9:02",
      text: "All-hands moved to 3pm today",
    },
  ],
  eng: [
    {
      id: "c4",
      author: null,
      time: "Mon",
      text: "Last week went well. Six fixes merged, two are still waiting on review, and errors are down by a third.",
      chatId: "digest-w46",
    },
    {
      id: "c5",
      author: people.eli,
      time: "8:52",
      text: "Paygrove's retry cap stays at 5, we agreed that on the call",
    },
    {
      id: "c6",
      author: people.samira,
      time: "9:10",
      text: "@Inky when did the last deploy go out?",
      reply: "At 9:02, from main. No new errors since.",
    },
    {
      id: "c7",
      author: people.owen,
      time: "9:20",
      text: "@Inky upgrade Hono to 5 before the release. api, realtime and worker",
      chatId: "hono-5",
    },
  ],
  incidents: [
    {
      id: "c8",
      author: null,
      time: "2:10",
      text: "ExportJob started timing out overnight. A retry restarts the whole batch, so large exports never finish. I fixed it on a branch and checked it against Paygrove's export.",
      chatId: "export-timeouts",
    },
    {
      id: "c9",
      author: null,
      time: "8:30",
      text: "Checkout is returning 500s, 22 in the last ten minutes. I started a session in web to find the cause.",
      chatId: "checkout-500s",
    },
  ],
  gtm: [
    {
      id: "c10",
      author: null,
      time: "Mon",
      text: "14 teams signed up last week. Five look worth a call.",
      chatId: "signups-w46",
    },
    {
      id: "c11",
      author: people.samira,
      time: "9:15",
      text: "Lumen asked for a call on Thursday",
    },
  ],
  support: [
    {
      id: "c12",
      author: people.samira,
      time: "Yesterday",
      text: "Refunds over $500 need my sign-off from now on",
    },
    {
      id: "c13",
      author: null,
      time: "9:05",
      text: "Paygrove wrote: “We click Export and nothing happens. Is it broken?” This was fixed in #412 this morning. I drafted a reply.",
      chatId: "paygrove-export",
    },
  ],
}

// Issues the eng agent finds for the person asking, and what it starts.
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
    source: "Linear",
    text: "The export button gives no feedback",
    outcome: "worked",
    reason: "A bug Eli filed and assigned to it.",
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
    reason: "Asked of a person, not of Inky.",
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
