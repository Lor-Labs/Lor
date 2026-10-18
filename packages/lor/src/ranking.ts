// Ranking priors applied after the relevance cutoff: relevance gates, priors
// only reorder what passed, so recency or authority can never lift an
// irrelevant item. Starting values, untuned; retune when the eval exists.
// reference/planned/context-engine.md §5.7, context-engine-phase-2.md Step 8.

// merged code > human docs > issues > calls ≈ chat > Lor-written text (intent,
// not fact).
export const AUTHORITY = {
  merged_pr: 1,
  file: 0.8,
  issue: 0.6,
  call: 0.4,
  chat: 0.4,
  lor: 0.2,
} as const

export type AuthorityClass = keyof typeof AUTHORITY

export type Prior = {
  authority: AuthorityClass
  at: Date | null
  // null = no decay (open issues and PRs).
  halfLifeDays: number | null
}

export const HALF_LIFE_DAYS = {
  chat: 30,
  call: 60,
  doc: 365,
} as const

const RECENCY_WEIGHT = 0.3
const AUTHORITY_WEIGHT = 0.3
const DAY_MS = 86_400_000

function logit(p: number) {
  const clamped = Math.min(Math.max(p, 1e-4), 1 - 1e-4)
  return Math.log(clamped / (1 - clamped))
}

function recency(prior: Prior, now: number) {
  if (prior.halfLifeDays === null || !prior.at) return 1
  const ageDays = Math.max(0, (now - prior.at.getTime()) / DAY_MS)
  return 0.5 ** (ageDays / prior.halfLifeDays)
}

// logit(p) + 0.3·recency + 0.3·authority, with p the rerank score.
export function priorScore(relevance: number, prior: Prior, now: number) {
  return (
    logit(relevance) +
    RECENCY_WEIGHT * recency(prior, now) +
    AUTHORITY_WEIGHT * AUTHORITY[prior.authority]
  )
}

// GitHub says open or closed; a Linear state name doesn't, so Linear issues
// never decay. Attio notes are human docs, recordings are calls.
export function sourcePrior(source: {
  provider: string
  kind: string
  state: string | null
  when: string
}): Prior {
  const at = new Date(source.when)
  if (source.kind === "note") {
    return { authority: "file", at, halfLifeDays: HALF_LIFE_DAYS.doc }
  }
  if (source.kind === "call_recording") {
    return { authority: "call", at, halfLifeDays: HALF_LIFE_DAYS.call }
  }
  const open =
    source.provider !== "github" ||
    source.state === "open" ||
    source.state === "draft"
  return {
    authority: source.state === "merged" ? "merged_pr" : "issue",
    at,
    halfLifeDays: open ? null : HALF_LIFE_DAYS.doc,
  }
}
