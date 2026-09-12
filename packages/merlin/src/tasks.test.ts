import type { AgentRunContextTask } from "@repo/db/schema"
import { describe, expect, it } from "vitest"
import {
  taskContextSnapshot,
  taskRulesSection,
  taskStateSection,
} from "./tasks"

const task: AgentRunContextTask = {
  title: "Export manually edited policy status CSV",
  goal: "CSV of customers whose policy status a human changed",
  status: "running",
  plan: [
    { text: "Read the Notion overview", status: "done" },
    { text: "Explore the audit tables", status: "active", description: "GTI" },
    { text: "Export the CSV", status: "pending" },
  ],
  summary: null,
}

describe("taskRulesSection", () => {
  it("carries no task-specific data, so it stays cacheable across runs", () => {
    const rules = taskRulesSection(true, true)
    expect(rules).not.toContain(task.title)
    expect(rules).not.toContain(task.goal)
    expect(rules).not.toContain("[active]")
    // Identical for any two task runs with the same capability.
    expect(rules).toBe(taskRulesSection(true, true))
    expect(rules).toContain("set_plan")
    expect(rules).toContain("complete_task")
  })

  it("points the model at where the live task state actually is", () => {
    expect(taskRulesSection(true, true)).toContain(
      "end of the conversation below"
    )
  })

  it("only mentions deliverables when artifacts are enabled", () => {
    expect(taskRulesSection(true, true)).toContain("create_artifacts")
    expect(taskRulesSection(false, true)).not.toContain("create_artifacts")
  })
})

describe("taskStateSection", () => {
  it("renders title, status, goal, and the plan with item states", () => {
    const state = taskStateSection(task)
    expect(state).toContain(`"${task.title}"`)
    expect(state).toContain("status: running")
    expect(state).toContain(task.goal)
    expect(state).toContain("- [done] Read the Notion overview")
    expect(state).toContain("- [active] Explore the audit tables — GTI")
    expect(state).toContain("- [pending] Export the CSV")
  })

  it("says so explicitly when there is no plan yet", () => {
    expect(taskStateSection({ ...task, plan: [] })).toContain("(no plan yet)")
  })

  it("includes a summary only once one exists", () => {
    expect(taskStateSection(task)).not.toContain("Summary so far")
    expect(
      taskStateSection({ ...task, summary: "Found 2,553 rows" })
    ).toContain("Summary so far: Found 2,553 rows")
  })
})

describe("taskContextSnapshot", () => {
  it("captures the volatile fields the prompt tail renders", () => {
    const snapshot = taskContextSnapshot({ id: "task-1", ...task })
    expect(snapshot).toEqual(task)
    // The run id is execution state, not prompt state — it must not ride along.
    expect(snapshot).not.toHaveProperty("id")
  })
})
