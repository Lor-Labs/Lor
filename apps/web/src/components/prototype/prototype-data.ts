export type Person = { id: string; name: string; image: string }

export const people = {
  mara: { id: "mara", name: "Mara Voss", image: "/demo/mara.jpg" },
  eli: { id: "eli", name: "Eli Mercer", image: "/demo/eli.jpg" },
  samira: { id: "samira", name: "Samira Vale", image: "/demo/samira.jpg" },
  owen: { id: "owen", name: "Owen Park", image: "/demo/owen.jpg" },
} satisfies Record<string, Person>

export const me = people.mara

export type Channel = {
  id: string
  name: string
  type: "text" | "voice"
  topic?: string
}

export const channels: Channel[] = [
  {
    id: "general",
    name: "general",
    type: "text",
    topic: "Team-wide updates and discussion.",
  },
  {
    id: "engineering",
    name: "engineering",
    type: "text",
    topic: "Code, pull requests, and technical decisions.",
  },
  { id: "product", name: "product", type: "text" },
  { id: "random", name: "random", type: "text", topic: "Everything else." },
  { id: "standup", name: "standup", type: "voice" },
]

export type SessionState = "running" | "unread" | "needs_you" | "idle"

export type Session = {
  id: string
  channelId: string
  title: string
  state: SessionState
  subscriberIds: string[]
  loop?: boolean
  archivedBy?: string
}

export const initialSessions: Session[] = [
  {
    id: "flaky-deploy",
    channelId: "engineering",
    title: "Flaky staging deploy",
    state: "running",
    subscriberIds: ["mara", "eli", "owen"],
  },
  {
    id: "auth-redis",
    channelId: "engineering",
    title: "Move auth sessions to Redis",
    state: "needs_you",
    subscriberIds: ["mara", "eli"],
  },
  {
    id: "release-notes",
    channelId: "engineering",
    title: "v0.9 release notes",
    state: "unread",
    subscriberIds: ["mara", "samira"],
  },
  {
    id: "pr-digest",
    channelId: "engineering",
    title: "Weekly PR digest",
    state: "idle",
    subscriberIds: ["mara"],
    loop: true,
  },
  {
    id: "billing-sentry",
    channelId: "engineering",
    title: "Sentry spike in billing worker",
    state: "running",
    subscriberIds: ["eli"],
  },
  {
    id: "pricing-copy",
    channelId: "product",
    title: "Pricing page copy",
    state: "needs_you",
    subscriberIds: ["mara", "owen"],
  },
  {
    id: "survey-themes",
    channelId: "product",
    title: "Onboarding survey themes",
    state: "idle",
    subscriberIds: ["mara"],
  },
  {
    id: "competitor-scan",
    channelId: "product",
    title: "Competitor pricing scan",
    state: "idle",
    subscriberIds: ["samira"],
  },
]

export type SessionMessage =
  | {
      id: string
      kind: "person"
      author: Person
      text: string
      toLor: boolean
    }
  | { id: string; kind: "lor"; text: string; steps?: string }
  | { id: string; kind: "approval"; action: string; approved?: boolean }

export const initialTranscripts: Record<string, SessionMessage[]> = {
  "flaky-deploy": [
    {
      id: "f1",
      kind: "person",
      author: people.eli,
      text: "@Lor why does the staging deploy keep failing on the migration step?",
      toLor: true,
    },
    {
      id: "f2",
      kind: "lor",
      steps: "Read 6 files · Ran 3 commands · Checked 4 deploy logs",
      text: "The deploy fails when two services run migrations at the same time. Both take the same advisory lock. The second one waits 10 seconds, gives up, and the deploy step reports a failure even though nothing is broken.\n\n- `migrate.ts` sets `lock_timeout` to 10 seconds\n- Staging deploys the API and the worker in parallel\n- Both run migrations on boot\n\nThe smallest fix is to run migrations once, before either service starts.",
    },
    {
      id: "f3",
      kind: "person",
      author: people.owen,
      text: "@Eli I can take the boot order change if you want",
      toLor: false,
    },
    {
      id: "f4",
      kind: "person",
      author: people.eli,
      text: "Sounds good. Draft a retry for the lock in the meantime",
      toLor: true,
    },
  ],
  "auth-redis": [
    {
      id: "a1",
      kind: "person",
      author: people.mara,
      text: "@Lor move auth session storage to Redis and open a PR",
      toLor: true,
    },
    {
      id: "a2",
      kind: "lor",
      steps: "Read 9 files · Ran 2 commands",
      text: "The change is ready. Session reads and writes now go through the existing Redis client, and Postgres stays as a fallback for one release.\n\nOpening the pull request needs your approval.",
    },
    {
      id: "a3",
      kind: "approval",
      action: "Open pull request #219: Move auth sessions to Redis",
    },
  ],
}

export const seedMessageIds: Record<string, string[]> = {
  "flaky-deploy": ["m1", "m2", "m3"],
}

export const plans: Record<string, { label: string; done: boolean }[]> = {
  "flaky-deploy": [
    { label: "Read the deploy logs", done: true },
    { label: "Find the lock conflict", done: true },
    { label: "Draft a retry for the lock", done: false },
    { label: "Open a pull request", done: false },
  ],
  "auth-redis": [
    { label: "Map session reads and writes", done: true },
    { label: "Move storage to Redis", done: true },
    { label: "Open a pull request", done: false },
  ],
}

export const sessionFiles: Record<string, string[]> = {
  "flaky-deploy": ["deploy-staging.log", "migrate.ts"],
  "auth-redis": ["session-store.ts", "redis-session.diff"],
}

export type ChatMessage =
  | { id: string; kind: "person"; author: Person; time: string; text: string }
  | { id: string; kind: "event"; time: string; text: string }
  | {
      id: string
      kind: "share"
      author: Person
      time: string
      text: string
      sessionId: string
      sessionTitle: string
      excerpt: string
    }

export const initialChats: Record<string, ChatMessage[]> = {
  engineering: [
    {
      id: "m1",
      kind: "person",
      author: people.eli,
      time: "9:12 AM",
      text: "Staging deploy failed on the migration step again. Third time this week.",
    },
    {
      id: "m2",
      kind: "person",
      author: people.owen,
      time: "9:14 AM",
      text: "I can pair on it after standup if nobody has it yet",
    },
    {
      id: "m3",
      kind: "event",
      time: "9:20 AM",
      text: "eli-mercer merged #212 Retry migration lock on deploy",
    },
    {
      id: "m4",
      kind: "share",
      author: people.samira,
      time: "9:41 AM",
      text: "Release notes for v0.9 are ready. Take a look before we post them.",
      sessionId: "release-notes",
      sessionTitle: "v0.9 release notes",
      excerpt:
        "12 changes across web and mobile. Highlights: voice channels, call summaries, and faster search.",
    },
    {
      id: "m5",
      kind: "person",
      author: people.mara,
      time: "9:45 AM",
      text: "@Owen can you check the copy on the pricing page before Friday?",
    },
  ],
}

export function titleFromPrompt(prompt: string) {
  const words = prompt.replace(/@\w+/g, "").trim().split(/\s+/).filter(Boolean)
  const title = words.slice(0, 6).join(" ")
  if (!title) return "New session"
  const capitalized = title.charAt(0).toUpperCase() + title.slice(1)
  return words.length > 6 ? `${capitalized}…` : capitalized
}

export function mentionedPeople(text: string) {
  return Object.values(people).filter((person) => {
    if (person.id === me.id) return false
    const firstName = person.name.split(" ")[0]
    return new RegExp(`@${firstName}\\b`, "i").test(text)
  })
}
