import type { PiTurnSave } from "./pi-runtime"

// Native harness failures carry the completed work into account failover.
export class HarnessTurnError extends Error {
  save: PiTurnSave | null = null

  constructor(cause: unknown) {
    const message =
      cause instanceof Error
        ? cause.message
        : typeof cause === "string"
          ? cause
          : typeof cause === "object" && cause !== null && "message" in cause
            ? String(cause.message)
            : "The provider could not complete this turn."
    super(message, { cause })
    this.name = "HarnessTurnError"
  }
}
