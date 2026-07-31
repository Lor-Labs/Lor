import type { ConversationTurn } from "../index"
import type { PlacementTurn, ReplyPlacement } from "../placement"

export type EvalResult = {
  answer: string
  valid: number
  invalid: number
  citations: string[]
  newPageBodies: string[]
  toolNames: string[]
  reasoningParts: number
  usageModels: string[]
  retrievalKeys: string[]
  placement?: ReplyPlacement
}

export type EvalCheck = { label: string; pass: boolean }

type BaseFixture = {
  name: string
  description: string
  expect: (r: EvalResult) => EvalCheck[]
}

export type RespondFixture = BaseFixture & {
  kind?: "respond"
  question?: string
  conversation?: ConversationTurn[]
  writeBack?: boolean
}

export type PlacementFixture = BaseFixture & {
  kind: "placement"
  conversation: PlacementTurn[]
}

export type RetrievalFixture = BaseFixture & {
  kind: "retrieval"
  corpus: "brain" | "source"
  query: string
}

export type Fixture = RespondFixture | PlacementFixture | RetrievalFixture

function includesAny(text: string, terms: string[]): boolean {
  const lower = text.toLowerCase()
  return terms.some((t) => lower.includes(t.toLowerCase()))
}

function cites(r: EvalResult, prefix: string): boolean {
  return r.citations.some((citation) => citation.startsWith(prefix))
}

export const fixtures: Fixture[] = [
  {
    name: "brain-citation",
    description: "Answers a person question from a brain page and cites it.",
    question: "What is Alice responsible for?",
    expect: (r) => [
      {
        label: "mentions her responsibilities (architecture / hiring)",
        pass: includesAny(r.answer, ["architecture", "hiring"]),
      },
      { label: "cites a resolved source", pass: r.valid > 0 },
      { label: "has no hallucinated citations", pass: r.invalid === 0 },
      {
        label: "cites the /people/alice page",
        pass: r.citations.some((c) => c.includes("/people/alice")),
      },
    ],
  },
  {
    name: "source-citation",
    description: "Surfaces the seeded GitHub PR and cites it as a source.",
    question: "Has anyone done work on auth token refresh recently?",
    expect: (r) => [
      {
        label: "mentions the refresh-token work",
        pass: includesAny(r.answer, ["refresh", "rotation", "token"]),
      },
      {
        label: "cites a source, none hallucinated",
        pass: r.valid > 0 && r.invalid === 0,
      },
      { label: "uses a source citation", pass: cites(r, "src:") },
    ],
  },
  {
    kind: "retrieval",
    name: "brain-retrieval-top-k",
    description:
      "Retrieves Alice's ownership page directly with the configured embedding model.",
    corpus: "brain",
    query: "Who owns API architecture and engineering hiring?",
    expect: (r) => [
      {
        label: "Alice's page ranks first",
        pass: r.retrievalKeys[0] === "/people/alice",
      },
    ],
  },
  {
    kind: "retrieval",
    name: "source-retrieval-top-k",
    description:
      "Retrieves the refresh-token source directly with the configured embedding model.",
    corpus: "source",
    query: "recent replay protection and rotating refresh tokens",
    expect: (r) => [
      {
        label: "refresh-token PR ranks first",
        pass: r.retrievalKeys[0] === "Add JWT refresh-token rotation",
      },
    ],
  },
  {
    name: "mixed-memory-synthesis",
    description:
      "Combines a durable decision with recent implementation evidence.",
    question:
      "Why did we choose JWT authentication, and what recent work strengthened it?",
    expect: (r) => [
      {
        label: "mentions the JWT rationale",
        pass: includesAny(r.answer, ["stateless", "horizontal", "sticky"]),
      },
      {
        label: "mentions rotation or replay protection",
        pass: includesAny(r.answer, ["rotation", "replay", "revocation"]),
      },
      { label: "uses brain and source citations", pass: r.valid >= 2 },
      { label: "has no hallucinated citations", pass: r.invalid === 0 },
    ],
  },
  {
    name: "chat-history-tool-loop",
    description:
      "Finds a fact that exists only in chat history and cites the message.",
    question: "What time did Monday standup move to?",
    expect: (r) => [
      { label: "answers 10am", pass: includesAny(r.answer, ["10am", "10 am"]) },
      { label: "uses the search tool", pass: r.toolNames.includes("search") },
      { label: "uses a message citation", pass: cites(r, "msg:") },
      { label: "has no hallucinated citations", pass: r.invalid === 0 },
    ],
  },
  {
    name: "source-fetch-loop",
    description:
      "Searches for a source and attempts to expand it before answering.",
    question:
      "Find the recent auth refresh work and explain exactly what happens when a used refresh token is replayed.",
    expect: (r) => [
      {
        label: "mentions revocation or replay handling",
        pass: includesAny(r.answer, ["replay", "revocation", "revoke"]),
      },
      { label: "uses search", pass: r.toolNames.includes("search") },
      {
        label: "expands a source",
        pass: r.toolNames.includes("fetch_source"),
      },
      { label: "uses a source citation", pass: cites(r, "src:") },
    ],
  },
  {
    name: "multi-turn-reference",
    description: "Resolves a follow-up reference from prior conversation.",
    conversation: [
      {
        authorName: "Bucky",
        content: "Tell me briefly what Alice owns.",
      },
      {
        authorName: "Bucky",
        content: "What else does she handle besides architecture?",
      },
    ],
    expect: (r) => [
      { label: "answers hiring", pass: includesAny(r.answer, ["hiring"]) },
      {
        label: "cites Alice's page",
        pass: r.citations.some((c) => c.includes("/people/alice")),
      },
    ],
  },
  {
    name: "honesty-no-memory",
    description:
      "Admits when something is not in memory instead of inventing it.",
    question: "What is our company policy on remote work and PTO?",
    expect: (r) => [
      {
        label: "admits it does not have the policy",
        pass: includesAny(r.answer, [
          "don't",
          "do not",
          "not in",
          "nothing",
          "haven't",
          "no record",
          "couldn't find",
          "not sure",
        ]),
      },
      { label: "has no hallucinated citations", pass: r.invalid === 0 },
    ],
  },
  {
    name: "write-back-durable",
    description:
      "Autonomously saves a clearly stated durable decision to the brain.",
    question:
      "Just so the team knows — we've decided to move the job queue off Redis and onto Postgres, effective next month.",
    writeBack: true,
    expect: (r) => [
      {
        label: "writes or updates a brain page",
        pass: r.newPageBodies.length > 0,
      },
      {
        label: "captures the Redis to Postgres decision",
        pass: includesAny(r.newPageBodies.join("\n"), [
          "redis",
          "postgres",
          "queue",
        ]),
      },
    ],
  },
  {
    name: "write-back-restraint-trivial",
    description: "Does not save conversational noise as institutional memory.",
    question: "Thanks, that makes sense!",
    writeBack: true,
    expect: (r) => [
      {
        label: "does not modify the brain",
        pass: r.newPageBodies.length === 0,
      },
    ],
  },
  {
    name: "write-back-restraint-uncertain",
    description: "Does not save an unconfirmed possibility as a decision.",
    question:
      "We might possibly look at moving analytics to ClickHouse someday, but nobody has decided anything.",
    writeBack: true,
    expect: (r) => [
      {
        label: "does not modify the brain",
        pass: r.newPageBodies.length === 0,
      },
    ],
  },
  {
    name: "reasoning-and-tools",
    description:
      "Completes a synthesis after tools while preserving streamed reasoning.",
    question:
      "Using both team memory and recent work, give me a concise risk assessment of our authentication design.",
    expect: (r) => [
      {
        label: "produces a substantive answer",
        pass: r.answer.trim().length >= 120,
      },
      {
        label: "streams reasoning",
        pass: r.reasoningParts > 0,
      },
      {
        label: "uses at least one tool",
        pass: r.toolNames.length > 0,
      },
      { label: "has no hallucinated citations", pass: r.invalid === 0 },
    ],
  },
  {
    kind: "placement",
    name: "placement-channel",
    description: "Keeps a broadly relevant team decision in the channel.",
    conversation: [
      {
        authorName: "Bucky",
        content:
          "We have finalized the production database migration for next Monday. Can you summarize it for everyone?",
      },
    ],
    expect: (r) => [
      {
        label: "chooses the main channel",
        pass: r.placement === "channel",
      },
    ],
  },
  {
    kind: "placement",
    name: "placement-thread",
    description: "Moves a narrow clarification out of the main channel.",
    conversation: [
      {
        authorName: "Bucky",
        content:
          "Merlin, can you explain only to me what the second sentence of your last answer meant?",
      },
    ],
    expect: (r) => [
      { label: "chooses a thread", pass: r.placement === "thread" },
    ],
  },
]
