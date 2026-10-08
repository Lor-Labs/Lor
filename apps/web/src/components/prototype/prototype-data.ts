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
  loop?: boolean
}

export const initialSessions: Session[] = [
  {
    id: "flaky-deploy",
    channelId: "engineering",
    title: "Flaky staging deploy",
    state: "running",
  },
  {
    id: "auth-redis",
    channelId: "engineering",
    title: "Move auth sessions to Redis",
    state: "needs_you",
  },
  {
    id: "release-notes",
    channelId: "engineering",
    title: "v0.9 release notes",
    state: "unread",
  },
  {
    id: "pr-digest",
    channelId: "engineering",
    title: "Weekly PR digest",
    state: "idle",
    loop: true,
  },
  {
    id: "pricing-copy",
    channelId: "product",
    title: "Pricing page copy",
    state: "needs_you",
  },
  {
    id: "survey-themes",
    channelId: "product",
    title: "Onboarding survey themes",
    state: "idle",
  },
]

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
