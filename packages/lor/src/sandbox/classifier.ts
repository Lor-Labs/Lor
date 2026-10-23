// Only flagged sandbox calls reach this contract. Tool results and Lor's
// text are deliberately absent (pi-harness-runbook.md §4.6).

export type ClassifierCall = { toolName: string; subject: string }

export type ClassifierInput = {
  toolCallId?: string
  call: ClassifierCall & {
    // A write's content or an edit's replacement, bounded.
    content?: string
    oldContent?: string
    subcommands?: (string | null)[][]
    // The rule that flagged the call.
    flagReason: string
  }
  workDir: string
  // The latest message of the person who started the turn; for a Loop, its
  // saved prompt.
  request: string
  // The turn's last few calls, without their outputs.
  recentCalls: ClassifierCall[]
  // Calls already refused in this turn.
  denials: string[]
  // Facts read from the sandbox, such as `git status` before destructive git
  // or the script a command runs.
  sandboxFacts?: string
  // Incomplete evidence must never authorize the unseen part of an action.
  incomplete?: boolean
  // Loop and Act runs: nobody to ask, so a stop refuses the call.
  autonomous: boolean
}

export type ClassifierVerdict = {
  allow: boolean
  reason: string
  costUsd?: number
}

export type SandboxClassifier = {
  // Model and version, e.g. "jev-1.13"; results are compared per id.
  id: string
  classify(
    input: ClassifierInput,
    signal?: AbortSignal
  ): Promise<ClassifierVerdict>
}
