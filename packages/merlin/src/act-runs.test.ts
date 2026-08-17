import { describe, expect, it } from "vitest"
import { buildActBatchPayload, formatActBriefing } from "./act-runs"

// The batch turn is what Merlin actually reads for a coalesced burst, so the
// framing (count, span, sample numbering) is behavior, not cosmetics.
describe("buildActBatchPayload", () => {
  const at = (iso: string) => new Date(iso)

  it("passes a single delivery through unchanged", () => {
    const payload = buildActBatchPayload({
      label: "Health Monitor",
      count: 1,
      samples: [
        { index: 1, createdAt: at("2026-08-17T09:02:11Z"), text: "DB timeout" },
      ],
    })
    expect(payload).toBe("DB timeout")
  })

  it("frames a burst as one situation with the real delivery numbers", () => {
    const payload = buildActBatchPayload({
      label: "Health Monitor",
      count: 482,
      samples: [
        { index: 1, createdAt: at("2026-08-17T09:02:11Z"), text: "first" },
        { index: 2, createdAt: at("2026-08-17T09:02:14Z"), text: "second" },
        { index: 3, createdAt: at("2026-08-17T09:02:19Z"), text: "third" },
        { index: 480, createdAt: at("2026-08-17T09:06:51Z"), text: "n-2" },
        { index: 481, createdAt: at("2026-08-17T09:06:58Z"), text: "n-1" },
        { index: 482, createdAt: at("2026-08-17T09:07:04Z"), text: "last" },
      ],
    })
    expect(payload).toContain('482 deliveries from "Health Monitor"')
    expect(payload).toContain(
      "between 2026-08-17T09:02:11.000Z and 2026-08-17T09:07:04.000Z"
    )
    expect(payload).toContain("--- delivery 1 of 482")
    expect(payload).toContain("--- delivery 482 of 482")
    expect(payload).toContain(
      "(476 deliveries between those samples are omitted.)"
    )
  })

  it("frames a follow-up batch so the leading run's work isn't repeated", () => {
    const payload = buildActBatchPayload({
      label: "Health Monitor",
      count: 12,
      followUp: true,
      samples: [
        { index: 1, createdAt: at("2026-08-17T09:03:00Z"), text: "more" },
        { index: 12, createdAt: at("2026-08-17T09:07:00Z"), text: "latest" },
      ],
    })
    expect(payload).toContain("12 further deliveries")
    expect(payload).toContain("already handled the first one")
  })

  it("still frames a single follow-up delivery rather than passing it through", () => {
    const payload = buildActBatchPayload({
      label: "Health Monitor",
      count: 1,
      followUp: true,
      samples: [
        { index: 1, createdAt: at("2026-08-17T09:03:00Z"), text: "one more" },
      ],
    })
    expect(payload).toContain("1 further delivery from")
    expect(payload).toContain("one more")
  })

  it("omits the omission note when every delivery is quoted", () => {
    const payload = buildActBatchPayload({
      label: "Sentry",
      count: 2,
      samples: [
        { index: 1, createdAt: at("2026-08-17T09:02:11Z"), text: "a" },
        { index: 2, createdAt: at("2026-08-17T09:02:12Z"), text: "b" },
      ],
    })
    expect(payload).toContain("2 deliveries")
    expect(payload).not.toContain("omitted")
  })

  it("clips a runaway sample instead of shipping megabytes to the model", () => {
    const payload = buildActBatchPayload({
      label: "Noisy",
      count: 3,
      samples: [
        {
          index: 1,
          createdAt: at("2026-08-17T09:00:00Z"),
          text: "x".repeat(200_000),
        },
        { index: 2, createdAt: at("2026-08-17T09:00:01Z"), text: "y" },
        { index: 3, createdAt: at("2026-08-17T09:00:02Z"), text: "z" },
      ],
    })
    expect(payload.length).toBeLessThanOrEqual(48 * 1024 + 1)
    expect(payload).toContain("…")
  })
})

// The briefing is how a run learns what its predecessors did — the framing is
// what stops it from filing the same PR twice.
describe("formatActBriefing", () => {
  const at = (iso: string) => new Date(iso)

  it("is empty on a trigger's first run", () => {
    expect(
      formatActBriefing({
        priorRuns: [],
        totalRuns: 0,
        messagesSinceLastRun: [],
      })
    ).toBeNull()
  })

  it("carries the predecessor's note and tells the successor to verify it", () => {
    const briefing = formatActBriefing({
      priorRuns: [
        {
          createdAt: at("2026-08-17T09:07:00Z"),
          state: "complete",
          stopReason: "completed",
          note: "Root cause is the pool ceiling; filed PR #4312.",
          effects: ["post_channel_message", "investigate_code"],
        },
      ],
      totalRuns: 4,
      messagesSinceLastRun: [],
    })
    expect(briefing).toContain("4 in the last 24h")
    expect(briefing).toContain("filed PR #4312")
    expect(briefing).toContain("not verified facts")
    // Side effects read in a stable order regardless of query order.
    expect(briefing).toContain(
      "side effects: investigate_code, post_channel_message"
    )
  })

  it("still reports what a crashed run did when it left no note", () => {
    const briefing = formatActBriefing({
      priorRuns: [
        {
          createdAt: at("2026-08-17T08:41:00Z"),
          state: "failed",
          stopReason: "budget_wall_clock",
          note: null,
          effects: ["create_linear_issue"],
        },
      ],
      totalRuns: 1,
      messagesSinceLastRun: [],
    })
    expect(briefing).toContain("failed (budget_wall_clock)")
    expect(briefing).toContain("side effects: create_linear_issue")
    expect(briefing).toContain("note: (none left)")
  })

  it("gives humans in the channel the last word", () => {
    const briefing = formatActBriefing({
      priorRuns: [
        {
          createdAt: at("2026-08-17T09:07:00Z"),
          state: "complete",
          stopReason: "completed",
          note: "Filed PR #4312.",
          effects: [],
        },
      ],
      totalRuns: 1,
      messagesSinceLastRun: [
        {
          authorName: "jacob",
          content: "already on it, don't open another PR",
        },
        { authorName: null, content: "   " },
      ],
    })
    expect(briefing).toContain("Channel activity since your last run")
    expect(briefing).toContain("jacob: already on it")
    expect(briefing).toContain("takes precedence")
    // Blank messages don't earn a bullet.
    expect(briefing).not.toContain("Someone:")
  })
})
