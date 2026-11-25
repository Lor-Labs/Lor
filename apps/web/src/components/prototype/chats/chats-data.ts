import type { CreatureId } from "@repo/utils/bestiary"

// Made-up data for /prototype/chats: Lor as named group chats, each with
// people and agents (reference/agents-and-chats.md). No statuses, no kinds
// of chat, no projects: those come later, if at all.

export type Place = "lor" | "slack" | "discord"

export type Agent = {
  id: string
  name: string
  role: string
  creature: CreatureId
  // Where it posts when nobody asked and the work names no place.
  home: { place: Place; name: string }
  places: { place: Place; name: string }[]
  loops: { name: string; when: string; postsTo: string }[]
  onItsOwn: { when: string; text: string }[]
}

export type Person = { id: string; name: string; color: string }

export type Session = {
  id: string
  title: string
  // The agent doing the work, in a session a chat's agent started. One you
  // start and sit in yourself has none, only the coding tool it runs on.
  agentId?: string
  harness?: string
  repo: string
  branch: string
  state: "running" | "done" | "needs_you"
  summary: string
  when: string
  steps: string[]
  files: { path: string; added: number; removed: number }[]
}

export type Message = {
  id: string
  from: string
  time: string
  text: string
  session?: string
  approval?: string
  // Not a message: the point in the feed where one agent messaged another.
  // The id of that exchange in the agents' chat.
  exchange?: string
}

// One agent messaging another about a chat's work. Together a chat's
// exchanges are its agents' chat, which people read and don't write in.
export type Exchange = {
  id: string
  from: string
  to: string
  // The chat whose work it is about.
  chatId: string
  messages: { id: string; from: string; time: string; text: string }[]
}

export type Chat = {
  id: string
  // A group chat has a name people gave it. A chat with only you and one
  // agent in it is named after the agent.
  name: string
  agentIds: string[]
  people: string[]
  unread?: boolean
  // Stays at the top of the list and does not move when messages arrive.
  pinned?: boolean
  // The agents on a turn in this chat right now.
  working?: string[]
  // Where the chat lives. One outside Lor is a thread there, shown here as
  // a record with the work around it.
  place: Place
  origin?: string
  when: string
  messages: Message[]
  sessions: Session[]
}

export const YOU = "jacob"

export const PEOPLE: Person[] = [
  { id: "jacob", name: "Jacob", color: "#3b82f6" },
  { id: "sam", name: "Sam", color: "#f97316" },
  { id: "ana", name: "Ana", color: "#ec4899" },
  { id: "eli", name: "Eli", color: "#14b8a6" },
  { id: "priya", name: "Priya", color: "#a855f7" },
]

export const AGENTS: Agent[] = [
  {
    id: "inky",
    name: "Inky",
    role: "Eng",
    creature: "kraken",
    home: { place: "slack", name: "#eng" },
    places: [
      { place: "slack", name: "#eng" },
      { place: "slack", name: "#deploys" },
      { place: "discord", name: "#dev" },
      { place: "lor", name: "Eng" },
    ],
    loops: [
      {
        name: "Open pull requests",
        when: "Weekdays at 9:00",
        postsTo: "#eng in Slack",
      },
      {
        name: "Watch staging deploys",
        when: "Every 30 minutes",
        postsTo: "#deploys in Slack, only when one fails",
      },
    ],
    onItsOwn: [
      {
        when: "10:42",
        text: "Saw staging fail twice on a migration timeout. Posted in #deploys and started a chat.",
      },
      {
        when: "10:15",
        text: "Read 14 new messages in #eng. Nothing needed it.",
      },
      { when: "9:00", text: "Posted the open pull requests in #eng." },
    ],
  },
  {
    id: "quill",
    name: "Quill",
    role: "GTM",
    creature: "owl",
    home: { place: "lor", name: "Launch crew" },
    places: [
      { place: "slack", name: "#gtm" },
      { place: "lor", name: "Launch crew" },
    ],
    loops: [
      {
        name: "Morning outreach",
        when: "Weekdays at 8:00",
        postsTo: "#gtm in Slack",
      },
    ],
    onItsOwn: [
      { when: "8:00", text: "Sent 12 outreach drafts to #gtm for review." },
    ],
  },
  {
    id: "rusty",
    name: "Rusty",
    role: "Support",
    creature: "fox",
    home: { place: "discord", name: "#support" },
    places: [{ place: "discord", name: "#support" }],
    loops: [],
    onItsOwn: [
      {
        when: "11:05",
        text: "Read 6 new messages in #support. Nothing needed it.",
      },
    ],
  },
]

export const CHATS: Chat[] = [
  {
    id: "safari",
    name: "Safari login loop",
    agentIds: ["inky"],
    people: ["sam", "jacob"],
    place: "lor",
    when: "10:06 AM",
    sessions: [
      {
        id: "s1",
        title: "Fix the Safari login redirect",
        agentId: "inky",
        repo: "web",
        branch: "fix/login-redirect",
        state: "running",
        summary: "Reproduced on Safari 17. Patching the redirect guard.",
        when: "10:06 AM",
        steps: [
          "Reproduced the loop on Safari 17",
          "Found the guard reading a cookie Safari drops on cross-site redirects",
          "Patching the guard for web and the mobile web view",
        ],
        files: [
          { path: "apps/web/src/lib/redirect-guard.ts", added: 24, removed: 9 },
          { path: "apps/mobile/src/webview/guard.ts", added: 11, removed: 4 },
        ],
      },
    ],
    messages: [
      {
        id: "m1",
        from: "sam",
        time: "10:02 AM",
        text: "@Inky the login redirect loops on Safari, can you fix it?",
      },
      {
        id: "m2",
        from: "inky",
        time: "10:02 AM",
        text: "On it. I can reproduce it: the redirect guard reads a cookie Safari drops on cross-site redirects. Starting a fix on web.",
        session: "s1",
      },
      {
        id: "m3",
        from: "jacob",
        time: "10:06 AM",
        text: "Check the same guard in the mobile web view while you're there.",
      },
      {
        id: "m4",
        from: "inky",
        time: "10:06 AM",
        text: "Will do. Same guard, same bug. I'll cover both in this branch.",
      },
    ],
  },
  {
    id: "eng",
    name: "Eng",
    agentIds: ["inky"],
    pinned: true,
    people: ["jacob", "sam", "eli", "priya"],
    place: "lor",
    when: "9:31 AM",
    sessions: [
      {
        id: "e1",
        title: "Mobile crash on launch",
        agentId: "inky",
        repo: "mobile",
        branch: "fix/launch-crash",
        state: "needs_you",
        summary: "Two ways to fix it. It needs a call from Eli.",
        when: "9:40 AM",
        steps: [
          "Read the crash reports from the last release",
          "Traced it to the font loader running before the bridge is ready",
          "Wrote both fixes up for Eli to choose between",
        ],
        files: [
          { path: "apps/mobile/src/boot/fonts.ts", added: 9, removed: 2 },
        ],
      },
      {
        id: "e2",
        title: "Billing webhook retries",
        agentId: "inky",
        repo: "api",
        branch: "feat/webhook-retries",
        state: "done",
        summary: "Opened a pull request with 3 files changed.",
        when: "Yesterday",
        steps: [
          "Added a retry queue with backoff",
          "Made the handler safe to run twice",
          "Opened a pull request",
        ],
        files: [
          { path: "apps/api/src/billing/webhooks.ts", added: 41, removed: 12 },
          { path: "apps/worker/src/queues/billing.ts", added: 33, removed: 0 },
          { path: "packages/db/src/schemas/billing.ts", added: 6, removed: 1 },
        ],
      },
      {
        id: "e3",
        title: "Split the staging migration",
        agentId: "inky",
        repo: "db",
        branch: "chore/split-migration",
        state: "done",
        summary:
          "Split into two migrations that each finish in under a minute.",
        when: "Yesterday",
        steps: [
          "Split the backfill from the schema change",
          "Ran both against a copy of staging",
        ],
        files: [
          {
            path: "packages/db/migrations/0412_schema.sql",
            added: 18,
            removed: 0,
          },
          {
            path: "packages/db/migrations/0413_backfill.sql",
            added: 22,
            removed: 0,
          },
        ],
      },
      {
        id: "e4",
        title: "Upgrade the router",
        agentId: "inky",
        repo: "web",
        branch: "chore/router-upgrade",
        state: "done",
        summary: "Merged on Monday.",
        when: "Monday",
        steps: ["Upgraded the router", "Fixed two changed route types"],
        files: [{ path: "apps/web/package.json", added: 1, removed: 1 }],
      },
    ],
    messages: [
      {
        id: "e1",
        from: "sam",
        time: "9:12 AM",
        text: "Morning. I'm on the billing webhooks today.",
      },
      {
        id: "e2",
        from: "eli",
        time: "9:20 AM",
        text: "Reviewing Priya's migration PR, then the mobile crash.",
      },
      {
        id: "e3",
        from: "jacob",
        time: "9:31 AM",
        text: "@Inky what's still open from last week's release?",
      },
      {
        id: "e4",
        from: "inky",
        time: "9:31 AM",
        text: "Two things: the Safari login loop, which I'm on with Sam, and the flaky staging deploy, which needs your approval to roll back.",
      },
    ],
  },
  {
    id: "staging",
    name: "Staging deploys",
    agentIds: ["inky"],
    people: ["jacob", "priya"],
    unread: true,
    place: "slack",
    origin: "#deploys",
    when: "8:44 AM",
    sessions: [],
    messages: [
      {
        id: "d1",
        from: "inky",
        time: "8:42 AM",
        text: "Staging failed twice in a row on a migration timeout. The last good deploy was #481. I can roll back to it.",
        approval: "Roll staging back to deploy #481",
      },
      {
        id: "d2",
        from: "priya",
        time: "8:44 AM",
        text: "That's my migration. Roll back, I'll split it.",
      },
    ],
  },
  {
    id: "launch",
    name: "Launch crew",
    agentIds: ["quill", "inky"],
    pinned: true,
    people: ["jacob", "ana"],
    unread: true,
    place: "lor",
    when: "8:21 AM",
    sessions: [
      {
        id: "l1",
        title: "Pricing page copy",
        agentId: "inky",
        repo: "www",
        branch: "copy/pricing",
        state: "done",
        summary: "Updated the three plan cards. Waiting on the numbers.",
        when: "Yesterday",
        steps: [
          "Rewrote the three plan cards from Quill's draft",
          "Left the prices as they are until Jacob confirms them",
        ],
        files: [
          { path: "apps/www/app/pricing/page.tsx", added: 27, removed: 19 },
        ],
      },
    ],
    messages: [
      {
        id: "l1",
        from: "ana",
        time: "Yesterday",
        text: "Launch is Thursday. @Quill keep the checklist here up to date.",
      },
      { id: "lx1", from: "quill", time: "8:01 AM", text: "", exchange: "x1" },
      {
        id: "l2",
        from: "quill",
        time: "8:02 AM",
        text: "As of this morning: landing page copy is in review, the email draft is ready for you, and the pricing page is one pull request away once Jacob confirms the numbers.",
      },
      { id: "lx2", from: "inky", time: "8:20 AM", text: "", exchange: "x2" },
      {
        id: "l4",
        from: "quill",
        time: "8:21 AM",
        text: "Update: the pricing page pull request is open and in review.",
      },
    ],
  },
  {
    id: "quill",
    name: "Quill",
    agentIds: ["quill"],
    people: ["jacob"],
    place: "lor",
    when: "Yesterday",
    sessions: [],
    messages: [
      {
        id: "q1",
        from: "jacob",
        time: "Yesterday",
        text: "Draft the launch email for Thursday. Short, no hype.",
      },
      {
        id: "q2",
        from: "quill",
        time: "Yesterday",
        text: 'Here\'s a first pass, 90 words. Subject: "Agents your whole team can steer". Want a version for existing customers too?',
      },
    ],
  },
  {
    id: "support",
    name: "Support",
    agentIds: ["rusty"],
    people: ["ana", "eli", "jacob"],
    place: "lor",
    when: "Yesterday",
    sessions: [],
    messages: [
      {
        id: "r1",
        from: "ana",
        time: "Yesterday",
        text: "@Rusty customer wants a 620 refund on an annual plan. What's our rule?",
      },
      {
        id: "r2",
        from: "rusty",
        time: "Yesterday",
        text: "Refunds over 500 need Samira's sign-off. I drafted the reply for you to send once she approves.",
      },
    ],
  },
  {
    id: "inky",
    name: "Inky",
    agentIds: ["inky"],
    people: ["jacob"],
    place: "lor",
    when: "Monday",
    sessions: [],
    messages: [
      {
        id: "x1",
        from: "jacob",
        time: "Monday",
        text: "Walk me through what happens between a merge and production.",
      },
      {
        id: "x2",
        from: "inky",
        time: "Monday",
        text: "Four steps: build, migrate staging, smoke checks, then production behind a flag. Zoe owns the pipeline.",
      },
    ],
  },
]

// Sessions that belong to no chat: yours, with no agent watching them.
export const OWN_SESSIONS: Session[] = [
  {
    id: "o1",
    title: "Try the new diff viewer",
    harness: "Claude Code",
    repo: "web",
    branch: "spike/diff-viewer",
    state: "running",
    summary: "Swapping the diff component behind a flag.",
    when: "10:20 AM",
    steps: [
      "Read how the changes panel draws a diff today",
      "Putting the new viewer behind a flag",
    ],
    files: [
      {
        path: "apps/web/src/components/diff/viewer.tsx",
        added: 96,
        removed: 0,
      },
      { path: "apps/web/src/components/diff/index.ts", added: 8, removed: 3 },
    ],
  },
  {
    id: "o2",
    title: "Rename workspace slugs",
    harness: "Codex",
    repo: "api",
    branch: "chore/slug-rename",
    state: "done",
    summary: "Renamed in 14 files. Not pushed.",
    when: "Yesterday",
    steps: ["Renamed the column and its uses", "Ran the type check"],
    files: [
      { path: "apps/api/src/routes/workspaces.ts", added: 22, removed: 22 },
    ],
  },
]

export const EXCHANGES: Exchange[] = [
  {
    id: "x1",
    from: "quill",
    to: "inky",
    chatId: "launch",
    messages: [
      {
        id: "x1a",
        from: "quill",
        time: "8:01 AM",
        text: "For the launch checklist in Launch crew: is the pricing page change ready for Thursday, and what is it waiting on?",
      },
      {
        id: "x1b",
        from: "inky",
        time: "8:01 AM",
        text: "One pull request away. It is waiting on Jacob to confirm the numbers; I can open it as soon as he does.",
      },
    ],
  },
  {
    id: "x2",
    from: "inky",
    to: "quill",
    chatId: "launch",
    messages: [
      {
        id: "x2a",
        from: "inky",
        time: "8:20 AM",
        text: "Jacob confirmed the numbers in Eng, and the pricing page pull request is open. Your checklist in Launch crew can move it to in review.",
      },
      {
        id: "x2b",
        from: "quill",
        time: "8:20 AM",
        text: "Thanks. Moving it now and telling the chat.",
      },
    ],
  },
]

export const agentById = (id: string) => AGENTS.find((agent) => agent.id === id)
export const personById = (id: string) =>
  PEOPLE.find((person) => person.id === id)
