export type EvalResult = {
  answer: string
  valid: number
  invalid: number
  citations: string[]
  newPageBodies: string[]
}

export type EvalCheck = { label: string; pass: boolean }

export type Fixture = {
  name: string
  description: string
  question: string
  writeBack?: boolean
  expect: (r: EvalResult) => EvalCheck[]
}

function includesAny(text: string, terms: string[]): boolean {
  const lower = text.toLowerCase()
  return terms.some((t) => lower.includes(t.toLowerCase()))
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
      { label: "cites a resolved source (valid > 0)", pass: r.valid > 0 },
      {
        label: "no hallucinated citations (invalid = 0)",
        pass: r.invalid === 0,
      },
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
      {
        label: "cites a [[src:…]]",
        pass: r.citations.some((c) => c.startsWith("src:")),
      },
    ],
  },
  {
    name: "honesty-no-memory",
    description:
      "Admits when something isn't in memory instead of inventing it.",
    question: "What is our company policy on remote work and PTO?",
    expect: (r) => [
      {
        label: "admits it doesn't have it",
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
      {
        label: "no hallucinated citations (invalid = 0)",
        pass: r.invalid === 0,
      },
    ],
  },
  {
    name: "write-back",
    description:
      "Autonomously saves newly-stated durable knowledge to the brain.",
    question:
      "Just so the team knows — we've decided to move the job queue off Redis and onto Postgres, effective next month.",
    writeBack: true,
    expect: (r) => [
      {
        label: "a new brain page was written",
        pass: r.newPageBodies.length > 0,
      },
      {
        label: "the page captures the Redis → Postgres decision",
        pass: includesAny(r.newPageBodies.join("\n"), [
          "redis",
          "postgres",
          "queue",
        ]),
      },
    ],
  },
]
