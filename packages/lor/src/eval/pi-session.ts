import { randomUUID } from "node:crypto"
import {
  defaultRunBudgets,
  type RunCounters,
  type RunHandle,
  ZERO_RUN_COUNTERS,
} from "../run"
import { deleteSessionSandbox } from "../sandbox/session-sandbox"
import type { HarnessOwner, SavedHarnessState } from "../session-core"
import type { PiTurnSave } from "../session-core/pi-runtime"

// One eval conversation on the Pi path, as the worker runs it: each turn is
// a run bound to the session's harness. The saved Pi state lives in memory
// between turns (the worker keeps it in Postgres); the session's Blaxel
// sandbox is real and deleted by close(). Bypass mode, because nobody answers
// an ask in an eval; hard rules still apply.
export function evalPiSession() {
  const owner: HarnessOwner = { sessionId: randomUUID() }
  let saved: SavedHarnessState | null = null
  let counters: RunCounters = { ...ZERO_RUN_COUNTERS }

  const apply = (save: PiTurnSave | null) => {
    if (!save) return
    saved = {
      binding: save.binding,
      head: save.head,
      log:
        save.log.kind === "replace"
          ? save.log.text
          : `${saved?.log ?? ""}${save.log.text}`,
      continuation: save.continuation,
    }
  }

  return {
    // A fresh run for the next turn, bound to the state the last one saved.
    run(): RunHandle {
      return {
        runId: randomUUID(),
        budgets: defaultRunBudgets(),
        resume: null,
        saveContext: async () => {},
        toolResults: null,
        harness: {
          owner,
          saved,
          savedAnswer: null,
          pausedDecisions: null,
          pausedDropped: null,
          continueOnly: false,
          sandboxMode: "bypass",
          recordUsage: async (_usage, kind) => {
            if (kind === "step") {
              counters = { ...counters, steps: counters.steps + 1 }
            }
            return counters
          },
          saveTurn: async (turn) => {
            apply(turn.save)
            return counters
          },
        },
      }
    },
    // The last turn paused on an approval; the eval cannot answer it.
    paused: () => Boolean(saved?.continuation),
    close: () => deleteSessionSandbox(owner),
  }
}
