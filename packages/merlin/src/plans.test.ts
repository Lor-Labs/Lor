import type { AgentRunContextPlan } from "@repo/db/schema"
import { describe, expect, it } from "vitest"
import {
  planContextSnapshot,
  planRulesSection,
  planStateSection,
} from "./plans"

const plan: AgentRunContextPlan = {
  title: "Export manually edited policy status CSV",
  goal: "CSV of customers whose policy status a human changed",
  status: "running",
  steps: [
    { text: "Read the Notion overview", status: "done" },
    { text: "Explore the audit tables", status: "active", description: "GTI" },
    { text: "Export the CSV", status: "pending" },
  ],
  summary: null,
}

describe("planRulesSection", () => {
  it("carries no plan-specific data, so it stays cacheable across runs", () => {
    const rules = planRulesSection(true, true)
    expect(rules).not.toContain(plan.title)
    expect(rules).not.toContain(plan.goal)
    expect(rules).not.toContain("[active]")
    // Identical for any two plan runs with the same capability.
    expect(rules).toBe(planRulesSection(true, true))
    expect(rules).toContain("update_plan")
    expect(rules).toContain("complete_plan")
  })

  it("points the model at where the live plan state actually is", () => {
    expect(planRulesSection(true, true)).toContain(
      "end of the conversation below"
    )
  })

  it("only mentions deliverables when artifacts are enabled", () => {
    expect(planRulesSection(true, true)).toContain("create_artifacts")
    expect(planRulesSection(false, true)).not.toContain("create_artifacts")
  })
})

describe("planStateSection", () => {
  it("renders title, status, goal, and the steps with item states", () => {
    const state = planStateSection(plan)
    expect(state).toContain(`"${plan.title}"`)
    expect(state).toContain("status: running")
    expect(state).toContain(plan.goal)
    expect(state).toContain("- [done] Read the Notion overview")
    expect(state).toContain("- [active] Explore the audit tables — GTI")
    expect(state).toContain("- [pending] Export the CSV")
  })

  it("says so explicitly when there are no steps yet", () => {
    expect(planStateSection({ ...plan, steps: [] })).toContain("(no steps yet)")
  })

  it("includes a summary only once one exists", () => {
    expect(planStateSection(plan)).not.toContain("Summary so far")
    expect(
      planStateSection({ ...plan, summary: "Found 2,553 rows" })
    ).toContain("Summary so far: Found 2,553 rows")
  })
})

describe("planContextSnapshot", () => {
  it("captures the volatile fields the prompt tail renders", () => {
    const snapshot = planContextSnapshot({ id: "plan-1", ...plan })
    expect(snapshot).toEqual(plan)
    // The run id is execution state, not prompt state — it must not ride along.
    expect(snapshot).not.toHaveProperty("id")
  })
})
